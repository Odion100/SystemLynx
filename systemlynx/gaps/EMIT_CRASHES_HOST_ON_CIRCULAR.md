# A single bad emit payload crashes the whole service

`SocketEmitter.emit` is the chokepoint every websocket event flows through — every `Module.emit(...)`
in every service, plus anything built on top (e.g. the SystemView plugin's trace emit). It hands the
payload straight to socket.io with no guard:

```js
// ServerManager/components/SocketEmitter.js
Emitter.emit = (name, data) => {
  const id = shortid();
  const type = "WebSocket";
  socket.to(name).emit(name, { id, data, type });   // ← encodes synchronously; throws here
  Emitter.$emit(name, data);                          // ← local emit; never runs if the line above throws
};
```

socket.io encodes the packet **synchronously** inside `socket.to(name).emit(...)`, and its parser
walks the whole object graph (`hasBinary`) with no cycle guard. If `data` contains a circular
reference, that walk recurses to a stack overflow and the exception propagates straight out of
`Emitter.emit` **uncaught** — the process dies:

```
RangeError: Maximum call stack size exceeded
    at hasBinary (socket.io-parser/.../is-binary.js)
    at Encoder.encodeAsString (socket.io-parser/.../index.js)
    at Adapter.broadcast (socket.io-adapter/...)
    at SocketEmitter.Emitter.emit (systemlynx/.../SocketEmitter.js:21)
```

`[nodemon] app crashed`.

## How we hit it

A traced method threw while a **Mongoose `Query`** sat in `req.arguments` (idiomatic — query
middleware sets `req.arguments[0] = Model.where(filter)`). A `Query` holds a live handle to the
driver's connection topology, which is circular
(`collection → db → topology → sessionPool → topology`). The observability layer emitted an error
trace carrying those arguments → `Emitter.emit` → line 21 → stack overflow → the service was gone.
Because it fires on the *error* path, the symptom is severe: one thrown error and every subsequent
call hangs (the service is dead), and any consumer awaiting an emitted event waits forever.

## What is and isn't systemlynx's job here

To be clear about scope: **systemlynx should not silently sanitize or decycle app payloads.** If a
caller emits junk, rewriting it behind their back is the wrong behavior — clean data is the caller's
responsibility (and the app/plugin layers own that).

But there is a distinct, legitimate framework responsibility: **`emit` must never turn a bad payload
into a dead process.** "You emitted something unserializable" should degrade to a *catchable,
observable error* — not `Maximum call stack size exceeded` that takes down every module in the
service. A framework's emit primitive that can be crashed by its own callers is unsafe by
construction. This is robustness, not payload cleanup.

Note the asymmetry with the RPC path: `sendResponseMiddleware` uses `res.json()`, and Express
catches a synchronous throw and converts it to a 500. The **socket emit path has no such catch** —
which is exactly why it, and not the response path, kills the process.

## Why this is the highest-leverage place to fix it

This one boundary sits under *every* emit in the platform. A guard here would have prevented this
outage on its own, with zero changes anywhere else — the SystemView plugin gap would degrade to "a
trace is dropped" instead of "the service dies," and every application-level
`emit(event, circularThing)` becomes survivable. Callers still shouldn't emit circular data; this
just ensures that when they do, the blast radius is one message, not the process.

## Fix direction

Wrap the socket emit so a serialization failure is contained:

```js
Emitter.emit = (name, data) => {
  const id = shortid();
  const type = "WebSocket";
  try {
    socket.to(name).emit(name, { id, data, type });
  } catch (err) {
    // surface it as an error, drop the one message — do not let it unwind the process
    Emitter.$emit("error", { event: name, message: err.message, error: err });
    // (optionally also console.error a one-liner)
  }
  Emitter.$emit(name, data); // keep local listeners working regardless of wire-encode outcome
};
```

Points worth deciding during the RFC:

- **Emit the local event even when the wire encode fails.** In-process observers (`$emit` listeners)
  don't go through socket.io and aren't subject to the same failure; today they're collateral damage
  because line 23 never runs after line 21 throws. Moving/duplicating the local emit so it survives a
  wire failure keeps local behavior intact.
- **Surface the failure, don't swallow it silently.** A dropped emit should be observable — a local
  `"error"` event and/or a single stderr line — so a systematically unserializable payload is
  visible rather than mysteriously missing.
- **Sanitizing is out of scope here by design.** If systemlynx ever wants emits to be robust *and*
  still deliver a degraded payload, that's a separate, opt-in decycle — not something to fold into
  this safety net, and not a substitute for callers sending serializable data.
