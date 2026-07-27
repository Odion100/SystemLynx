# App.loadService drops retry options, and a failed load leaves a bare client forever

Two halves of one failure mode, found while chasing "invalid profile_id" / "setHeaders is not a
function" errors in buAPI that appeared after every simultaneous dev restart.

## 1. The public API drops options the pipeline already supports

`App/components/loadServices.js` reads retry options straight off the service entry:

```js
const { url, limit, wait, name, onLoad } = serviceData;
Client.loadService(url, { limit, wait })
```

…but `App/App.js` never lets a caller set them:

```js
App.loadService = (name, url) => {
  system.services.push({ name, url, onLoad: null, client: {} });
  ...
```

So every consumer is pinned to `loadConnectionData`'s defaults: **3 attempts over ~3.5s**. Over
https (or any slower boot), a peer restarting alongside its consumer takes longer than that to
listen — the consumer loses the race on *every* simultaneous restart, deterministically.

**Fix (verified working, currently patched in buAPI's node_modules — dies on npm install, needs to
land upstream):**

```js
App.loadService = (name, url, options = {}) => {
  system.services.push({ name, url, ...options, onLoad: null, client: {} });
  return App;
};
```

Consumers then pass `{ limit: 10, wait: 2000 }` and survive a peer's slow boot.

## 2. A failed load leaves `client: {}` — a bare handle with no self-heal

When all retries fail, `loadServices`' catch warns and resolves, and the entry keeps its initial
`client: {}`. From then on, `useService("X")` returns that bare object **for the life of the
process**:

- `useService("X")[moduleName]` → `undefined` → consumer code degrades into misleading domain
  errors (buAPI: `getProfile` throws "invalid profile_id or profile_type" — reads like bad input,
  is actually a dead handle)
- `useService("X").setHeaders(...)` → `TypeError: setHeaders is not a function` → 500s

Nothing retries. The only recovery is restarting the consumer *after* the peer is up.

**Fix direction:** retry failed loads in the background (the `failed_connection` event already
exists as the hook point), or lazily re-attempt on `useService` access to a never-loaded entry.
Related: `Client.loadService`'s silent-hang failure mode over self-signed https is the same
class of problem — see `LOADSERVICE_HANGS_SILENTLY_OVER_SELF_SIGNED_HTTPS.md`.
