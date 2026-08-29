# RFC 013 — closing a client: `unloadService` and `disconnect`

*Status: building. Reported by systemview-test; root cause confirmed on both sides before agreeing.*

## The problem

There is no way to close a client. Not in 3.4.0, not in any version.

SystemView's hub proved it in production: its warm loop calls `createClient().loadService(url)` every
20 seconds, the proof call fails, and the client is discarded. `Networking` has 6 modules, and a
`loadService` opens **one socket per module plus one for the service** — so every discard leaves 7
live sockets with no handle attached to anything. ~10,000 ESTABLISHED connections in 8 hours.

This is not RFC 010. That fixed re-*application* of a dispatcher onto a live service (reconnect
stacking sockets). This is repeated *construction* of new clients, and it leaks identically on 3.4.0.

`disconnect()` and `destroy()` exist on every dispatcher — the service and each module — but nothing
aggregates them, and `Client.cachedServices` holds every service the client ever loaded.

## Why the framework owns this, and not the caller

A consumer hand-rolling teardown has to know four internals:

1. each module owns its **own** dispatcher (`ClientModule.__setConnection`), not just the service;
2. `destroy()` unsubscribes tracked events but does **not** close the socket, so both calls are
   needed, in that order;
3. `Client.js` wires `Service.on("disconnect", Service.resetConnection)`, so calling `disconnect()`
   **fires a reconnect** and rebuilds every socket just closed — teardown that silently reopens;
4. the entry stays in `cachedServices` afterwards, so the next `loadService` hands back a corpse.

That is four pieces of SystemLynx's insides leaking into someone else's loop, and (3) is the kind of
trap that reads as fixed while still leaking. Odion's ruling: separation of concern — the hub calls
one method and knows none of this.

## The API

```js
Client.unloadService(url);   // → true if a service was closed, false if nothing was cached
Client.disconnect();         // → number of services closed
```

`unloadService(url)`:

1. drops the cache entry **first**, so anything re-entrant can't resurrect it;
2. clears the reconnect wiring (`$clearEvent("disconnect")`) before anything is closed;
3. for each module: `destroy()` then `disconnect()`;
4. the same for the service dispatcher;
5. returns `false` and does nothing when the URL was never loaded — idempotent, safe to call on a
   failed proof without knowing whether the load got far enough to cache.

`disconnect()` is `unloadService` over every cached service — the discarded-client case, which is the
one that actually bit.

## What it deliberately does not do

It does not poison the handles. A caller holding `Service.Users` after unloading can still call it,
and it will behave like any client whose transport went away — an HTTP attempt and the normal
reconnect path. Making stale handles throw is a bigger, separate decision about lifetime, and this
RFC is about not leaking sockets.

## Both packages

`systemlynx` and `systemlynx-client` ship the same behaviour. The browser client has the same
per-module dispatchers and the same reconnect wiring, so it has the same leak.
