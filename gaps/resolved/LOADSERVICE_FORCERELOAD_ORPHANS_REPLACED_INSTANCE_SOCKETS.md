> **RESOLVED 2026-09-09** — fixed in `systemlynx/Client/Client.js` and
> `systemlynx-client/systemlynx/Client/Client.mjs`, covered by
> `systemlynx/Client/tests/forceReload.test.js`.
>
> **The diagnosis below is incomplete in one way worth recording.** Verifying it against the source
> turned up a second, larger bug that *preempts* this one: `createService` returns the cached
> instance when one exists, so `loadService` then awaited a `connect` event that had already fired
> and never fires again. **`forceReload: true` never returned on anything already cached** — it hung
> rather than leaked, which is why no consumer ever observed the strand.
>
> Same root cause, and the fix shape proposed here resolves both: evict, don't overwrite. Two details
> beyond the filed shape — eviction happens *after* the fetch, so a refresh that cannot reach the
> service leaves the working instance in place; and *both* cache keys are cleared, since
> `createService` keys off `connData.serviceUrl`, which is not guaranteed to equal the url passed in.
>
> Original report below, unedited.

---

# loadService forceReload overwrites the cache entry without closing the replaced instance — its sockets orphan

**Dropped by systemview-test, 2026-09-12**, while auditing SystemView's hub for
client-per-request waste (the `/sv-raw` route was building a throwaway `createClient()` per
image request to dodge stale stubs — the workaround this gap made look necessary).

## Symptom

A consumer that calls `loadService(url, { forceReload: true })` repeatedly — say, on every
request, or on a poll — accumulates sockets without bound. Each reload builds a fresh Service
instance (one socket per module plus one for the service, per RFC-013's own accounting), and the
previous instance is never closed. Same blast radius as the documented 10,000-socket
chat-warming incident (git spawn fails with EBADF once the fd table fills), reached down a
road that looks like the *sanctioned* refresh path.

## Root cause

`systemlynx/Client/Client.js`, `loadService`:

```js
Client.loadService = async (url, options = {}) => {
  if (Client.cachedServices[url] && !options.forceReload)
    return Client.cachedServices[url];
  // ...builds a new Service...
  Client.cachedServices[url] = Service;   // <- overwrite: the OLD instance is dropped on the
                                          //    floor still holding every socket it opened
```

`unloadService(url)` (RFC-013) does this correctly — closes the per-module sockets, then
deletes the entry. `forceReload` skips that discipline: it replaces the reference and lets the
replaced instance leak.

## Fix shape

One line of ordering inside `loadService`: when `forceReload` hits a cached entry, call
`Client.unloadService(url)` before building the replacement. Idempotent already (unloadService
is safe on a missing entry), no API change, and `forceReload` becomes what its name promises —
a refresh, not a leak.

## Consumer note (until fixed)

Refresh by eviction, not by reload: `Client.unloadService(url)` then a normal `loadService`.
That is also the right pattern for registries that KNOW when a service re-registered (SystemView's
hub case) — evict at the re-registration moment, and no hot path ever needs forceReload at all.
