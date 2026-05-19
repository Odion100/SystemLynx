# RFC: WebSocket Named Events + Room-Based Scoping

## Context

Currently all server-to-client WebSocket traffic flows through a single event named `"dispatch"`. The server uses `socket.emit("dispatch", {id, name, data, type})` on the namespace, which broadcasts to **every connected client** in the namespace. Each client then checks `event.name` and routes or discards client-side. This wastes bandwidth — if 10 clients are connected and only 1 subscribed to `"orderCreated"`, all 10 still receive the packet.

The goal is to use Socket.io's native named events + room-based scoping so that each event is only delivered to clients that actually subscribed to it.

---

## Architecture Change

**Before:**
```
Server: namespace.emit("dispatch", { id, name: "orderCreated", data, type })
          → ALL clients in namespace receive it
          → each client checks event.name, ignores if not listening
```

**After:**
```
Client subscribes: socket.emit("subscribe", "orderCreated")
Server joins room: clientSocket.join("orderCreated")
Server emits:      namespace.to("orderCreated").emit("orderCreated", { id, data, type })
          → ONLY clients in room "orderCreated" receive it
```

The user-facing API is **unchanged** — `module.on("eventName", cb)` still works the same.

---

## Files to Change

### 1. `systemlynx/ServerManager/components/SocketEmitter.js`

Two changes:
- Add a `"connection"` handler on the namespace to manage room membership per connected client
- Change the emit to target the room instead of broadcasting to all

```javascript
// Add after creating namespace socket:
socket.on("connection", (clientSocket) => {
  clientSocket.on("subscribe", (name) => clientSocket.join(name));
  clientSocket.on("unsubscribe", (name) => clientSocket.leave(name));
});

// Change the emit:
// OLD: socket.emit("dispatch", { id, name, data, type });
// NEW: socket.to(name).emit(name, { id, data, type });
```

### 2. `systemlynx/Client/components/SocketDispatcher.js`

Three changes:

**a) Replace `socket.on("dispatch", ...)` with `socket.onAny(...)`** to receive named events. Reconstruct the event object explicitly (no spread — avoids payload fields bleeding into event shape). `name` is kept on the event object since a single callback can handle multiple events and may need to know which fired:
```javascript
socket.onAny((name, payload) => {
  const event = { id: payload.id, name, data: payload.data, type: payload.type };
  dispatcher.emit(name, payload.data, event);
});
```

**b) Track subscription counts and sync with server rooms** by overriding `on`, `once`, `$clearEvent`, and `destroy`. Use a `subscriptionCounts` Map. On first listener for an event → emit `"subscribe"` to server. When last listener removed → emit `"unsubscribe"`. Use a `RESERVED` set for socket.io internal events (`connect`, `disconnect`, `error`, `connect_error`) that must never be treated as subscriptions.

**c) Re-subscribe on reconnect** — inside the `"connect"` handler, re-emit `"subscribe"` for all events currently tracked in `subscriptionCounts`.

Subscription reference-counting sketch:
```javascript
const subscriptionCounts = new Map();
const RESERVED = new Set(["connect", "disconnect", "error", "connect_error"]);

const trackSubscribe = (name) => {
  const n = (subscriptionCounts.get(name) || 0) + 1;
  subscriptionCounts.set(name, n);
  if (n === 1) socket.emit("subscribe", name);
};

const trackUnsubscribe = (name) => {
  const n = (subscriptionCounts.get(name) || 0) - 1;
  if (n <= 0) { subscriptionCounts.delete(name); socket.emit("unsubscribe", name); }
  else subscriptionCounts.set(name, n);
};
```

Override `on`: call original, if not RESERVED → `trackSubscribe`, return unsub that also calls `trackUnsubscribe`.  
Override `once`: same but auto-`trackUnsubscribe` when the callback fires (use a `done` flag to prevent double-unsubscribe if unsub is called before event fires).  
Override `$clearEvent`: call original, if tracked → clear count and emit `"unsubscribe"`.  
Override `destroy`: emit `"unsubscribe"` for all tracked events, clear map, call original.

### 3. `systemlynx/Client/tests/SocketDispatcher.test.js`

Two changes:

**a) Add subscription handling to test server setup** (mirrors what SocketEmitter does internally):
```javascript
socket.on("connection", (clientSocket) => {
  clientSocket.on("subscribe", (name) => clientSocket.join(name));
  clientSocket.on("unsubscribe", (name) => clientSocket.leave(name));
});
```

**b) Change server-side emit in test** from namespace broadcast to room-targeted named event:
```javascript
// OLD:
socket.emit("dispatch", { name: eventName, data: { testPassed: true } })
// NEW:
socket.to(eventName).emit(eventName, { id: "test-id", data: { testPassed: true }, type: "WebSocket" })
```

Update the `event` deep-equal assertion in the `SocketDispatcher.apply()` test to match the new reconstructed shape `{ id, name, data, type }`.

### 4. `/Users/odionedwards/SystemLynx-client/systemlynx/Client/components/SocketDispatcher.mjs`

The `systemlynx-client` package (separate repo at `/Users/odionedwards/SystemLynx-client/`, used by `systemview`) has its own `SocketDispatcher.mjs` that is identical in logic to `SocketDispatcher.js` but uses ES module syntax (`import`/`export default`). Apply the exact same changes — subscription count Map, `on`/`once`/`$clearEvent`/`destroy` overrides, `socket.onAny`, reconnect re-subscription — written with ES module syntax.

---

## Files NOT Changed

- `systemlynx/ServerManager/components/Router.js` — HTTP method calls, unaffected
- `systemlynx/Client/components/ServiceRequestHandler.js` — HTTP method calls, unaffected
- `systemlynx/Client/tests/Client.test.js` — event shape `has.all.keys("id", "name", "data", "type")` still matches ✓
- `systemlynx/App/tests/App.test.js` — event shape not tested here ✓

---

## Verification

1. `npm test` — all existing tests should pass
2. The `SocketDispatcher.test.js` "emit and handle events" tests confirm room delivery works
3. The `Client.test.js` "receive events emitted from backend" test verifies end-to-end: server `eventTester.emit(...)` → only subscribed client receives it
4. Manually: connect two clients to the same service, subscribe one to `"eventA"`, confirm only that client gets the event when the server emits it
