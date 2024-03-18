# SystemLynx JS ![GitHub license](https://img.shields.io/badge/license-MIT-blue.svg) ![PRs Welcome](https://img.shields.io/badge/PRs-welcome-blue.svg) ![JS 100%](https://img.shields.io/badge/JavaScript-100%25-green)

SystemLynx is a NodeJS framework for building modular web APIs, built on top of ExpressJS and Socket.io. It allows you to create objects and load them from a server into a client application.

SystemLynx comes with the following class that are used for web app development:

```javascript
const { App, Service, Client, LoadBalancer } = require("systemlynx");
```

- **Service** - Used to create and host objects that can be loaded and used by a SystemLynx Client.
- **Client** - Used in a client application to load a **Service**, providing access to all the classes hosted by the **Service**.
- **App** - provides a modular interface for creating and loading Services.

Find the full [API Documentation](https://github.com/Odion100/SystemLynx/blob/master/API.md#tasksjs-api-documentation) here.

---

# Quick Start

## Service.module(name, constructor [,options])

Use the `Service.module(name, constructor/class)` method to add an class to be hosted by a **SystemLynx Service**. This will allows you to load an instance of that class into a client application, and call any methods on that class remotely.

```javascript
const { Service } = require("systemlynx");

const Users = {};

Users.add = function (data) {
  console.log(data);
  return { message: "You have successfully called the Users.add method" };
};

Service.module("Users", Users);
```

In the code above we assigned an class to the variable `Users` and gave it an add method. The `Service.module(name, constructor/class` function takes the name assigned to the class as the first argument and the class itself as the second argument.

Alternatively, you can use a constructor function instead of an class as the second argument. In the example below we create another **Module** called "Orders". This time we use a constructor function as the second argument of the to **Service.module** function. The `this` value is the initial instance of the **Module** class. Every method added to the `this` value will be accessible when the class is loaded by a **SystemLynx Client**. Note: **Module** methods can be synchronous or asynchronous functions.

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

The `Client.loadService(url)` function can be used to load a SystemLynx **Service**. This method requires the url (string) of the **Service** you want to load as the first argument, and will return a promise that will resolve into an class that containing all the modules hosted by that service. See below. **NOTE: You must be within an async function in order to use the `await` keyword when returning a promise.**

```javascript
const { Client } = require("systemlynx");

const { Users, Orders } = await Client.loadService("http://localhost:4400/test/service");

console.log(Users, Orders);
```

Now that we've loaded the **Service** that we created in the previous example, and have a handle on the **Users** and **Orders** class hosted by the **Service**, we can now call any method on those classes in the same way we would remotely. In the example below, noticed that both the `User.add` and `Orders.find` methods will return a promise.

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

We can also receive WebSocket events emitted from the remote classes we've loaded using the `Client.loadService(url)` function. In the example below we're using the `Users.on(event_name, callback)` method to listen for events coming from the "Users" **Module**.

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
  return { message: "You have successfully called the Users.add method" };
  this.emit("new_user", { message: "new_user event test" });
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
