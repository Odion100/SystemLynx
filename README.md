<img src="./logo.png" alt="Alt text" style="background:white; border-radius:20px; padding:10px"/>

# SystemLynx JS ![GitHub license](https://img.shields.io/badge/license-MIT-blue.svg) ![PRs Welcome](https://img.shields.io/badge/PRs-welcome-blue.svg) ![JS 100%](https://img.shields.io/badge/JavaScript-100%25-green)

SystemLynx is a Node.js framework for building modular, distributed web applications using an RPC-style architecture. It enables services to expose structured modules whose methods can be invoked remotely from client applications, abstracting away much of the complexity of client-to-service communication.

Built on top of Express and Socket.io, SystemLynx supports both request-response and real-time communication patterns, allowing developers to build scalable APIs and event-driven systems with a unified interface.


SystemLynx comes with the following objects that are used for web app development:

```javascript
const { App, Service, Client, LoadBalancer } = require("systemlynx");
```

- **Service** - Used to create and host objects that can be loaded and used by a SystemLynx Client.
- **Client** - Used in a client application to load a **Service**, providing access to all the objects hosted by the **Service**.
- **App** - provides a modular interface for creating and loading Services.

Find the full [API Documentation](https://github.com/Odion100/SystemLynx/blob/master/API.md#tasksjs-api-documentation) here.

---

# Quick Start

## Service.module(name, constructor [,options])

Use the `Service.module(name, constructor/object)` method to add an object to be hosted by a **SystemLynx Service**. This will allows you to load an instance of that object into a client application, and call any methods on that object remotely.

```javascript
const { Service } = require("systemlynx");

const Users = {};

Users.add = function (data) {
  console.log(data);
  return { message: "You have successfully called the Users.add method" };
};

Service.module("Users", Users);
```

In the code above we assigned an object to the variable `Users` and gave it an add method. The `Service.module(name, constructor/object)` function takes the name assigned to the object as the first argument and the object itself as the second argument.

Alternatively, you can use a constructor function instead of an object as the second argument. In the example below we create another **Module** called "Orders". This time we use a constructor function as the second argument of the to **Service.module** function. The `this` value is the initial instance of the **Module** object. Every method added to the `this` value will be accessible when the object is loaded by a **SystemLynx Client**. Note: **Module** methods can be synchronous or asynchronous functions.

```javascript
const { Service } = require("systemlynx");

const Users = {};

Users.add = function (data) {
  console.log(data);
  return { message: "You have successfully called the Users.add method" };
};

Service.module("Users", Users);

Service.module("Orders", function () {
  const Orders = this;

  Orders.find = async function (arg1, arg2) {
    console.log(arg1, arg2);
    return { message: "You have successfully called the Orders.find method" };
  };
});
```

## Service.startService(options)

Before we can access the objects hosted by this **Service** from a client application, we need to call the `Service.startService(options)` function. This will start an **ExpressJS** Server and a **Socket.io** WebSocket Server, and set up routing for the **Service**. In the example below we added the `Service.startService(options)` function at the bottom, but the order does not matter.

```javascript
const { Service } = require("systemlynx");

const Users = {};

Users.add = function (data) {
  console.log(data);
  return { message: "You have successfully called the Users.add method" };
};

Service.module("Users", Users);

Service.module("Orders", function () {
  const Orders = this;

  Orders.find = async function (arg1, arg2) {
    console.log(arg1, arg2);
    return { message: "You have successfully called the Orders.find method" };
  };
});

Service.startService({ route: "test/service", port: "4400", host: "localhost" });
```

Now lets see how these objects can be loaded into a client application.

## Client.loadService(url, [options])

The `Client.loadService(url)` function can be used to load a SystemLynx **Service**. This method requires the url (string) of the **Service** you want to load as the first argument, and will return a promise that will resolve into an object that containing all the modules hosted by that service. See below. **NOTE: You must be within an async function in order to use the `await` keyword when returning a promise.**

```javascript
const { Client } = require("systemlynx");

const { Users, Orders } = await Client.loadService("http://localhost:4400/test/service");

console.log(Users, Orders);
```

Now that we've loaded the **Service** that we created in the previous example, and have a handle on the **Users** and **Orders** objects hosted by the **Service**, we can now call any method on those objects in the same way we would remotely. In the example below, noticed that both the `User.add` and `Orders.find` methods will return a promise.

```javascript
const { Client } = require("systemlynx");

const { Users, Orders } = await Client.loadService("http://localhost:4400/test/service");

console.log(Users, Orders);

const results = await Users.add({ message: "Users.add Test" });

console.log(results);

const response = await Orders.find("hello", "world");

console.log(response);
```

## Sending and Receiving Websocket Events

We can also receive WebSocket events emitted from the remote objects we've loaded using the `Client.loadService(url)` function. In the example below we're using the `Users.on(event_name, callback)` method to listen for events coming from the "Users" **Module**.

```javascript
const { Client } = require("systemlynx");

const { Users, Orders } = await Client.loadService("http://localhost:4400/test/service");

console.log(Users, Orders);

const results = await Users.add({ message: "Users.add Test" });

console.log(results);

Users.on("new_user", function (event) {
  console.log(event);
});

const response = await Orders.find("hello", "world");

console.log(response);
```

Now let's go to our server application and call the `Users.emit(event_name, data)` method to emit a websocket event that can be received by its corresponding Clients. Below, notice that we've added `this.emit("new_user", { message:"new_user event test" })` at the end of the `Users.add` method, so the `new_user` event will be emitted every time this method is called. The `this` value of a **Module** method will always be scoped to the **Module** itself.

```javascript
const { Service } = require("systemlynx");

const Users = {};

Users.add = function (data) {
  console.log(data);
  this.emit("new_user", { message: "new_user event test" });
  return { message: "You have successfully called the Users.add method" };
};

Service.module("Users", Users);

Service.module("Orders", function () {
  const Orders = this;

  Orders.find = async function (arg1, arg2) {
    console.log(arg1, arg2);
    return { message: "You have successfully called the Orders.find method" };
  };
});

Service.startService({ route: "test/service", port: "4400", host: "localhost" });
```

---

# Middleware

SystemLynx supports middleware that runs before or after a module method is called. This is useful for things like authentication, logging, or validating requests.

Use `Service.before` to add a middleware function that runs before any method is invoked, and `Service.after` to run one after the response is ready.

```javascript
const { Service } = require("systemlynx");

Service.before(function (req, res, next) {
  console.log("Incoming request:", req.fn);
  next();
});

Service.module("Users", Users);
Service.module("Orders", Orders);

Service.startService({ route: "api", port: 4400, host: "localhost" });
```

You can also scope middleware to a specific module or method so it only runs where you need it.

```javascript
// Runs before every method on the Users module
Service.before("Users", authMiddleware);

// Runs only before Users.delete
Service.before("Users.delete", requireAdminMiddleware);
```

See the [API Documentation](https://github.com/Odion100/SystemLynx/blob/master/API.md#tasksjs-api-documentation) for the full middleware API.

---

# Architecture: Monolith to Microservices

One of the core ideas behind SystemLynx is that your module code doesn't change depending on how you deploy it. You can start with everything in a single service and scale it out later — without rewriting anything.

## Start as a monolith

```javascript
const { Service } = require("systemlynx");

Service.module("Users", Users);
Service.module("Orders", Orders);
Service.module("Products", Products);

Service.startService({ route: "api", port: 4400, host: "localhost" });
```

Your client loads everything from one place:

```javascript
const { Users, Orders, Products } = await Client.loadService("http://localhost:4400/api");
```

## Scale out: move modules to their own services

When you're ready to scale, pull any module into its own service. The module code is unchanged — just move it and update the URL the client loads from.

```javascript
// users-service.js
Service.module("Users", Users);
Service.startService({ route: "users", port: 4401, host: "localhost" });

// orders-service.js
Service.module("Orders", Orders);
Service.startService({ route: "orders", port: 4402, host: "localhost" });
```

```javascript
// client
const { Users } = await Client.loadService("http://localhost:4401/users");
const { Orders } = await Client.loadService("http://localhost:4402/orders");
```

Because every module can be hosted independently, you can scale horizontally (run multiple instances of a service) or vertically (split a busy module into its own service) as your needs grow.

## Load Balancing

The **LoadBalancer** lets you run multiple clones of a service and distribute requests across them. Clones register themselves with the LoadBalancer, which handles routing — your client just talks to the LoadBalancer URL and doesn't need to know how many instances are running behind it.

```javascript
const { LoadBalancer } = require("systemlynx");

LoadBalancer.startService({ route: "users", port: 4400, host: "localhost" });
```

Each clone registers on startup:

```javascript
const { Client } = require("systemlynx");

const { clones } = await Client.loadService("http://localhost:4400/users");

await clones.register({ host: "localhost", port: 4401, route: "/users" });
```
