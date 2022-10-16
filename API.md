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
   <summary><b><a href="https://github.com/Odion100/SystemLynx/tasksjs2.0/API.md">ClientModule</a></b></summary>
    
- [**[created_method]([args...] [,callback])**]() 
- [**on(name, constructor [,options])**]() 
- [**emit()**]()

</details>

<details>
   <summary><b><a href="https://github.com/Odion100/SystemLynx/tasksjs2.0/API.md">module</a></b></summary>
    
- [**[created_method]([args...] [,callback])**]() 
- [**on(name, constructor [,options])**]() 
- [**emit()**]()

</details>

---

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
