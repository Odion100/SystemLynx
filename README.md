# SystemLynx ![GitHub license](https://img.shields.io/badge/license-MIT-blue.svg) ![PRs Welcome](https://img.shields.io/badge/PRs-welcome-blue.svg) ![JS 100%](https://img.shields.io/badge/JavaScript-100%25-green)

SystemLynx is a framework for developing modular web APIs. It's a wrapper on top of ExpressJS and Socket.io. With SystemLynx, instead of creating a server with many endpoints, you can simply export objects from the server to the client application. Basically any objects added to a SystemLynx Service can be loaded and used by a SystemLynx Client.

SystemLynx comes with the following objects that are used for web API development:

```javascript
const { App, Service, Client, LoadBalancer } = require("sht-tasks");
```

Call `require("sht-tasks")` and de-concatenate from the object it returns. The main abstractions used for client-to-server interactions are the following:

- **Service** - Used to create and host objects that can be loaded and used by a SystemLynx Client.
- **Client** - Used in a client application to load a _Service_, which contains all the objects added to the _Service_.
- **App** - Provides a modular interface and lifecycle methods for asynchronously creating and loading _Services_.

Find the full [API Documentation](https://github.com/Odion100/SystemLynx/blob/tasksjs2.0/API.md#tasksjs-api-documentation) here.

---

# Quick Start

## Service.ServerModule(name, constructor [,options])

Use the `Service.ServerModule(name, constructor/object)` method to register an object to be hosted by a _SystemLynx Service_. This will allows you to load an instance of that object onto a client application, and call any methods on that object remotely.

```javascript
const { Service } = require("sht-tasks");

const Users = {};

Users.add = function (data, callback) {
  console.log(data);
  callback(null, { message: "You have successfully called the Users.add method" });
};

Service.ServerModule("Users", Users);
```

In the code above we assigned an object to the variable `Users` and gave it an add method. The `Service.ServerModule(name, constructor/object)` function takes the name assigned to the object as the first argument and the object itself as the second argument.

Alternatively, you can use a constructor function instead of an object as the second argument. In the example below we create another _ServerModule_ called
"Orders".

```javascript
const { Service } = require("sht-tasks");

const Users = {};

Users.add = function (data, callback) {
  console.log(data);
  callback(null, { message: "You have successfully called the Users.add method" });
};

Service.ServerModule("Users", Users);

Service.ServerModule("Orders", function () {
  const Orders = this;

  Orders.find = function (arg1, arg2, callback) {
    console.log(data);
    callback(null, { message: "You have successfully called the Orders.find method" });
  };
});
```

In the _ServerModule_ constructor function above, the `this` value is the initial instance of the _ServerModule_ object. Every method added to the `this` value will be accessible when the object is loaded by a _SystemLynx Client_. Notice that the method we created, `Orders.find = function(arg1, arg2, callback)...`, has 3 parameters including a callback function as the last argument. By defualt all _ServerModule_ methods will recieve a callback function as its last argument. Use the first parameter of the callback function to respond with an error, and the second parameter to send a success response. Note: _ServerModule_ methods can be configured to work with synchronous return values instead of asynchronous callbacks (read more about Service configuration [here](https://github.com/Odion100/SystemLynx/blob/tasksjs2.0/API.md#apploadserviceurl)).

## Service.startService(options)

Before we can access the objects hosted by this _Service_ from a client application, we need to call the `Service.startService(options)` function. This will start an **ExpressJS** Server and a **Socket.io** WebSocket Server, and set up routing for the _Service_. In the example below we added the `Service.startService(options)` function at the bottom, but the order does not matter.

```javascript
const { Service } = require("sht-tasks");

const Users = {};

Users.add = function (data, callback) {
  console.log(data);
  callback(null, { message: "You have successfully called the Users.add method" });
};

Service.ServerModule("Users", Users);

Service.ServerModule("Orders", function () {
  const Orders = this;

  Orders.find = function (arg1, arg2, callback) {
    console.log(data);
    callback(null, { message: "You have successfully called the Orders.find method" });
  };
});

Service.startService({ route: "test/service", port: "4400", host: "localhost" });
```

Now lets see how these objects can be loaded into a client application.

## Client.loadService(url, [options])

The `Client.loadService(url)` function can be used to load a SystemLynx _Service_. This method requires the url (string) of the _Service_ you want to load as the first argument, and will return a promise that will resolve into an object that containing all the modules hosted by that service. See below. **NOTE: You must be within an async function in order to use the `await` keyword when returning a promise.**

```javascript
const { Client } = require("sht-tasks");

const { Users, Orders } = await Client.loadService("http://localhost:4400/test/service");

console.log(Users, Orders);
```

Now that we've loaded the _Service_ that we created in the previous example, and have a handle on the _Users_ and _Orders_ objects hosted by the _Service_, we can now call any method on those objects. In the example below, we demonstrate that when a methods for the ServerModule objects is called from the client, it can optionally take a callback as the last argument or, if a callback is not used, it will return a promise. With the `Users.add(data, callback)` method we used a callback, but with the `Orders.find(arg1, arg2, callback)` method we left out the callback function and used the `await` keyword to return a promise.

```javascript
const { Client } = require("sht-tasks");

const { Users, Orders } = await Client.loadService("http://localhost:4400/test/service");

console.log(Users, Orders);

Users.add({ message: "Users.add Test" }, function (err, results) {
  if (err) console.log(err);
  else console.log(results);
});

const response = await Orders.find("hello", "world");

console.log(response);
```

## Sending and Receiving Websocket Events

We can also receive WebSocket events emitted from the remote objects we've loaded using the `Client.loadService(url)` function. In the example below we're using the `Users.on(event_name, callback)` method to listen for events coming from the "Users" _ServerModule_.

```javascript
const { Client } = require("sht-tasks");

const { Users, Orders } = await Client.loadService("http://localhost:4400/test/service");

console.log(Users, Orders);

Users.add({ message: "Users.add Test" }, function (err, results) {
  if (err) console.log(err);
  else console.log(results);
});

Users.on("new_user", function (event) {
  console.log(event);
});

const response = await Orders.find("hello", "world");

console.log(response);
```

Now let's go to our server application and call the `Users.emit(event_name, data)` method to emit a websocket event that can be received by its corresponding Clients. Below, notice that we've added `Users.emit("new_user", { message:"new_user event test" })` at the end of the `Users.add` method, so the `new_user` event will be emitted every time this method is called.

```javascript
const { Service } = require("sht-tasks");

const Users = {};

Users.add = function (data, callback) {
  console.log(data);
  callback(null, { message: "You have successfully called the Users.add method" });
  Users.emit("new_user", { message: "new_user event test" });
};

Service.ServerModule("Users", Users);

Service.ServerModule("Orders", function () {
  const Orders = this;

  Orders.find = function (arg1, arg2, callback) {
    console.log(data);
    callback(null, { message: "You have successfully called the Orders.find method" });
  };
});

Service.startService({ route: "test/service", port: "4400", host: "localhost" });
```
