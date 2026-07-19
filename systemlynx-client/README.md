# systemlynx-client

The browser / ES module client for [SystemLynx](https://github.com/Odion100/SystemLynx). It loads a SystemLynx Service and proxies its module methods over HTTP and WebSockets — the same `Client` that ships inside `systemlynx`, packaged as native ESM for frontend use.

## ⚠️ Version compatibility

Starting with **v2.0.0**, server-to-client WebSocket events use Socket.io **named events and rooms** instead of a shared broadcast channel. This is a **wire-protocol change**, so `systemlynx-client` must be on the same major version as the `systemlynx` service it connects to:

| `systemlynx-client` | [`systemlynx`](https://www.npmjs.com/package/systemlynx) (service) |
| :--- | :--- |
| `2.x` | `2.x` |

Pairing a v2 client with a v1 service (or vice versa) will connect but **silently deliver no events**. Upgrade both sides together.

This coupling extends across the whole SystemLynx ecosystem: **[SystemView](https://www.npmjs.com/package/systemview)** and its SystemLynx plugin must also be on **v2.x** to work with v2 services and clients. Upgrade the entire stack together.
