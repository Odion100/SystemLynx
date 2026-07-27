# SystemView needs local module-coupling visibility — who calls / emits-to whom, in-process

SystemView's Reports layer wants a **Module Coupling** view: within one service, which local modules
are wired to which — so you can answer *"if I extract module B into its own service, what breaks?"*
It's the **extraction-readiness map**, and it's the decision you actually make when scaling out an
individual module.

This is **distinct from cross-service topology** (RFC-005, `x-sv-trace`). That one is the *post*-split
picture (service A → service B over the wire) and needs trace propagation. This one is the *pre*-split
picture and is entirely **in-process** — no trace propagation, no network. Different feature, arguably
more directly useful for the scaling call, and cheaper to instrument because nothing leaves the process.

## Two coupling channels — extraction breaks both

1. **Direct calls.** Module A resolves B via `useModule("B")` and calls `B.bar()`. Extract B → that
   call becomes a network hop (latency + a new failure surface).
2. **Local events / "actions".** A `$emit`s an event, B `.on`s it. Extract B → that event has to cross
   the wire, or it silently stops firing. This is the sneakier channel: a module can look
   call-independent yet be event-coupled.

The graph has to carry **both**, weighted by frequency, so a loosely-coupled module (safe to split)
is visibly distinct from one buried in a dense cluster of high-frequency edges.

## Why today's data can't see it

- **The `$all` middleware is request-scoped.** SystemView's traces come from `App.before/after("$all")`,
  which only fire on HTTP/WS requests through the Router. A module-to-module call is a **direct
  bound-method call** — it never hits the Router, so `$all` never sees it. The trace stream is blind to
  local coupling by construction.
- **`useModule` has no caller and no hook.** `utils/SystemContext.js:4` — `useModule(name)` returns
  `system.modules.find(...).module` (the raw live module). When A does `this.useModule("B")`, `this`
  is the shared `SystemLynxContext`, not A — so there's no way to attribute the **A→B** direction, and
  no emission to observe.
- **The `App.config` interception hack is insufficient.** `App.config` does run before modules
  (`App/components/initializeApp.js:24` calls the config `__constructor`, then `next()` →
  `loadModules`), and its `this` is a `SystemLynxContext`. But overriding `useModule` there still can't
  see the caller (per above), doesn't cover the event channel, and the config context isn't guaranteed
  to be the same instance a module's callbacks use (App and config each build their own via
  `SystemLynxContext(system)`). A plugin-side alternative — wrap every module method on `ready` and
  keep a caller stack — captures direct calls but breaks across `await`s without ALS (which RFC-005
  deliberately avoided). Net: a hack can *approximate* the graph, not cleanly attribute it.

## What SystemView wants (the observability contract — impl is yours)

In-process signals, emitted with the same local `$emit` pattern the LoadBalancer just adopted
(`route_assigned`), so a co-loaded SystemView plugin subscribes with `.on(...)`:

1. **Attributed call edges.** When module A invokes a method on module B (via a `useModule` handle),
   surface `{ from: "A", to: "B", method: "bar" }`. The crux is **caller attribution** — the framework
   knows which module's execution is active at the resolve/invoke point; SystemView can't recover that
   from outside. (Whether that's `useModule` learning its caller, or a wrapper around the returned
   handle, or a current-module marker around method dispatch — your call.)
2. **Attributed event edges.** When B subscribes (`.on(evt)`) to an event A `$emit`s, surface the
   `A --evt--> B` edge (e.g. a registry of `{ emitterModule, event } → subscriberModules`, or an
   emit-time signal carrying the emitting module). Counts per edge = coupling strength.

Both are local-only (`$emit`, never socket-broadcast), in-process, and need **no** trace propagation.

## Payoff

A **Module Coupling** report per service: nodes = local modules, edges = call-frequency + event
subscriptions. Overlaid on the per-method load Reports already track, it becomes the extraction story:
*"Payments calls Users 400×/min and emits `order.paid` that Ledger listens to — pull Payments out and
Users becomes a hot cross-service dependency, and `order.paid` has to go over the wire; Ledger is
loosely coupled, safe to split."* Nobody else can draw that map, because nobody else holds the local
call/event graph next to the load.

## SystemView-side (not a SystemLynx ask)

Rendering the graph, weighting edges, and the extraction narrative are SystemView's job. The only ask
here is the two attributed in-process signals above — the caller/emitter identity SystemView can't get
from outside the framework.
