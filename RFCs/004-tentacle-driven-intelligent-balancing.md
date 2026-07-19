# RFC 004: Tentacle-Driven Intelligent Load Balancing

## Context

RFC 003 built the LoadBalancer core: URL-first `register`, a connectionData `directory`,
round-robin discovery with safe eviction, and the cluster-delegation primitives
`delegate` / `broadcast` / `elect`. That is done and tested (86/86).

Phase 2 makes the LoadBalancer *smart* and makes the delegation primitives *ergonomic*,
without new machinery — it reuses everything already built (the plugin pattern, `getModules`
+ live-module decoration, `before`/`after` `$all` instrumentation, `Client.createService`).

The shift: instead of the LoadBalancer reaching out to load and observe every service (the
old approach), a **tentacle plugin lives inside each service** and connects *outward* to the
LoadBalancer. The service becomes an active participant; the LB stays a light coordinator
that receives.

---

## The tentacle plugin

A service opts in with one line, exactly like the SystemView plugin:

```js
App.use(LoadBalancer.clone({ url: "http://localhost:4000/loadbalancer" }));
```

**Naming — two names, two roles (not aliases).**

- **`clone`** — the *local, user-facing* half: the plugin `LoadBalancer.clone(opts)` and the
  handle it installs, `this.clone`. The only name a developer touches.
- **`Tentacle`** — the *remote, internal* half: the central module on the LoadBalancer
  (**renamed from `Clones`**) holding register / directory / delegate / broadcast / elect /
  metrics / heartbeat. Developers don't call it directly — `this.clone.*` proxies to it over
  the tentacle's LB connection.

So `clone` is what you write; `Tentacle` is the shared remote it routes to. Because the remote
module is plumbing nobody names in day-to-day code, its name is free to be the vivid one.
**This renames RFC 003's `Clones` module → `Tentacle`** (mechanical rename; tests stay green).

**Configuration — open options object.** `LoadBalancer.clone(options)` follows the
SystemView-plugin shape: recognized keys are handled and any additional config passes through,
so the signature never breaks as options grow.

- `url` (required) — the LoadBalancer to connect to
- `namespace` (default `"clone"`) — the per-module handle name; relocates on collision
- tunables — heartbeat interval, metrics push cadence, routing hints, etc.
- anything else — passed through

