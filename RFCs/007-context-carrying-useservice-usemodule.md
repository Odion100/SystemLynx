# RFC 007 — Context-carrying `useService` / `useModule` (caller-bound copies)

## Motivation

Two SystemView needs converge on the **same seam** — the points where one piece of code reaches for
another:

1. **Trace propagation.** RFC 005's client hooks are the *surface*, but they can't bridge context on
   their own: when a module handling request R calls another service, that outbound call is decoupled
   from R (the shared client has no back-reference). Something has to carry R's trace to the call.
2. **Coupling observability** (SystemView's coupling gap). To show what's coupled so you can scale,
   SystemView needs to know *which modules load which* — the caller→callee graph.

Both hang off `useModule` (module→module, same service) and `useService` (module→service). Instrument
that seam once, get both.

## The problem today

`useService` / `useModule` (`utils/SystemContext.js`) return the **shared** instance:

```js
context.useService = (name) => (system.services.find(s => s.name === name) || {}).client || {};
```

- **Arrow function** → `this` inside is the closure, not the caller. No way to know who called, or to
  attach their context.
- **Shared instance returned** → the outbound call is decoupled from the request that triggered it, and
  there's nothing to record the coupling on.

## Design

### 1. Regular functions, so `this` is the caller

Change `useService` / `useModule` from arrow functions to regular functions. Called as
`this.useService("B")` inside a method, `this` is the module instance handling the request — with
`req` and whatever SystemView stashed on it (the trace).

### 2. Return a shallow, caller-bound copy

Instead of the shared instance, return a **shallow copy** — shares the transport/socket/connection,
carries its own per-call context (headers + a reference to the caller). This is the pattern SystemLynx
already uses (`Modules()` bound copies, the per-request module clone the Router hands you); this extends
it to `useService`/`useModule`. Because the copy is per-call, there's no shared header state to race on.

### 3. The copy carries the caller → the trace bridge

The copy holds the caller's context. When it makes its outbound call and the RFC-005 client `before`
hook fires, the originating trace is reachable *on the copy* — no ALS, no ambient store. Context rides
the object graph: **caller → copy → hook**. SystemView stamps it via `this.setHeaders(...)`, not
overriding a trace already present.

### 4. The coupling signal

At the `useService`/`useModule` call, record the caller→callee edge (a local `$emit`, observable by a
co-loaded SystemView plugin the way the LB events are). That *is* the coupling graph SystemView needs
for scaling reports — same seam, essentially free.

## The `this` safety concern (real, small, guarded)

Regular functions make `this` depend on the call site. Normal `this.useService()` → the module. A
*detached*/destructured call → `this === undefined` (strict mode — **not** `window`/global; every file
is `"use strict"`, so the worst case doesn't arise).

Defense: **brand modules.** A non-enumerable `Symbol` (e.g. `Symbol("systemlynx.module")`) set on module
contexts and carried onto the shallow copies. `useService` checks it:

- branded `this` → capture as the caller (full context/trace bridge).
- unbranded / `undefined` → **degrade to today's behavior**: return the shared client, no caller
  context, no trace. Never throws, never attaches a stray object.

## The `this = module` contract must hold at every entry point

Caller-capture (and the brand) assume every user-supplied function runs with `this` = the (branded)
module. Audit of where SystemLynx runs user code:

| Entry point | `this` today | Holds? |
|:---|:---|:---|
| Method call (`Router.js` `Module[fn].apply({ ...Module, req, res }, …)`) | per-request module copy | ✓ |
| `before`/`after`, incl `$all` (`ServerManager.js` `middleware.apply(req.Module, …)`; `$all` is just the default bucket) | per-request module copy (`req.Module`) | ✓ |
| Event `.on`/`.once` (`Dispatcher.js` `fn.bind(systemContext)`) | the **static `systemContext`** | ✗ |

**Method calls and all middleware (including `$all`) already satisfy the contract.** The gap is
**events**: handlers bind to the static `systemContext`, not the module — so `this.useModule/useService`
work, but `this` isn't the module and carries no brand. Fix (in scope for this RFC): `Dispatcher.on`/
`once` bind to the **module** (the dispatcher object) instead of `systemContext`. The module is a
superset of `systemContext`, so it's backward-compatible; a test must confirm nothing relied on
`this === systemContext` by identity. Events fire outside any request, so their `this` is the shared
module (no per-request copy, no caller) — the brand check finds a module and degrades gracefully, which
is correct.

## Relationship

- **RFC 005** (client hooks) is the surface the trace is stamped through; **this RFC is the bridge**
  underneath that gets the trace *to* the hook.
- Answers **SystemView's coupling gap** as a side effect of the same instrumentation.
- Independent of **RFC 006** (module-level cloning), though both touch how the client resolves services.

## Open questions

- **Shallow-copy boundary** — exactly what's shared (socket, connectionData, module proxies) vs
  per-copy (headers, caller ref). Must stay cheap; `useService` is a hot path.
- **Brand propagation** — a non-enumerable Symbol won't survive `spread`/`Object.assign`; the copy step
  must set the brand explicitly (or the brand lives somewhere the shallow copy preserves).
- **Coupling event shape** — what the caller→callee edge record carries (names, locations, method).
- **Caller-context lifetime** — the copy references the caller; ensure it doesn't pin request state
  longer than the call.
- **`useModule` copy or edge-only** — does module→module need the caller-bound copy too, or just the
  coupling edge (same-process, so no header/trace transport needed)?
