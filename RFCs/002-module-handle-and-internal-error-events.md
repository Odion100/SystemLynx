# RFC: Module Handle + Internal Error Events

## Context

SystemView is a SystemLynx plugin (installed via `App.use`) that wants to act as the
observability/logging layer for a SystemLynx service — monitoring requests and errors
under the hood, and letting modules log through SystemView.

Today the plugin gets `(App, system)` but has no *supported* way to reach the live module
objects, and SystemLynx emits **no internal events** on the request/error lifecycle. This
RFC adds the minimal SystemLynx-side surface to enable that. **All SystemView-specific
behavior (the log function, the monitoring sink) lives in the SystemView plugin, not in
SystemLynx.** SystemLynx only exposes access + an emit point.

---

## Two gaps, two changes

### Gap 1 — No supported handle on the live modules

A plugin receives `App` and `system`, and live modules already exist at
`system.modules[i].module` after construction. But:

- Reaching into `system.modules[].module` couples the plugin to internal shape.
- At `plugin.apply` time the modules are **not built yet** — `system.modules` holds only
  `{ name, __constructor }`. The live `.module` is assigned later in `loadModules`, right
  before `App.emit("ready", system)`.

**Change:** Add `App.getModules()` (and `App.getModule(name)`) returning the live module
objects. Returns them after `ready`; empty/undefined before.

### Gap 2 — Errors bypass the lifecycle

`before`/`after` middleware already let a plugin observe the request happy-path. But every
error to the client funnels through `res.sendError` in `Router.js`, which writes the HTTP
response and **does not call `next()`** — so afterware and the response middleware are
skipped. `after` hooks never see failures.

**Change:** Emit a **local-only** `"error"` event on the module from inside `sendError`.
The failing client already receives the error over HTTP; this event is purely for
server-side observers. Use `$emit` (local) **not** `emit` (which would broadcast the error
over websockets to every connected client).

---

## Files to Change

### 1. `systemlynx/App/App.js`

Add module accessors. The live module is at `system.modules[i].module` once built.

Three accessors, split by intent — **raw handles for mutation, bound copies for calling**:

```js
// Raw live handles — for a plugin to decorate/observe the real module.
App.getModule = (name) => {
  const found = system.modules.find((m) => m.name === name);
  return found ? found.module : undefined;
};

App.getModules = () =>
  system.modules.reduce((obj, { name, module }) => {
    if (module) obj[name] = module;
    return obj;
  }, {});

// Callable, `this`-bound copies keyed by name — for invoking methods locally.
const bindModule = (module) =>
  Object.keys(module).reduce((bound, key) => {
    bound[key] =
      typeof module[key] === "function" ? module[key].bind(module) : module[key];
    return bound;
  }, {});

App.Modules = () =>
  system.modules.reduce((obj, { name, module }) => {
    if (module) obj[name] = bindModule(module);
    return obj;
  }, {});
```

- **`getModule(name)` / `getModules()`** return the **raw live module(s)** keyed by name.
  Mutating one (attaching a listener, assigning `log`) affects the real module the Router
  invokes — this is what the plugin needs to **decorate** modules.
- **`Modules()`** returns **callable copies** whose methods are bound to the live module,
  so `this` (emit/$emit/useService/useModule) resolves correctly on a local call, even if
  a method is detached. `this.req`/`this.res` are `undefined` locally, which the method
  handles. Binding a *copy* (not the live methods) is required: a hard-bound method would
  ignore the Router's per-request `Module[fn].apply({ ...Module, req, res }, args)`, so the
  live methods must stay unbound for the HTTP path.

All only return live modules after the `ready` event (before that, `module` is undefined).
Consumers call these inside an `App.on("ready", ...)` handler.

### 2. `systemlynx/ServerManager/components/Router.js`

Emit a local `"error"` event from the single error chokepoint, `sendError` (inside
`parseRequest`). `req.Module` is the live module dispatcher.

```js
const sendError = (error) => {
  const status = (error || {}).status || 500;
  const message = (error || {}).message || unhandledMessage;
  if (req.Module && typeof req.Module.$emit === "function")
    req.Module.$emit("error", {
      module_name,
      fn,
      arguments: req.arguments,
      status,
      message,
      error,
    });
  res.status(status).json({ ...presets, ...error, status, message, SystemLynxService: true });
};
```

The payload carries the call identity (`module_name` + `fn`) and the inputs
(`arguments`) so an observer can reconstruct what was called and with what. The raw
Express `req` is intentionally **not** included — args-only keeps the event lean; if a
consumer later needs headers we can revisit.

`$emit` is the local-only emitter installed by `SocketEmitter` (see `SocketEmitter.js` —
`Emitter.$emit = Emitter.emit` before `emit` is overridden to broadcast). Guard with a
typeof check so a module without SocketEmitter applied doesn't throw.

---

## Files NOT Changed

- `systemlynx/ServerManager/components/SocketEmitter.js` — `$emit` already exists; we only
  consume it.
- `systemlynx/Service/Service.js` — module construction unchanged.
- HTTP response shape — unchanged; the `"error"` event is additive and server-side only.

---

## Plugin-side usage (for reference — lives in SystemView, not this repo)

```js
App.use((App, system) => {
  App.on("ready", () => {
    Object.entries(App.getModules()).forEach(([name, module]) => {
      module.on("error", (info) => { /* SystemView records the failure */ });
      module.log = (...args) => { /* SystemView log routing */ };
    });
  });
});
```

---

## Verification

1. `npm test` — existing suite stays green (changes are additive).
2. New test: register a module whose method throws, call it over HTTP, assert the module's
   local `"error"` event fired with `{ module_name, fn, status, message, error }` and that
   the event did **not** go out over the websocket.
3. New test: `App.getModule(name)` returns the live module after `ready`, undefined before.
4. Confirm the failing HTTP response body is unchanged from current behavior.
