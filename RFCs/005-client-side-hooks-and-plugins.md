# RFC 005 — Client-side hooks & plugins

## Motivation

The server has `App.use(plugin)` + `before`/`after` hooks (whose `this` is the module). The client has
no entry point for **outbound** calls. Give the client the same.

## `App` vs a standalone client

`App` wraps `Client` + `Service` and uses a client under the hood, so `App.use` delegates to
`Client.use` internally — **no separate call on the server.** `Client.use` is also the direct entry for
a custom client (`createClient()`) or a client handle you hold. One mechanism, reached two ways.

## API

`Client.use(plugin)` — mirrors `App.use`.

`before`/`after`, each taking a **target** (`"$all"` or a specific method), registerable at client /
loaded-service / module levels:

```js
Client.before("$all", function (payload, next) { … });          // every outbound call
loadedService.before("$all", function (payload, next) { … });   // every call on this service

loadedService.Orders.before("reprice", function (payload, next) {
  this.setHeaders({ "x-sv-trace": currentTrace }); // `this` = the Orders module (setHeaders already on it)
  next();                                          // `payload` = outbound args — read/modify
});

loadedService.Orders.after("reprice", function (payload, next) { … });
```

- **`this`** = the module/service instance; `setHeaders` is already composed onto it.
- **`payload`** = the outbound arguments (read/modify). No request object.
- **`next()`** — may be async (hold the outgoing request before proceeding).

## Async `next`

Hooks may `await` before `next()` (hold the request). One requirement: an async `before` that sets
headers must snapshot them per-call at capture, so a concurrent request can't overwrite in the gap.
(Sync hooks are naturally safe — headers are captured synchronously right before send.)

## Trace propagation — mechanism vs. the consumer's problem

We provide the hook; we do **not** connect an outbound call to the *originating request's* trace. When a
module handling inbound request R calls another service, that outbound client call is **decoupled** from
R — a shared standalone client with no back-reference. Passing `req`/`res` in wouldn't help; it isn't
R's call. Bridging "current trace → this call" is the **consumer's** context problem, not the
framework's. Our only job is that the hook is *sufficient* to hang it on: stamp whatever the consumer
resolves as the trace via `this.setHeaders`, and don't override one already present.

## Open questions

- **`before` short-circuit** — can a `before` resolve a call and skip the network, and how.
- **One SystemView plugin, or a separate client-side variant** — the hook shape differs from the server's.
- **Ordering** of the client → service → module chains.
- **`after` on error** — does it run on a failed response too.

## Non-goals

- No request object.
- No server-side change — `App.use` covers the server via `Client.use`.