The plugin holds **one** client connection to the remote LB (`Client.createService` of the
LB's connectionData) and does five things:

### 1. Owns the service → LB connection & auto-registers
On `ready`, it registers the service with the LB using the service's own connectionData
(URL-first `register`). No manual `register({ url })` calls; no LB-side "load all services".
This single connection is the channel for everything below.

### 2. `this.clone` on every module

At `ready` the tentacle walks `getModules()` and attaches a `clone` handle to each **live
module instance** — *not* to the per-request copy. Because the Router invokes methods on a
per-request `{ ...Module, req, res }` spread, an instance-level `clone` rides into `this` for
free inside request methods:

```js
this.clone.delegate("nightly-report");     // exactly one clone proceeds
this.clone.broadcast("flush-cache", data); // every clone acts
this.clone.elect({ role: "scheduler", holderId });
```

**Instance-only, deliberately — unlike SystemView.** SystemView's logger attaches to the
instance *and* reads per-request data (`this.req`: traceId, arguments) at call time, so it
needs both. The clone methods consume **no request context** (explicit args, proxied to the
remote LB), so the per-request-copy handling is unnecessary. We do less on purpose.

**Also exposed as a capturable handle.** The heaviest users of `delegate`/`elect` are
background paths — schedulers, cron ticks, event callbacks — where `this` is *not* the
module (in an `on(...)` handler `this` is the systemContext; a scheduler has no `this`). So
the tentacle returns/exposes the clone handle directly (e.g. the value of
`App.use(LoadBalancer.tentacle(...))`, or an accessor), so `clone.delegate(...)` works with
no `this`. Instance attachment gives the ergonomic `this.clone` in methods; the captured
handle covers everywhere else.

**Namespace collision throws — it is NOT collision-proof.** A module can define its own
method named `clone`. At `ready`, if any module already has a `clone` property, the tentacle
**throws a clear error** naming the module (fail-fast; never silently override the
developer's method). Escape hatch: `tentacle({ namespace: "cluster" })` relocates the handle
for a project that genuinely needs `clone` as a method.

### 3. Load metrics via `$all` instrumentation
`App.before("$all")` + `App.after("$all")` time and count calls per `module.method`
(count, latency, in-flight) — the same hook the SystemView plugin uses for tracing. These
aggregates are the raw material for intelligent routing.

### 4. Pushes metrics to the LB (push, not pull)
The tentacle periodically pushes its aggregates up its LB connection. The LB never holds N
connections to observe the fleet — each service reports itself. The LB may still
`Client.createService` a *specific* clone on demand when it needs a live handle, but that is
the exception, not the standing mechanism.

### 5. Heartbeats the LB
The same channel carries a heartbeat. This is the **active health signal** that RFC 003's
passive eviction lacked — it drives liveness, eviction, and **re-admission**, and it renews
`elect` leases. Health stops being a hack.

---

## The LoadBalancer side

Consumes tentacle reports to route by real load instead of a blind ring:

- **Pluggable routing policy.** Default stays round-robin. Opt-in strategies read the pushed
  metrics: least-in-flight, weighted, least-latency. The discovery route asks the policy
  which location to return.
- **Connect-time decision (sticky preserved).** Because clients connect once and stick
  (websocket affinity — the reason we chose this model), the intelligent choice is made when
  a *new* client requests connectionData: route the new connection toward the least-loaded
  clone. It does not rebalance an existing connection mid-flight.
- **Heartbeat-driven health.** Eviction/re-admission come from heartbeats, not only from a
  failed discovery fetch.

---

## Removed from the earlier sketch

- **LB-loads-every-service (pull).** Gone — the tentacle pushes from inside. The LB holding
  a live handle to the whole fleet was dead weight once the tentacle exists.
- **Manual registration as the primary path.** `register` remains the underlying LB method;
  the tentacle calls it automatically.

---

## Reuse map (nothing new is invented)

| Capability | Reused from |
|:---|:---|
| `App.use(...)` plugin shape | SystemView plugin pattern |
| `this.clone` on every module | `getModules()` + live-module decoration (this repo) |
| Load metrics | `before`/`after` `$all` (SystemView tracing pattern) |
| `delegate`/`broadcast`/`elect` | RFC 003 `Clones` primitives (now proxied via `this.clone`) |
| On-demand handle to a clone | `Client.createService` |

---

## Files to Change

- `systemlynx/LoadBalancer/tentacle.js` (new) — the plugin: LB connection, auto-register,
  `this.clone` injection, `$all` metrics, push, heartbeat.
- `systemlynx/LoadBalancer/components/Clones.js` — accept metrics + heartbeats from tentacles;
  add a pluggable routing policy consulted by discovery; drive eviction/re-admission from
  heartbeats.
- `systemlynx/LoadBalancer/LoadBalancer.js` — expose `LoadBalancer.tentacle(options)`.
- `systemlynx/LoadBalancer/tests/LoadBalancer.test.js` — tentacle auto-registers; `this.clone.delegate`
  works from inside a real module method; metrics push shifts routing (least-loaded wins);
  heartbeat lapse evicts, heartbeat resumes re-admits.

Documentation ships **with** the feature, not after:

- `LOADBALANCER.md` (new, **project root**) — the full guide: the LoadBalancer, the `clone`
  plugin and its options, `this.clone`, `delegate`/`broadcast`/`elect`, the directory, and
  routing policies.
- `README.md` — a LoadBalancer / cluster section in the main SystemLynx docs.
- `API.md` — expand the existing LoadBalancer section with `LoadBalancer.clone`, `this.clone`,
  the `Tentacle` methods, and routing policies.

---

## Open details (to settle during implementation)

- Metrics push cadence and which aggregates (rolling window vs cumulative).
- Routing-policy interface shape (`(service, metrics) => location`).
- Heartbeat interval + lease/eviction thresholds (reuse the configurable TTLs).
- Exact proxy wiring of `this.clone.*` over the tentacle's LB client.

---

## Verification

Use-case tests — recreate the orchestration, not just shape/connection:

1. `npm test` — RFC 003 suite stays green (implementation changed, behavior preserved).
2. A service using only `App.use(LoadBalancer.tentacle({ url }))` appears registered on the LB
   with no manual `register` call.
3. `this.clone.delegate(key)` called from inside a real module method on N real clones → the
   guarded work runs **exactly once** (the RFC 003 proof, now via the tentacle).
4. The **captured handle** (`clone.delegate(...)`) used from a background/event path (no `this`)
   → also runs exactly once.
5. A module that defines its own `clone` method → the tentacle **throws at `ready`**; with
   `tentacle({ namespace: "cluster" })` the same module loads and `this.cluster.delegate` works.
6. Two clones reporting different load → a new discovery request routes to the least-loaded one
   under the smart policy, and still round-robins under the default.
7. A clone whose heartbeat lapses is evicted; when it heartbeats again it is re-admitted.
