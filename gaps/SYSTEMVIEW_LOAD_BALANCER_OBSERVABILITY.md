# Observing the load balancer from SystemView — what already exists, and the few small things that don't

SystemView (separate product) is growing a **Reports** layer with a **load-balancer behavior window**
(SystemView `RFCs/RFC-015-systemview-reports.md`). This documents how it observes the SystemLynx load
balancer. **Most of it rides mechanisms SystemLynx already has** — the honest list of genuinely-missing
pieces at the bottom is short. (An earlier draft of this doc overstated a "plugin can't get a handle"
gap; that was wrong — see "What already exists.")

## The architectural fact that dictates the design

The load balancer is a SystemLynx service (`LoadBalancer.js`: `Service()` + a `Tentacle` module). Its
cluster state — `Tentacle.services`, `Tentacle.loads`, `Tentacle.policy`, the round-robin index — lives
**in the LoadBalancer's own process**. A *clone* (a member service) holds only the clone handle
(`this.clone` → `delegate/broadcast/elect/resign` + `.on` for received broadcasts, `clone.js`); it
cannot read cluster state in-process, because that state is in another process.

**So the natural way to observe the cluster is to be *in* the LoadBalancer.** The LB is a normal app —
`module.exports = function LoadBalancer(){ ... return { ...App, Tentacle, clone } }` — so it takes a
plugin like any other service:

```js
const LB = LoadBalancer();
LB.use(systemview({ projectCode: "infra", serviceId: "loadbalancer" /* … */ }));
```

Loaded there, the SystemView plugin gets `App`, and on `ready` reads the Tentacle in-process
(`App.getModule("Tentacle")` → `services` / `loads` / `policy`) and subscribes to its **local** events.
The LB simply reports to SystemView the way every other service already does. This is the *primary*
mechanism, not a fallback.

The other half of the window — **per-clone traffic, latency, error rate** — needs nothing new: every
clone already runs the SystemView plugin, so those traces already flow. SystemView just needs to know
*which locations are clones of one service*, which the Tentacle registry answers.

## What already exists (so we ride it — no framework work)

- **A plugin already gets `App` (+ `system`).** `App.use(plugin)` → on init, `plugin.apply({}, [App,
  system])` (`App/App.js`). Full local access: `before/after`, `on/emit`, `getModule(s)`, `Modules()`.
- **Live handles on `ready`.** The SystemView plugin already does `sv = this.useModule("SystemView")`
  and iterates `App.getModules()` on ready today (`systemview-plugin/index.js`). Same path reaches
  `App.getModule("Tentacle")` inside the LB.
- **The clone already exposes a capturable handle.** `clone.js` installs `App[namespace]` (`App.clone`)
  "as a capturable handle for background/event code" and emits `App.emit("clone_ready", handle)`. An
  observer captures it by listening for `clone_ready` — no ordering guesswork.
- **Local events are `$emit`, and this is a deliberate, existing capability.**
  `ServerManager/components/SocketEmitter.js:15`: *"use $emit to emit events locally only"*
  (`Emitter.$emit = Emitter.emit`), while plain `.emit` also broadcasts over sockets and emits locally.
  The framework already uses this **for exactly this purpose**: `ServerManager/components/Router.js:62`
  `Module.$emit("error", …)` *"so server-side observers (e.g. a SystemView plugin) can monitor
  failures. $emit does not broadcast."* Subscribing to local events is a solved problem.

## What's actually missing (the short, honest list)

1. **A routing-decision local event.** The Tentacle picks a location at connect-time (`nextLocation` /
   least-load) but emits nothing about the choice, so **balance fairness** can't be observed directly.
   Add one line where the decision is made: `Tentacle.$emit("route_assigned", { service, location,
   policy })`. This is the single highest-value addition — and it's one `$emit`, using the mechanism
   that already exists. (The lifecycle events `new_clone` / `new_service` / `location_removed` are
   already emitted; we just subscribe.)
