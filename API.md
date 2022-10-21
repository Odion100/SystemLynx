**IN WORKING PROGRESS**

# SystemLynx API Documentation

Welcome to the docs! Following is a list of the objects used and created when developing web APIs with SystemLynx. SystemLynx is an end-to-end framework for developing modular, microservices software systems in NodeJS. Check out [**Quick Start**](https://github.com/Odion100/SystemLynx#quick-start) for an example of how simple it is to develope object-orientated APIs with SystemLynx.

<details>
   <summary><b><a href="https://github.com/Odion100/SystemLynx/blob/tasksjs2.0/API.md#app">App</a></b></summary>
    
- [**startService(options)**](https://github.com/Odion100/SystemLynx/blob/tasksjs2.0/API.md#appstartserviceoptions) 
- [**loadService(name, url)**](https://github.com/Odion100/SystemLynx/blob/tasksjs2.0/API.md#apploadserviceurl) 
- [**onLoad(callback)**](https://github.com/Odion100/SystemLynx/tasksjs2.0/API.md#apponloadcallback) 
- [**module(name, constructor [,reserved_methods])**]() 
- [**config(constructor)**](https://github.com/Odion100/SystemLynx/tasksjs2.0/API.md#appconfigconstructor) 
- [**on(event, callback)**]() 
- [**emit(event, payload)**]()

</details>

<details>
   <summary><b><a href="https://github.com/Odion100/SystemLynx/tasksjs2.0/API.md#client">Client</a></b></summary>
    
- [**loadService(url)**]()

</details>

<details>
   <summary><b><a href="https://github.com/Odion100/SystemLynx/tasksjs2.0/API.md#service">Service</a></b></summary>
    
- [**startService(options)**]() 
- [**module(name, constructor [,options])**]() 
- [**Server()**]() 
- [**WebSocket()**]()

</details>

<details>
   <summary><b><a href="https://github.com/Odion100/SystemLynx/tasksjs2.0/API.md#service">LoadBalancer</a></b></summary>
    
- [**startService(options)**]() 
- [**module(name, constructor [,options])**]() 
- [**Server()**]() 
- [**WebSocket()**]() 
- [**clones**]()
  - [**register(options)**]()  
  - [**dispatch(event)**]()
  - [**assignDispatch(event)**]()

</details>

---

<details>
   <summary><b><a href="https://github.com/Odion100/SystemLynx/tasksjs2.0/API.md">ServerModule</a></b></summary>
    
- [**...constructedMethods**]()
- [**on(name, callback)**]() 
- [**emit(name, data)**]()

</details>

<details>
   <summary><b><a href="https://github.com/Odion100/SystemLynx/tasksjs2.0/API.md">ClientModule</a></b></summary>
    
- [**...loadedMethods**]() 
- [**on(name, callback)**]() 
- [**emit(name, data)**]()

</details>

---

## Service.module(name, constructor)

Use the `Service.module(name, constructor/object)` method to create a **ServerModule**, which is an object that is hosted by a **SystemLynx Service**. This will allows you to later load an instance of that object into a client application. The **Service.module(name, constructor)** method takes the (string) name assigned to the object as the first argument, and the object itself, or a constructor function, as the second argument, and will return the constructed **ServerModule.** See the examples below.

```javascript
const { Service } = require("systemlynx");

const UsersConstructor = {
  add:function(data) {
   return { message: "You have successfully called Users.add(...)" };
  }
};
constr OrdersConstructor = function () {
  const Orders = this;

  Orders.find = function (arg1, arg2) {
    return { message: "You have successfully called the Orders.find(...)" };
  };
}

const Users = Service.module("Users", UsersConstructor);

const Orders = Service.module("Orders", OrdersConstructor);
```

## Service.startService(options)

Use the `Service.startService(options)` method to setup hosting and routing for the **Service**. Calling this method will start an **ExpressJS** Server and a **Socket.io** WebSocket Server, and allow the modules created by the **Service** to be loaded into a client application. This method returns a promise that will resolve once the Express server is running.

```javascript
const { Service } = require("systemlynx");
const route = "my-route/whatever";
const port = 8100;
const host = "localhost";

const promise = Service.startService({ route, port, host });
```

Following is a list of options that can be passed to the **Service.startService(options)** method.

| Name          |  Type   | O/R/C | Description                                                                                                                                            |
| :------------ | :-----: | :---: | :----------------------------------------------------------------------------------------------------------------------------------------------------- |
| route         | string  |   R   | The route from which the service can be loaded.                                                                                                        |
| port          | number  |   R   | The port on which to start the Express server.                                                                                                         |
| host          | string  |   O   | The host from which the **Service** can be reached.                                                                                                    |
| socketPort    | string  |   R   | The port on which to start the Socket.io Websocket server. <br/><br/> Default value : **_random for digit number_**                                    |
| useRest       | boolean |   O   | When this is true a RESTful route will be created for any **ServerModule** method which is named after a REST method <br/><br/> Default value: `false` |
| useService    | boolean |   O   | The route from which the service can be loaded.                                                                                                        |
| staticRouting | boolean |   O   | The route from which the service can be loaded.                                                                                                        |
| middleware    | string  |   R   | The route from which the service can be loaded.                                                                                                        |

## App

**App** combinds the both functionalites of SystemLynx Service and Client into one object, while also providing a module interface and lifecycle events. Access the App instance by deconcatanating from the object return when loading SystemLynx `require("systemlynx")`.

```javascript
const { App } = require("systemlynx");
```

## App.module(name, constructor [,reserved_methods])

Use **App.module(name, constructor)** function to create or pass an object that can be loaded by a SystemLynx Client.

- **_name_** (string) - name assigned to the module or object
- **_constructor_** (object/function) -

## App.startService(options)

## App.loadService(name, url)

## App.onLoad(callback)

## App.module(name, constructor)

## App.config(constructor)

---

## Client

## Client.loadService(url)

---

## Service

Service is a SystemLynx abstraction used to server objects that can be loaded by a SystemLynx Client using the `Client.loadService(url)` method.

Call require("systemlynx") and de-concatenate from the object it returns.

```javascript
const { Service } = require("systemlynx");
```

The Service object has the following methods:

- **_Service.module(name, constructor [,reserved_methods])_** - Used to create or pass an object that is hosted by the Service.
- **_Service.startService(options)_** - Used
- **_Service.Server()_** - Returns the expressJS app instance used to handle routing to the _Services_.
- **_Service.WebSocket()_** - Returns socket.io WebSocket instance used to emit events from the _Services_.

## Service.module(name, constructor [,reserved_methods])

- **Name** - String -
  Use the `Service.module(name, constructor, [,options])` method to register an object to be hosted by a _SystemLynx Service_. This will allows you to load an instance of that object onto a client application, and call any methods on that object remotely.

```javascript
const { Service } = require("systemlynx");

const Users = {};

Users.add = function (data, callback) {
  console.log(data);
  callback(null, { message: "You have successfully called the Users.add method" });
};
```

Service.startService

---
