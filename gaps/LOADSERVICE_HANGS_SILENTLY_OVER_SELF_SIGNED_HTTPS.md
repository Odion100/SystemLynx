# loadService hangs the host's boot — silently, forever — over self-signed HTTPS

When a service runs over https with a self-signed dev cert (the standard local setup:
`NODE_TLS_REJECT_UNAUTHORIZED=0` + certs in `.env`), any service whose `loadService` targets a
**live** https peer never finishes booting. It logs "mongodb connected", then nothing — no error,
no retry, no listen. The port never binds.

Observed in buAPI: Profiles (loads no one) and Mocks (its peer happened to be down) booted;
Basketball, Media, and Networking (each loading a live https peer) hung forever. The asymmetry is
the tell: **the hang is in the success path** — only loads that get past the HTTP fetch stall.

## Three stacked defects

### 1. socket.io-client ignores `NODE_TLS_REJECT_UNAUTHORIZED=0`

Node core `https` honors the env flag, so axios (`loadConnectionData`) and curl work fine against
the self-signed cert. But socket.io-client's Node transports (`xmlhttprequest-ssl` polling) build
their own TLS options and skip Node's global override. The wss handshake is rejected —
`connect_error: xhr poll error` — on every retry, forever.

Proof (against a live https Profiles):

```
io.connect(ns, { path })                              // env flag set, like SocketDispatcher
  → connect_error: xhr poll error  ×∞ — never connects

io.connect(ns, { path, rejectUnauthorized: false })   // no env flag at all
  → CONNECTED instantly
```

### 2. SocketDispatcher gives no way to pass TLS options

`systemlynx/Client/components/SocketDispatcher.js`:

```js
const socket = io.connect(namespace, { path });
```

No `rejectUnauthorized`, no `ca`, no options pass-through from `loadService`. The consumer cannot
fix this from outside the framework.

### 3. loadService awaits "connect" with no timeout and no error path

`systemlynx/Client/Client.js`:

```js
await new Promise((resolve) => Service.on("connect", resolve));
```

Nothing listens to `connect_error`; there is no timeout. If the socket can't connect, this promise
never settles. And `systemlynx/App/components/initializeApp.js` **awaits `loadServices()` before
`loadModules()`/listen** — so one unconnectable peer socket silently blocks the entire host service
from ever binding its port. Contrast with the HTTP stage: `loadConnectionData` retries 3× then
rejects loudly, and `loadServices`' catch warns and resolves. The socket stage has no equivalent —
a *down* peer fails loud and boot continues; an *up* https peer hangs the boot silently.

## Fix

1. **Mirror the env flag in SocketDispatcher** (verified working — currently patched in buAPI's
   `node_modules`, which dies on the next `npm install`; that's why this must land upstream):

   ```js
   const insecureTLS = process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0";
   const socket = io.connect(namespace, {
     path,
     ...(insecureTLS ? { rejectUnauthorized: false } : {}),
   });
   ```

   With this one change, the full buAPI cluster boots over https and `loadService` resolves
   through the normal success path.

2. **Make loadService fail loudly.** Listen to `connect_error` and/or add a timeout to the
   "connect" await, so a socket that can't connect surfaces as the same warn-and-continue that a
   down peer already gets. A boot should never be silently blockable — this design turned a
   one-line TLS issue into days of misdirection.

3. (Optional, forward-looking) Thread socket/TLS options through
   `loadService(url, { socketOptions })` → `createService` → `SocketDispatcher`, so consumers can
   pass a custom CA or other transport options without env-flag globals.