2. **(Optional) a stable read accessor for cluster state** — `Tentacle.getClusterState() → { services,
   loads, policy, ttls }` — so SystemView reads a documented contract instead of internal fields the
   rewrite may rename. Nice-to-have, not required to ship.
3. **A clone connection-health signal** — a last-push timestamp / connected flag — so "registered but
   silently dead" is detectable (cf. `gaps/LOADSERVICE_HANGS_SILENTLY_OVER_SELF_SIGNED_HTTPS.md`).
4. **Prerequisite, not optional: the circular-reference guard on emit.**
   `systemlynx/gaps/EMIT_CRASHES_HOST_ON_CIRCULAR.md` — `SocketEmitter.emit` has no circular guard; a
   payload with a circular object throws uncaught and drops the service. Reports rides *more* structured
   data over emits, so this guard has to land alongside.

## Explicitly NOT needed

- **No new remote methods.** We are not asking the LB/Tentacle to expose RPC surface for us — in-process
  reads + local `$emit` cover it.
- **No handle-acquisition mechanism.** `App` + `system` + `getModules` + `clone_ready` already provide
  the handle; the earlier "plugin can't reach a co-loaded plugin" framing was wrong.
- **No new event system.** `$emit` (local-only emit) plus plain `.on(...)` to subscribe is already the local-event transport — there is no `$on`; `.on` catches local emits because both `.emit` and `$emit` fire the dispatcher's local listeners.

## SystemView-side (for the record, not a SystemLynx ask)

The SystemView plugin will stamp each trace record with the clone's `location`/`serviceId` (it already
holds `serviceId` in config and `connectionData.serviceUrl` on ready) so per-clone attribution works off
the existing trace stream.

---

## SHIPPED (SystemLynx 3.1.0) — what we actually built vs the list above

This gap doc is the spec of record; no separate RFC. Three scoping calls differ from the "what's
missing" list — captured here so asked-vs-delivered is explicit:

1. **`route_assigned` — shipped as a local `$emit`.** Emitted at the single routing decision point in
   `Tentacle.pickLocation` (both round-robin and least-load paths): `Tentacle.$emit("route_assigned",
   { route, location, policy })`. `$emit`, not `.emit`, so cluster telemetry stays in-process and is
   never socket-broadcast to clients. The existing lifecycle events (`new_clone`/`new_service`/
   `location_removed`) were **left on `.emit`** deliberately — not churned — since a local observer's
   `.on(...)` catches both.
2. **`getClusterState()` — shipped now, not deferred as "optional."** Because the LoadBalancer was just
   rewritten, letting SystemView read raw `Tentacle.services`/`loads`/`policy` would weld it to fields a
   future refactor may rename. `Tentacle.getClusterState()` returns a read-only snapshot
   `{ policy, services, loads, ttls }` (copies — mutating it never touches live state).
3. **Circular-emit guard — shipped as the prerequisite** (`systemlynx/gaps/EMIT_CRASHES_HOST_ON_CIRCULAR.md`).
   `SocketEmitter.emit` now wraps the socket.io encode in try/catch: a bad payload **logs a one-line
   stderr warning** (the baseline visible signal — a local `"error"` event alone is invisible when
   nothing is subscribed), **also** surfaces that local `"error"` event for programmatic observers, and
   drops the one message instead of killing the process; the local `$emit` of the original event still
   fires regardless. Sanitizing payloads remains out of scope by design.

**Deferred:** the explicit clone connection-health *flag* (item 3 of the missing list). It's derivable
today from `loads`'s `seen` timestamp, so it's polish, not a v1 blocker.

**Tests:** `route_assigned` fires with the chosen clone + policy; `getClusterState()` shape + copy
semantics; and the emit guard contains a real circular-payload throw (surfaces an error, keeps local
delivery) — see `LoadBalancer.test.js` (observability) and `SocketEmitter.test.js`.

**Still SystemView's job (not ours):** stamping `location` on trace records, LB-mode detection, the
in-LB reads/subscriptions, and the Reports UI window.
