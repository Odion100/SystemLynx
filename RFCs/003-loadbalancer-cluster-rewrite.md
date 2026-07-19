# RFC: LoadBalancer Rewrite — Discovery, Directory, and Cluster Delegation

## Context

The `LoadBalancer` was built very early, before much of the system existed
(`connectionData`, `Client.createService`, the current event model). Its core instinct is
right and worth keeping: **service discovery, where load balancing falls out for free**
because SystemLynx clients connect once. A client fetches a service's `connectionData` from
a URL and connects directly; the LoadBalancer is just "a URL that returns `connectionData`,
round-robined." That makes balancing **connect-time and sticky** — exactly what a
WebSocket-stateful RPC system wants (per-request balancing would shred socket affinity and
room state).

We keep the name **LoadBalancer**: it reads as *management of the cluster* (register,
discovery, delegation), not merely balancing. Delegate isn't advertised by the name, so the
docs carry that.

This RFC rewrites it around three concerns: **register/discovery**, a **service directory**,
and **cluster delegation** (`delegate` / `broadcast` / `elect`) — and drops the early-days
structural gymnastics.

---

## What's wrong today

- `register` requires `{ host, port, route }` separately — obsolete now that a URL's
  `connectionData` is self-describing.
- Discovery returns one service's `connectionData`; there's no way to fetch many at once,
  even though `Client.createService(connectionData)` now lets a client wire up services
  locally from raw connection data.
- Health is passive and one-way: a location is dropped only when a discovery request to it
  fails ([Router.js:26-31](../systemlynx/LoadBalancer/components/Router.js#L26-L31)), and it
  is **never re-admitted**. That eviction loop also uses an **undeclared global `i`** and
  splices `locations` while it is the live round-robin source — a concurrency bug.
- `dispatch`/`assignDispatch` is a half-formed dedup (`handledEvents` capped via
  `splice(20)`), and named for its mechanism, not its intent.
- Structural: `LoadBalancer.module("clones", CloneManager)` + `Router.apply(Clones, [server])`
  is indirection from before the module conventions settled.

---

## Design

### 1. Registration — URL-first

```js
LoadBalancer.clones.register({ url, name });   // name optional (an alias); url required
```

On register the LoadBalancer **fetches the URL's `connectionData`**, which yields
`route`, `host`, `port`, `namespace`, and `modules`. Everything is derived from the URL —
the caller supplies nothing else. The fetch doubles as a **liveness check** at registration.

Clones are grouped by `route`; a second clone of the same route adds a `location`.

### 2. Service directory — fetch many in one shot

Two **distinct** kinds of endpoint — they were conflated in the first draft:

- **Per-service route (unchanged).** `GET /<serviceRoute>` → round-robined `connectionData`
  for *that one* service. One route = one service. No query param here.
- **Directory (new, separate).** A dedicated `directory(only?)` method (not a service route)
  returns a bundle keyed by service name/route, so a client can bootstrap a whole app in one
  call and build proxies locally with `Client.createService(connData)`:
  `directory(["/a","/b"])` → `{ "/a": connData, "/b": connData }`; `directory()` → all.

Services are identified by their **route** (the natural key from their `connectionData`);
**name is only an optional alias**. Each service in a bundle is round-robined independently.
(A GET form of the directory can come later; a method sidesteps colliding with the LB's own
service route.)

### 3. Cluster delegation — three modes of cluster action

Every instance is an identical **clone**. The LoadBalancer is the shared coordinator that
answers "how should N clones handle this action." Three primitives:

| Method | Semantics | Use |
|:---|:---|:---|
| `delegate(key)` | **exactly one** clone proceeds (at-most-once) | dedup a side effect that would otherwise fire N times |
| `broadcast(key, data)` | **every** clone acts | cache flush, config reload, "all of you drop local state" |
| `elect(role)` | **one** clone holds a role over time; re-elected on death | singleton work — the cron/scheduler that must run once |

**Contract — `delegate` requires a deterministic, shared `key`.** All clones fire
`delegate` near-simultaneously for the "same" logical action, so they must compute the
**same key** (derived from the action's semantics, never random per-clone) or dedup fails
and everyone runs. The first caller to claim `key` wins; the rest are told it's handled.

**Guarantee — `delegate` is at-most-once, deliberately.** If the winner crashes after
claiming but before finishing, the action does not run. That is an accepted trade for
simplicity; work that must survive a crash uses **`elect`** (a leader that *owns* the job
and is re-elected on failure) rather than per-action delegation. We are not building a
consensus engine.

**Retention.** Claimed keys are remembered for a TTL window (config, default e.g. 60s) so
late/retry callers still see "handled," with bounded memory — replacing the ad-hoc
`splice(20)` pruning.

### 4. Health — active and reversible

- Keep passive eviction on failed discovery, but make it **safe**: no global `i`, and never
  splice the array that is actively being iterated for round-robin.
- Add **re-admission**: a re-`register` of a previously evicted URL restores it. (Optional
  follow-up: periodic active health pings; out of scope for v1 unless we decide otherwise.)

### 5. Structure — one clean module, buAPI style

Drop `CloneManager` + `Router.apply`. The module is named **`Clones`** (capitalized, per the
buAPI convention — `Users`, `Orders`, `Games`) and defined the way buAPI does
([Basketball/Games/index.js](../../buAPI/Basketball/Games/index.js)) — methods return
values/promises (SystemLynx RPC idiom), not node-style callbacks:

```js
module.exports = function Clones(server) {
  this.services = [];                                   // [{ route, name, locations, index }]
  this.register  = async ({ url, name }) => { /* fetch connectionData, group by route */ };
  this.directory = async (only) => { /* keyed bundle of connData */ };
  this.delegate  = (key) => { /* claim-once with TTL */ };
  this.broadcast = (key, data) => { /* emit to all clones */ };
  this.elect     = ({ role, holderId }) => { /* lease-based leader, re-elect on lapse */ };
};
```

Discovery routing (the `GET /<route>` round-robin) stays server-side but is expressed
without the shared-closure/global-`i` bugs.

---

## Files to Change

- `systemlynx/LoadBalancer/LoadBalancer.js` — collapse to a single clean module; drop the
  `module("clones", CloneManager)` indirection.
- `systemlynx/LoadBalancer/components/CloneManager.js` — fold into the module (or remove);
  add `register` (URL-first), `delegate`, `broadcast`, `elect`.
- `systemlynx/LoadBalancer/components/Router.js` — fix the round-robin + eviction
  (no global `i`, no splice-while-iterating, re-admission); add the `?services=` bundle form.
- `systemlynx/LoadBalancer/tests/LoadBalancer.test.js` — cover URL-first register, the
  directory bundle, `delegate` (one winner among many callers), `broadcast` (all act),
  `elect` (one holder, re-elect after the holder drops), and eviction/re-admission.
- `API.md` / `README.md` — document the LoadBalancer as discovery + directory + delegation,
  and the `delegate`/`broadcast`/`elect` model.

---

## Verification

1. `npm test` — existing suite stays green.
2. `register({ url })` derives route/host/port from fetched `connectionData`; a dead URL is
   rejected at register time.
3. `?services=all` returns a keyed bundle a client can feed to `Client.createService`.
4. `delegate(key)` called by N simulated clones with the same key → exactly one "you're it".
5. `broadcast(key)` → all registered clones receive it.
6. `elect(role)` → one holder; when it drops, a re-election picks another.
7. Eviction removes a dead location without corrupting the round-robin; re-`register`
   restores it.
