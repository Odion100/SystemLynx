# SystemLynx Default Scaling Strategy

**Monolith-of-record + elastic satellites.** This is the default way to scale a SystemLynx
system. It is deliberately simple: you don't have to design it fully up front. If you follow the
pattern, scaling stays a deployment decision, never a rewrite.

The whole idea in one sentence: **build and deploy as a monolith, keep every monolith behind the
LoadBalancer from birth, and when a service gets hot, clone that one service — it slots into a
seam that was already there.**

---

## The philosophy

The BUAPI/SystemLynx philosophy has always been: **build systems as monoliths, and be *able* to
deploy as microservices** — without committing to the split up front. This strategy takes that
one step further:

> **Always keep it a monolith. Scale by cloning services and modules out of the monolith, not by
> decomposing the monolith into services.**

You never pay the microservices decomposition tax (splitting boundaries, wiring service-to-service
calls, operating N deploy units) *before* you know where the load actually is. You defer that
decision until **load tells you where to scale**, and even then you don't split — you clone.

### Why this works

- **The seam costs nothing until you use it.** Every monolith is born wired through the
  LoadBalancer, so it is already "a URL that returns `connectionData`." That discovery seam sits
  there unused, costing nothing, until the day you extract a hot service and run clones of it — and
  then the clones just *appear* in it. No client changes, no re-architecture.
- **Boundaries are real, but movable.** You don't avoid boundaries — you build clean ones from the
  start. What you avoid is *committing them to a deployment topology*. A module can be moved to
  another service, or a service extracted and cloned, without a rewrite, precisely because the
  separation was already there. You scale the hot path by data, not by guess.
- **You extract at service/module granularity — you do not duplicate the app.** The clone's deploy
  unit is the *extracted service*, not the whole monolith. The monolith stays the one monolith; the
  hot service simply also runs as its own instance(s), registered alongside, and the LoadBalancer
  balances across them.

---

## Built separated, deployed together — split on demand

A SystemLynx project is made of **multiple services and multiple modules**, built with clean
separation so they *can* be split. The default deployment collapses all of them into **one monolith
— a single process** — that acts as the center. The LoadBalancer fronts that center from birth.

Because the separation is real, individual services (or modules) can be **split out and run behind
the same LoadBalancer, on top of the monolith**, whenever load calls for it:

- **Deploy as one center monolith.** Every service and module runs in a single process. You get all
  the monolith wins for free — one deploy, one runtime to reason about, in-process calls, local
  transactions.
- **Split on demand.** The clean seams mean any hot service can be extracted and run as its own
  instance(s), registered with the LoadBalancer alongside the monolith. Clients don't notice — the
  LB serves the same `connectionData` whether the service is in-process or split out.
- **The monolith stays the center of gravity.** You are not shattering it into microservices. You
  are peeling off exactly the pieces that need to scale, while the bulk of the system stays
  together. The split is *late, targeted, and reversible.*

This is the enabling property the whole strategy rests on: **build separated, deploy together, split
on demand.** It only holds if the separation stays disciplined — every cross-service call written as
if it were already remote (which is exactly how SystemLynx calls work, local or not), no service
reaching into another's in-process state. Keep the seams network-shaped and extraction stays free.

## The shape

Instead of scattering a swarm of tiny microservices, you deploy a handful of **solid monoliths**
— for example, four across the country — each surrounded by clones of whatever services are hot
there. Picture it as regions, each region a monolith + its satellites:

```
        DNS / CDN  (picks the region — geo-routing / anchor / edge cache)
              │
     ┌────────┼────────┬──────────────┐
     ▼        ▼        ▼              ▼
  Region A  Region B  Region C     Region D
     │
  ┌──┴───────────────────────┐
  │  LoadBalancer (the seam)  │   ← picks the clone inside the region
  └──┬───────────────────────┘
     │
  ┌──┴── monolith (of record)
  ├───── clone of hot Service X
  ├───── clone of hot Service X
  └───── clone of hot Service Y
```

### Two sticky layers at different grains

The routing decomposes into two independent, sticky choices:

