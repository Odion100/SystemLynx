# SystemLynx API Documentation

SystemLynx is a Node.js framework for building modular, distributed web APIs. It lets you host plain JavaScript objects as **Modules** on a server and load them transparently into a client application, calling their methods over HTTP or WebSockets.

For a high-level introduction see the [README](./README.md).

---

## Table of Contents

- [Service](#service)
- [ServerModule](#servermodule)
- [Middleware](#middleware)
- [App](#app)
- [Client](#client)
- [ClientModule](#clientmodule)
- [LoadBalancer](#loadbalancer)
- [HttpClient](#httpclient)

---

## Service

`Service` is used to host objects that can be loaded remotely by a SystemLynx `Client`.

```javascript
const { Service } = require("systemlynx");
```

Alternatively, use `createService` to create an isolated instance:

```javascript
const { createService } = require("systemlynx");
const Service = createService();
```

---

### Service.module(name, constructor [, reserved_methods])

Registers an object or constructor function as a **ServerModule** hosted by this Service. Returns the constructed module.

| Parameter | Type | Description |
|:---|:---|:---|
| `name` | string | The name used to identify and route to this module |
| `constructor` | object \| function | The module object, or a constructor function where `this` is the module instance |
| `reserved_methods` | string[] | Method names to exclude from routing (not accessible remotely) |

**Object constructor:**
```javascript
const Users = {
  add(data) {
    return { message: "User added" };
  },
  find(query) {
    return { message: "Users found" };
  }
};

Service.module("Users", Users);
```

**Function constructor:**

When a function is used, `this` inside it is the module instance. Methods added to `this` are exposed remotely. The constructor receives the Express server and Socket.io instance as arguments, useful for adding custom routes or listeners.

```javascript
Service.module("Orders", function (server, WebSocket) {
  const Orders = this;

  Orders.find = async function (query) {
    return { results: [] };
  };

  Orders.create = async function (data) {
    return { created: true };
  };

  // Scope middleware to specific methods
  Orders.before("create", validateData);
  Orders.after("find", formatResults);
});
```

**Excluding methods from routing:**

```javascript
Service.module("Users", Users, ["internalMethod", "helperFn"]);
```

---

### Service.startService(options)

Starts the Express and Socket.io servers and sets up routing for all registered modules. Returns a promise that resolves with the service connection data once the server is listening.

```javascript
await Service.startService({
  route: "api/users",
  port: 4400,
  host: "localhost",
});
```

| Option | Type | Required | Description |
|:---|:---|:---:|:---|
| `route` | string | ✓ | The base route for this service (e.g. `"api/users"`) |
| `port` | number | ✓ | The port to listen on |
| `host` | string | | Hostname for the service URL. Default: `"localhost"` |
| `protocol` | string | | `"http"` or `"https"`. Inferred from `ssl` if not set |
| `ssl` | object | | `{ key, cert }` — file contents for HTTPS. When provided, an HTTPS server is created |
| `useREST` | boolean | | When `true`, module methods named `get`, `post`, `put`, or `delete` are also exposed as REST routes. Default: `false` |

**With SSL:**
```javascript
const fs = require("fs");

await Service.startService({
  route: "api/users",
  port: 443,
  host: "example.com",
  protocol: "https",
  ssl: {
    key: fs.readFileSync("/path/to/key.pem"),
    cert: fs.readFileSync("/path/to/cert.pem"),
  },
});
```

---

### Service.before([name,] ...middleware)

Adds middleware that runs **before** a module method is called.

- With no name — runs before every method on every module
- With a module name — runs before every method on that module
- With `"ModuleName.methodName"` — runs before that specific method only
- With `"$all"` — same as no name, explicitly runs before everything

```javascript
// Before every method on every module
Service.before(authenticate);

// Same, explicit form
Service.before("$all", authenticate);

// Before every method on the Users module
Service.before("Users", requireAuth);

// Before only Users.delete
Service.before("Users.delete", requireAdmin);

// Multiple middleware in one call
Service.before("Users.edit", validate, sanitize);
```

---

### Service.after([name,] ...middleware)

Adds middleware that runs **after** a module method returns, before the response is sent. Same scoping rules as `Service.before`.

```javascript
// After every method
Service.after(logResponse);

// After every method on Orders
Service.after("Orders", formatResponse);

// After only Orders.find
Service.after("Orders.find", attachMetadata);
```

---

### Service.server

The underlying Express app instance. Use this to add custom Express routes, static file serving, or any Express middleware.

```javascript
Service.module("Storage", function (server) {
  const express = require("express");
  server.use("/files", express.static("/path/to/files"));

  this.list = () => { /* ... */ };
});
```

---

### Service.WebSocket

The Socket.io server instance.

---

## ServerModule

A `ServerModule` is the object returned by `Service.module()`. It is also the value of `this` inside a module constructor function. It has the following built-in methods in addition to whatever methods you define.

---

### module.on(eventName, callback [, options])

Listens for a WebSocket event emitted to this module's namespace. Returns an unsubscribe function.

```javascript
const Users = Service.module("Users", function () {
  this.on("user_connected", (data) => {
    console.log("User connected:", data);
  });
});
```

| Option | Type | Description |
|:---|:---|:---|
| `eventId` | string | Stable key for this listener. Re-registering with the same `eventId` replaces the previous listener instead of adding a new one |
| `interval` | number | Throttle interval in milliseconds |
| `limit` | number | Max calls within the throttle interval |

---

### module.once(eventName, callback [, options])

Same as `on`, but the listener is automatically removed after firing once. Returns an unsubscribe function.

---

### module.emit(eventName, data)

Emits a WebSocket event to all connected clients listening on this module.

```javascript
Service.module("Orders", function () {
  this.create = function (data) {
    const order = createOrder(data);
    this.emit("order_created", order);
    return order;
  };
});
```

This is also available in middleware via `req.module.emit(...)`:

```javascript
function notifyClients(req, res, next) {
  req.module.emit(`updated:${req.returnValue._id}`, req.returnValue);
  next();
}
```

---

### module.$clearEvent(eventName [, fn])

Removes event listeners. If a function is provided, removes only the listener matching that function's name. If no function is provided, removes all listeners for that event.

```javascript
module.$clearEvent("order_created");           // remove all
module.$clearEvent("order_created", myHandler); // remove by name
```

---

### module.destroy()

Removes all event listeners on this module.

---

### module.before([name,] ...middleware)

Adds middleware scoped to this module. Same as `Service.before("ModuleName", ...)` but callable from within the constructor.

```javascript
Service.module("Users", function () {
  this.edit = editUser;
  this.delete = deleteUser;

  this.before("edit", validateEditData);
  this.before("delete", requireAdmin);
  this.after("$all", logAction);
});
```

---

### module.after([name,] ...middleware)

Same as `module.before` but runs after the method returns.

---

## Middleware

Middleware functions follow the Express convention: `(req, res, next) => {}`. They can be async.

SystemLynx adds the following properties to the request and response objects.

### Request properties

| Property | Type | Description |
|:---|:---|:---|
| `req.module_name` | string | Name of the module being called (e.g. `"Users"`) |
| `req.fn` | string | Name of the method being called (e.g. `"find"`) |
| `req.arguments` | array | The arguments passed by the client to the method |
| `req.module` | object | The ServerModule instance itself |
| `req.returnValue` | any | The value returned by the method — available in `after` middleware |

Any properties you add to `req` are accessible in subsequent middleware in the chain:

```javascript
function authenticate(req, res, next) {
  const token = req.headers.authorization;
  const session = verifyToken(token);

  if (!session) return res.sendError({ status: 401, message: "Unauthorized" });

  req.session = session;
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.isAdmin)
    return res.sendError({ status: 403, message: "Forbidden" });
  next();
}
```

### Response methods

| Method | Description |
|:---|:---|
| `res.sendError({ status, message })` | Sends an error response and stops the middleware chain |
| `res.sendResponse(value)` | Sends a successful response with the given value |

```javascript
function validate(req, res, next) {
  const [data] = req.arguments;
  if (!data.name) return res.sendError({ status: 400, message: "name is required" });
  next();
}
```

**Modifying the return value in `after` middleware:**

```javascript
function attachMeta(req, res, next) {
  req.returnValue.timestamp = Date.now();
  next();
}
```

---

## App

`App` combines the functionality of `Service` and `Client` into a single object with a chainable interface and lifecycle events. It is the recommended entry point for production services.

```javascript
const { App } = require("systemlynx");
```

To use a custom Express server or create isolated instances:

```javascript
const { createApp } = require("systemlynx");
const express = require("express");

const server = express();
const App = createApp(server);
```

---

### App.startService(options)

Same options as [`Service.startService`](#servicestartserviceoptions). Returns `App` for chaining.

```javascript
App.startService({ route: "api/profiles", port: 4400, host: "localhost" });
```

---

### App.module(name, constructor [, reserved_methods])

Same as [`Service.module`](#servicemodulename-constructor--reserved_methods). Returns `App` for chaining.

```javascript
App.startService({ route: "api", port: 4400 })
  .module("Users", UsersConstructor)
  .module("Orders", OrdersConstructor);
```

---

### App.loadService(name, url)

Loads a remote SystemLynx Service and makes it available inside module constructors via `this.useService(name)`. Returns `App` for chaining.

```javascript
App.startService({ route: "api/basketball", port: 4401 })
  .loadService("Profiles", "http://localhost:4400/api/profiles")
  .module("Games", function () {
    const Profiles = this.useService("Profiles");

    this.create = async function (data) {
      const profile = await Profiles.Users.get({ id: data.userId });
      // ...
    };
  });
```

---

### App.onLoad(callback)

Fires a callback when the most recently chained `loadService` connects. Receives the loaded service object.

```javascript
App.loadService("Profiles", url)
  .onLoad((Profiles) => {
    console.log("Profiles service connected:", Object.keys(Profiles));
  });
```

---

### App.config(constructor)

Registers a configuration constructor that runs before modules are initialized. Use it to set up shared state or configuration accessible to all modules via `this.useConfig()`.

```javascript
App.config(function (next) {
  this.dbConnection = connectToDatabase();
  this.settings = loadSettings();
  next();
});

App.module("Users", function () {
  const config = this.useConfig();
  this.db = config.dbConnection;
});
```

---

### App.before / App.after

Same as [`Service.before`](#servicebeforename-middleware) and [`Service.after`](#serviceafterename-middleware).

```javascript
App.startService({ route: "api", port: 4400 })
  .before("$all", authenticate)
  .module("Users", Users)
  .module("Orders", Orders);
```

---

### App.on(eventName, callback)

Listens for a lifecycle event on the App. Returns an unsubscribe function.

| Event | Payload | Description |
|:---|:---|:---|
| `"ready"` | system object | Fires when the App has fully initialized — service started, all modules loaded, all remote services connected |
| `"service_loaded"` | service object | Fires each time a remote service finishes connecting |
| `"service_loaded:<name>"` | service object | Fires when the named service finishes connecting |
| `"failed_connection"` | `{ err, name, url }` | Fires when a remote service fails to connect |

```javascript
App.on("ready", function (system) {
  console.log("App ready");
  console.log("Modules:", system.modules.map(m => m.name));
});

App.on("service_loaded:Profiles", (Profiles) => {
  console.log("Profiles connected");
});
```

The `this` value inside a `"ready"` callback is the system context, giving access to `this.useModule()`, `this.useService()`, and `this.useConfig()`.

---

### App.emit(eventName, data)

Emits a lifecycle event on the App.

---

### App.use(plugin)

Registers a plugin function that runs before App initialization. The plugin receives `(App, system)` and can add modules, load services, or configure the App.

```javascript
const myPlugin = (App, system) => {
  App.loadService("Analytics", "http://localhost:4500/analytics");
  App.module("Tracker", TrackerConstructor);
};

App.use(myPlugin).startService({ route: "api", port: 4400 });
```

---

### System context inside modules

Inside any module constructor (and `App.on("ready", ...)` callbacks), `this` includes:

| Method | Description |
|:---|:---|
| `this.useModule(name)` | Returns another module registered on this App by name |
| `this.useService(name)` | Returns a remote service loaded via `App.loadService(name, url)` |
| `this.useConfig()` | Returns the configuration object built by `App.config(constructor)` |

```javascript
App.module("Games", function () {
  const Users = this.useModule("Users");
  const Profiles = this.useService("Profiles");

  this.create = async function (data) {
    const user = await Users.get({ id: data.userId });
    const profile = await Profiles.Players.get({ id: data.userId });
    // ...
  };
});
```

---

## Client

`Client` is used to load a remote SystemLynx Service and call its module methods from a client application.

```javascript
const { Client } = require("systemlynx");
```

---

### Client.loadService(url [, options])

Loads a remote SystemLynx Service. Returns a promise that resolves into an object containing all the modules hosted by that service, plus service-level methods.

```javascript
const { Users, Orders } = await Client.loadService("http://localhost:4400/api");
```

| Option | Type | Description |
|:---|:---|:---|
| `forceReload` | boolean | When `true`, bypasses the cache and reconnects even if this URL was already loaded |

**Loading multiple services:**

```javascript
const ProfilesAPI = await Client.loadService("http://localhost:4400/api/profiles");
const BasketballAPI = await Client.loadService("http://localhost:4401/api/basketball");

const user = await ProfilesAPI.Users.get({ id: "abc123" });
const games = await BasketballAPI.Games.find({ userId: "abc123" });
```

**Service-level methods on the returned object:**

| Method | Description |
|:---|:---|
| `service.on(event, callback)` | Listen for service-level WebSocket events (`"connect"`, `"disconnect"`, `"reconnect"`) |
| `service.setHeaders(headers)` | Set default headers sent with every request from this service |
| `service.headers()` | Returns the current default headers |
| `service.resetConnection()` | Manually trigger a reconnection |
| `service.disconnect()` | Disconnect the WebSocket |

---

## ClientModule

Each module on a loaded service is a `ClientModule`. Calling any method returns a promise that resolves with the method's return value.

```javascript
const { Users } = await Client.loadService(url);

const result = await Users.find({ city: "New York" });
```

File uploads are handled automatically — include a `file` (single) or `files` (array) property on any argument object:

```javascript
const result = await Storage.save({
  file: fs.createReadStream("/path/to/photo.jpg"),
  userId: "abc123",
});

const result = await Storage.save({
  files: [fs.createReadStream("a.jpg"), fs.createReadStream("b.jpg")],
  albumId: "xyz",
});
```

---

### module.on(eventName, callback [, options])

Listens for WebSocket events emitted by the server-side module. Returns an unsubscribe function — useful for React `useEffect` cleanup.

```javascript
const unsubscribe = Orders.on("order_created", (data) => {
  console.log("New order:", data);
});

// Later, to clean up:
unsubscribe();
```

| Option | Type | Description |
|:---|:---|:---|
| `eventId` | string | Stable key for this listener. Re-registering with the same `eventId` replaces the previous listener. Useful in React re-renders |
| `interval` | number | Throttle interval in milliseconds |
| `limit` | number | Max calls within the throttle interval |

**React usage:**
```javascript
useEffect(() => {
  const unsubscribe = Orders.on("order_created", handleNewOrder, {
    eventId: "order-list-listener",
  });
  return unsubscribe;
}, []);
```

---

### module.once(eventName, callback [, options])

Same as `on`, but fires only once then removes itself automatically. Returns an unsubscribe function.

---

### module.emit(eventName, data)

Emits a WebSocket event to the server-side module's namespace.

---

### module.$clearEvent(eventName [, fn])

Removes listeners. Without a function argument, removes all listeners for that event.

---

### module.destroy()

Removes all listeners on this module.

---

### module.setHeaders(headers)

Sets default HTTP headers sent with every request from this module. Module-level headers take priority over service-level headers.

```javascript
Users.setHeaders({ Authorization: `Bearer ${token}` });
```

---

### module.headers()

Returns the current module-level headers object.

---

---

## LoadBalancer

`LoadBalancer` distributes requests across multiple clones of a Service. Clients connect to the LoadBalancer URL — the LoadBalancer handles routing transparently.

```javascript
const { LoadBalancer } = require("systemlynx");
```

---

### LoadBalancer.startService(options)

Same options as [`Service.startService`](#servicestartserviceoptions). Starts the LoadBalancer as a Service.

```javascript
await LoadBalancer.startService({ route: "api/users", port: 4400 });
```

---

### LoadBalancer.clones

The `clones` module manages clone registration and routing. It is itself a `ServerModule`, so clients can call its methods remotely.

---

#### clones.register(options, callback)

Registers a new clone of a service with the LoadBalancer. Once registered, the LoadBalancer will route requests to it using round-robin.

```javascript
const { clones } = await Client.loadService("http://localhost:4400/api/users");

clones.register({ host: "localhost", port: 4401, route: "/api/users" }, (err, result) => {
  if (err) console.error("Registration failed:", err);
  else console.log("Clone registered:", result);
});
```

| Option | Type | Required | Description |
|:---|:---|:---:|:---|
| `host` | string | ✓ | Hostname of the clone |
| `port` | number | ✓ | Port the clone is running on |
| `route` | string | ✓ | Route of the clone service |

---

#### clones.dispatch(event, callback)

Dispatches a named event to all registered clones.

---

#### clones.assignDispatch(event, callback)

Assigns handling of an event to a single clone, preventing duplicate handling across instances.

---

## HttpClient

A lightweight HTTP client for making requests to SystemLynx services or any HTTP endpoint.

```javascript
const { HttpClient } = require("systemlynx");
```

---

### HttpClient.request(options)

Makes an HTTP request. Returns a promise.

```javascript
const data = await HttpClient.request({
  url: "http://localhost:4400/api/users/Users/find",
  method: "put",
  body: { __arguments: [{ city: "New York" }] },
  headers: { Authorization: "Bearer token" },
});
```

| Option | Type | Description |
|:---|:---|:---|
| `url` | string | Request URL |
| `method` | string | HTTP method (`"get"`, `"post"`, `"put"`, `"delete"`). Default: `"get"` |
| `body` | object | Request body |
| `headers` | object | Request headers |

---

### HttpClient.upload(options)

Uploads files using multipart form data. Returns a promise.

```javascript
const result = await HttpClient.upload({
  url: "http://localhost:4400/sf/api/storage/Storage/save",
  method: "put",
  formData: {
    __arguments: [{ message: "profile photo" }],
    file: fs.createReadStream("/path/to/photo.jpg"),
  },
});
```
