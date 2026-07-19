# SystemLynx LoadBalancer & Cluster

The **LoadBalancer** turns many identical instances of your services into one coherent
cluster. It does three jobs at once — **service discovery**, **connect-time load balancing**,
and **cluster delegation** (`delegate` / `broadcast` / `elect`) — and because SystemLynx
clients connect once, the load balancing falls out of discovery for free.

```javascript
const { LoadBalancer } = require("systemlynx");
```

- **Discovery is the balancing.** A client bootstraps by fetching a service's `connectionData`
  from a URL and connecting directly. The LoadBalancer is just "a URL that returns
  `connectionData`" — round-robined (or load-aware) across the live clones of that service. The
  choice is made **once, at connect time**, and stays sticky — which is exactly what a
  WebSocket-stateful system wants (per-request balancing would shred socket affinity).
- **Two halves.** `LoadBalancer.clone(...)` is the **plugin** a service installs to join the
  cluster (local, user-facing). `LoadBalancer.Tentacle` is the **central module** it routes to
  (remote, internal). You write `this.clone.delegate(...)`; it reaches the shared `Tentacle`.

---

## Running a LoadBalancer

```javascript
const { LoadBalancer } = require("systemlynx");

LoadBalancer.startService({ route: "loadbalancer", port: 4000 });
```

That's a normal SystemLynx service whose only module is `Tentacle`.

---

## Joining the cluster — the `clone` plugin

A service joins with one line:

```javascript
const { App, LoadBalancer } = require("systemlynx");

App.startService({ route: "orders", port: 4100 })
  .module("Orders", Orders)
  .use(LoadBalancer.clone({ url: "http://localhost:4000/loadbalancer" }));
```

On startup the plugin connects to the LoadBalancer, **auto-registers** this service (no manual
`register` call), installs a `this.clone` handle on every module, and starts reporting its load.

### Options

`LoadBalancer.clone(options)` takes an open options object — recognized keys are handled and
anything else passes through, so the signature never breaks as options grow.

| Option | Default | Description |
|:---|:---|:---|
| `url` | *(required)* | The LoadBalancer to connect to |
| `namespace` | `"clone"` | The per-module handle name (`this.clone`); relocate it on collision |
| `serviceId` | route | Names this service in the cluster (matches the SystemView plugin convention) |
| `reportInterval` | `10000` | How often (ms) to push load + heartbeat to the LoadBalancer |

---

## `this.clone` — cluster coordination from inside your modules

The plugin installs `this.clone` on every module and `App.clone` as a capturable handle for
background/event code (where there's no `this`). Both are the **local near side**; each call
proxies over the wire to the remote `Tentacle`, which does the work.

> **Collision:** if a module already defines a method named `clone`, the plugin **throws at
> startup** rather than clobber it. Pass `{ namespace: "cluster" }` to move the handle to
> `this.cluster`.

### `this.clone.delegate(key)` — run a task exactly once across the cluster

Every clone reacts to the same event; only one should do the work. All of them call `delegate`
with the **same deterministic key**; exactly one is told `delegated: true`.

```javascript
Orders.on("order_paid", async function (order) {
  const { delegated } = await this.clone.delegate(`receipt:${order.id}`);
  if (delegated) sendReceiptEmail(order); // runs on one clone, not all of them
});
```

`delegate` is **at-most-once** (a winner that crashes mid-task doesn't hand off). For work that
must survive a crash, use `elect`.

### `this.clone.broadcast(key, data)` / `this.clone.on(key, handler)` — every clone acts

The inverse of `delegate` — one clone fans an action out to all clones (cache flush, config
reload). Every clone **receives** it by subscribing with `this.clone.on(key, handler)` (do this
once the handle is wired, e.g. in an `App.on("clone_ready", (clone) => clone.on(...))`).

```javascript
// receiver — every clone reacts
App.on("clone_ready", (clone) => {
  clone.on("flush-cache", ({ collection }) => cache.clear(collection));
});

// sender — any clone triggers it
await this.clone.broadcast("flush-cache", { collection: "products" });
```

### `this.clone.elect({ role, holderId })` / `resign` — a durable single leader

One clone holds a role over time (a cron, a scheduler). The holder renews by re-electing; if it
lapses (crashes), the next caller wins. `resign` steps down cleanly so another takes over now.

```javascript
const me = App.connectionData.serviceUrl;
setInterval(async () => {
  const { leader } = await App.clone.elect({ role: "nightly-cron", holderId: me });
  if (leader) runNightlyJob(); // exactly one clone runs the scheduler
}, 5000);
```

---

## Discovery from a client — one call, a whole app

The LoadBalancer's `Tentacle` also serves a **directory**: fetch `connectionData` for many
services at once and build client proxies locally with `Client.createService`.

```javascript
const { createClient, LoadBalancer } = require("systemlynx");

const lb = /* a loaded LoadBalancer service */;
const bundle = await lb.Tentacle.directory(["/orders", "/users"]);

const Client = createClient();
const orders = Client.createService(bundle["/orders"]);
const users = Client.createService(bundle["/users"]);
```

---

## Intelligent routing & health

Clone tentacles push their in-flight **load** (and a **heartbeat**) to the LoadBalancer. The
`Tentacle` uses that to route smarter than a blind ring:

- **`Tentacle.policy`** — `"round-robin"` (default) or `"least-load"`. Under `least-load`, a new
  discovery request is routed to the clone reporting the least load. The decision is still
  connect-time and sticky.
- **`Tentacle.heartbeatTTL`** (default `30000` ms, `0` disables) — a clone that has been
  heartbeating and then goes silent is **evicted** at routing time. Clones without the tentacle
  (no heartbeat) are never staleness-evicted.

A dead location is also evicted the moment a discovery fetch to it fails, and a re-`register`
re-admits a location that came back.

## Transparent failover

Because a client bootstraps through the LoadBalancer, the `connectionData` it receives has its
`serviceUrl` pointed back at the LB route. So SystemLynx's built-in reconnect (which re-fetches
from `serviceUrl` on a transport failure) **fails over through the LoadBalancer**: if the clone
a client is talking to dies mid-call, the client transparently re-fetches, lands on a *live*
clone, and the same method call completes — the caller never sees the failure.

The client also **validates that a response actually came from SystemLynx**: every response
carries a marker, so if a stranger (a stale server or a proxy) answers on the clone's port with
an otherwise-valid `200`, the client treats it as a failure and reconnects rather than accepting
the garbage.

---

## API surface

| On the LoadBalancer service | |
|:---|:---|
| `LoadBalancer.startService(options)` | Start the LoadBalancer (a normal SystemLynx service) |
| `LoadBalancer.clone(options)` | The plugin a service installs to join the cluster |
| `LoadBalancer.Tentacle` | The central module (register/directory/delegate/broadcast/elect/report/heartbeat) |

| On a joined service | |
|:---|:---|
| `this.clone.delegate(key)` | Run once across the cluster |
| `this.clone.broadcast(key, data)` | Run on every clone |
| `this.clone.elect({ role, holderId })` / `resign` | Durable single leader |
| `App.clone` | The same handle, capturable for background/event code |
