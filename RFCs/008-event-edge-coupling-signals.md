# RFC 008 — Event-edge coupling signals (who-listens-to-whose-events)

## Motivation

SystemView's **Module Coupling** report (the extraction-readiness map: *"what breaks if I pull this
module into its own service?"*) needs both in-process coupling channels. RFC 007 shipped the first —
**call edges** (`use_module` / `use_service` `{ from, to }` when A resolves B). This RFC ships the
second — **event edges**.

An event edge is the sneaky channel. Module A does `this.$emit("order.paid", …)`; module B, elsewhere,
did `this.useModule("A").on("order.paid", handler)`. Nobody called anybody — but B now depends on A's
event. Extract A into its own service and `order.paid` has to cross the wire, or B silently stops
hearing it. SystemView must draw `A --order.paid--> B` to make that dependency visible next to the load
numbers it already tracks.

This is the remaining, un-shipped half of the coupling gap (`gaps/SYSTEMVIEW_LOCAL_MODULE_COUPLING.md`,
item 2).

## The problem today

When B does `this.useModule("A").on("order.paid", handler)`, the callback lands in **A's** event
registry (`Dispatcher.on`). Inside `.on`, `this` is A (the emitter / dispatcher the method lives on) —
the identity of B (the subscriber) is already gone. The framework held B for one instant, at the
`useModule` resolve, and threw it away. An outside observer never sees B at all.

Two further gaps block reliable attribution even if we recover B:

1. **`useModule` returns the raw module** (`utils/SystemContext.js`) — no `__caller`, so a following
   `.on` can't see who subscribed. (`useService` already returns a caller-bound view; `useModule` does
   not.)
2. **Server modules have no stable name.** The existing call-edge `from` falls back to
   `caller.req.module_name`, which is **blank unless a request is in flight**. But subscriptions almost
   always happen at **boot** (in the module constructor), where there is no request — so both call-edge
   `from` and any event-edge attribution come out empty.

## Design

Three changes; the first two are foundational and also harden the call edges RFC 007 already shipped.

### 1. Stamp server modules with a stable `__name`

At `ServerManager.addModule(name, Module, …)` — the one place the name is known — attach a
non-enumerable `__name` to the module:

```js
Object.defineProperty(Module, "__name", { value: name, configurable: true });
```

Non-enumerable so it never leaks into `parseMethods` / method exposure / JSON. This makes module
identity available at boot (not just during a request), fixing call-edge `from` and enabling
event-edge attribution in one shot.

### 2. `useModule` returns a caller-bound view

Mirror `useService`: instead of the raw module, return a lightweight `Object.create(module)` that
carries `__caller`, so a `.on` / `.once` invoked on it can read who subscribed. Method calls are
unaffected (they resolve through the prototype chain). Degrades to the raw module when there is no
caller.

```js
context.useModule = function (modName) {
  const caller = callerOf(this);
  emitCoupling(caller, "use_module", modName);
  const mod = (system.modules.find((m) => m.name === modName) || {}).module || {};
  if (!caller) return mod;               // no caller — return the shared module unchanged
  const bound = Object.create(mod);
  bound.__caller = caller;
  return bound;
};
```

Safe because: the subscription (`.on`) happens **synchronously** right after `useModule`, so there is
no `await` between resolve and subscribe — no ALS needed (consistent with RFC 007's deliberate
avoidance of async-context tracking). `useService` has returned a bound view this way since 007.

### 3. Emit the edge in `Dispatcher.on` / `.once`

When `.on` / `.once` is invoked on a caller-bound view (`this.__caller` present), fire a **local-only**
coupling signal on the subscriber module — same `$emit` pattern as the call edges and `route_assigned`,
never socket-broadcast:

```js
const caller = this && this.__caller;
if (caller && typeof caller.$emit === "function")
  caller.$emit("event_subscription", {
    from: caller.__name,                 // subscriber (the module that listened)
    to: (this.__name) || undefined,      // emitter   (the module that owns the event)
    event: eventName,
  });
```

`from` = subscriber, `to` = emitter — consistent with the call edges (`from` is the module taking the
action, `to` is the module it now depends on). Guarded: no `__caller`, or a caller that can't `$emit`,
is a silent no-op — today's behavior.

### Direction & shape recap

| edge kind | signal | from | to |
| --- | --- | --- | --- |
| call (RFC 007) | `use_module` / `use_service` | caller | callee |
| event (this RFC) | `event_subscription` | subscriber | emitter |

## Scope

- **Structural edge only.** The signal fires **once, at subscription** — the fact that B listens to A's
  `order.paid`. It does **not** fire on every `$emit`. Per-edge *frequency* (coupling strength) is left
  to SystemView, which already observes actual event deliveries; emitting on every fire would be hot-path
  noise. (Revisitable if a real need appears.)
- **Local-only.** `$emit`, never `.emit` — cluster/coupling telemetry stays in-process, exactly like
  `route_assigned` and the call edges.
- **No trace propagation.** In-process, pre-split picture. Distinct from the cross-service `x-sv-trace`
  seam (RFC 005 / 007's post-split picture).

## Non-goals

- Rendering the graph, weighting edges, the extraction narrative — SystemView's job.
- Emit-time frequency counting (see Scope).
- Attributing subscriptions made **without** `useModule` (a module holding a direct reference). The
  canonical resolve seam is `useModule`; that is where the framework can attribute.

## Testing

Usage-shaped (the test doubles as the how-to):

1. Module A's constructor does `this.useModule("B").on("ping", …)`; assert A `$emit`s
   `event_subscription` with `{ from: "A", to: "B", event: "ping" }` at boot (no request in flight).
2. `.once` carries the same attribution.
3. Method calls through the bound `useModule` view still work, and RFC-007 handler binding is unchanged.
4. No caller (detached call) ⇒ no signal, raw module returned (graceful degrade).
5. Regression: the call edges (`use_module` / `use_service`) now carry a non-empty `from` at boot,
   courtesy of `__name`.

## Rollout

Additive and non-breaking (new event, bound view is a superset of the raw module, `__name` is
non-enumerable). Minor version bump. Mirror into `systemlynx-client` only where applicable — event-edge
coupling is a **server-side** module concern; the client mirror gets the `__name` stamp / bound-view
parity only if the ESM client's module resolution needs it (verify during implementation, don't mirror
blindly).