| Layer | Decides | Mechanism | Stickiness |
|:---|:---|:---|:---|
| **DNS / CDN** | *Which region* a client lands in | Geo-routing / anycast; CDN for edge + static | Per-client, geographic |
| **LoadBalancer** | *Which clone* inside the region | Discovery = balancing (round-robin / least-load) | Per-connection, connect-time |

DNS picks the region; the LoadBalancer picks the clone. Each layer is sticky at its own grain,
and neither needs to know about the other.

---

## How it maps to SystemLynx primitives

Everything the strategy needs already exists in the framework (see `LOADBALANCER.md` for the full
API):

- **Born behind the LB.** A monolith registers its services with the LoadBalancer. The LB is just
  "a URL that returns `connectionData`," round-robined (or load-aware) across live clones. The
  choice is made **once, at connect time**, and stays sticky — which is exactly what a
  WebSocket-stateful system wants.
- **Cloning is one line.** A hot service joins the cluster with
  `App.use(LoadBalancer.clone({ url }))`. It auto-registers, gets a `this.clone` handle on every
  module, and starts reporting load. Nothing else changes.
- **Coordination across clones** comes from the `Tentacle`, reached via `this.clone`:
  - `this.clone.delegate(key)` — run a task **exactly once** across the cluster (at-most-once).
  - `this.clone.broadcast(key, data)` / `this.clone.on(key, cb)` — **every** clone acts.
  - `this.clone.elect({ role, holderId })` / `resign` — a **durable single leader** (crash-safe).
- **Transparent failover falls out of the seam.** Because clients bootstrap through the LB, their
  reconnect (`serviceUrl`) points back at the LB. If the clone a client is talking to dies
  mid-call, the client transparently re-fetches, lands on a *live* clone, and the same call
  completes — the caller never sees the failure.

---

## Where it stays free

For **stateless or read-mostly** services this is essentially free: clone, register, done. The
`delegate` / `broadcast` / `elect` primitives cover the coordination you need ("one of them should
act" / "all of them should act" / "one durable leader"), and failover is automatic.

This is the majority of a real system. Lean on it.

---

## Where it needs real thought — the data tier

The monolith framing quietly hides the one thing that *doesn't* come for free: **state.**

A clone of a *stateful* service still points at a shared backing store. Four monoliths across the
country is not four app servers — it is **four regions of data**, and DNS/CDN does nothing for
that. The questions the strategy does **not** answer for you, and that you must answer per system:

- **Who owns writes?** Read-replicas everywhere + writes routed to a home region? True
  multi-master with conflict resolution? Single-writer with regional read caches?
- **Consistency vs. latency.** How stale can a region's read be? What's the replication path and
  lag budget?
- **Failover of the data tier**, not just the app tier — the app failover above only moves you to
  a live *clone*, which is still pointed at the same store.

The app tier scales beautifully under this pattern. **The data tier is where the real design work
lives**, one layer below where the pattern is elegant. Name it explicitly for every system; don't
let "it's just a monolith" hide it.

---

## Known boundaries of the current primitives

Worth knowing before they bite:

- **`delegate` / `elect` are per-LoadBalancer.** Coordination is scoped to a single region's
  `Tentacle`. So "run this once" is **once per region**, not once globally. Four regional LBs mean
  a nightly job fires four times — one per region. That's usually *what you want* (each region
  does its own work). But genuine **global-once** (a single leader across the whole fleet) needs a
  tier above the regional LBs — e.g. one elected "primary" region — because the per-region tentacle
  doesn't promise it.
- **The LoadBalancer is the region's front door.** At real scale it wants to be replicable too. It
  is nearly stateless (a registry that rebuilds from re-registration), so it can sit behind the
  same DNS trick — but that's something to *design*, not discover.

---

## The one-paragraph version

Build it as a monolith. Wire it through the LoadBalancer from day one so discovery — and therefore
balancing — is already there for free. Deploy a few solid monoliths across regions; let DNS/CDN
pick the region and the LoadBalancer pick the clone. When a service gets hot, clone *that service*
and it slots into the seam with zero client changes. Coordinate clones with
`delegate`/`broadcast`/`elect`. Lean on it freely for stateless/read-mostly work, and spend your
real design budget on the data tier and on global-vs-regional coordination — the two things the
pattern deliberately leaves to you.
