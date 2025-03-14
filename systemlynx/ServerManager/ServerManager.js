"use strict";
const createServer = require("./components/Server");
const createRouter = require("./components/Router");
const SocketEmitter = require("./components/SocketEmitter");
const createWebSocket = require("./components/WebSocketServer");
const parseMethods = require("./components/parseMethods");
const shortId = require("shortid");
const randomPort = () => Math.floor(Math.random() * (65535 - 49152 + 1)) + 49152;
const createSSLServer = (app, options) => {
  const https = require("https");
  return https.createServer(options, app);
};

module.exports = function createServerManager(customServer, customWebSocketServer) {
  let serverConfigurations = {
    route: null,
    port: null,
    host: "localhost",
    serviceUrl: null,
    socketPort: null,
    useREST: false,
    useService: true,
    staticRouting: false,
    ssl: { key: "", cert: "" },
    beforeware: { $all: [] },
    afterware: { $all: [] },
  };
  const server = createServer(customServer);
  const router = createRouter(server, () => serverConfigurations);
  const { SocketServer, WebSocket } = createWebSocket(customWebSocketServer);
  const moduleQueue = [];
  const modules = [];

  const ServerManager = { server, WebSocket };

  ServerManager.startService = (options) => {
    let {
      route,
      host = "localhost",
      port,
      socketPort = randomPort(),
      staticRouting,
      ssl,
    } = options;

    const namespace = staticRouting ? route : shortId();
    SocketServer.listen(socketPort);
    SocketEmitter.apply(ServerManager, [namespace, WebSocket]);

    route = route.charAt(0) === "/" ? route.substr(1) : route;
    route =
      route.charAt(route.length - 1) === "/" ? route.substr(route.length - 1) : route;
    const protocol = ssl ? "https" : "http";
    const serviceUrl = `${protocol}://${host}:${port}/${route}`;

    serverConfigurations = {
      ...serverConfigurations,
      ...options,
      serviceUrl,
      route,
      socketPort,
    };
    const connectionData = {
      modules,
      host,
      route: `/${route}`,
      port,
      serviceUrl,
      namespace: `http://${host}:${socketPort}/${namespace}`,
      SystemLynxService: true,
    };

    server.get(`/${route}`, (req, res) => {
      //The route will return connection data for the service including an array of
      //modules (objects) which contain instructions on how to make request to each object
      res.json({ ...connectionData, modules });
    });

    return new Promise((resolve) => {
      const _server = ssl ? createSSLServer(server, ssl) : server;
      _server.listen(port, () => {
        console.log(`[SystemLynx][Service]: Listening on ${serviceUrl}\n`);
        moduleQueue.forEach(({ name, Module, reserved_methods }) =>
          ServerManager.addModule(name, Module, reserved_methods)
        );
        moduleQueue.length = 0;
        resolve(connectionData);
      });
    });
  };

  ServerManager.addModule = (name, Module, reserved_methods = []) => {
    const {
      host,
      route,
      serviceUrl,
      staticRouting,
      useService,
      useREST,
      socketPort,
      beforeware,
      afterware,
    } = serverConfigurations;

    if (!serviceUrl) return moduleQueue.push({ name, Module, reserved_methods });
    const exclude_methods = [
      "on",
      "emit",
      "before",
      "after",
      "$clearEvent",
      ...reserved_methods,
    ];
    const methods = parseMethods(Module, exclude_methods, useREST);
    const namespace = staticRouting ? name : shortId();

    SocketEmitter.apply(Module, [namespace, WebSocket]);
    const before_validators = [...beforeware.$all, ...(beforeware[name] || [])];
    const after_validators = [...afterware.$all, ...(afterware[name] || [])];

    if (useService) {
      const path = staticRouting ? `${route}/${name}` : `${shortId()}/${shortId()}`;

      modules.push({
        namespace: `http://${host}:${socketPort}/${namespace}`,
        route: `/${path}`,
        name,
        methods,
      });
      methods.forEach((method) => {
        const nsp = `${name}.${method.fn}`;
        const beforeValidators = [...before_validators, ...(beforeware[nsp] || [])];
        const afterValidators = [...after_validators, ...(afterware[nsp] || [])];
        router.addService(Module, path, method, name, beforeValidators, afterValidators);
      });
    }
    if (useREST)
      methods.forEach((method) => {
        const nsp = `${name}.${method.fn}`;
        const beforeValidators = [...before_validators, ...(beforeware[nsp] || [])];
        const afterValidators = [...after_validators, ...(afterware[nsp] || [])];
        switch (method.fn) {
          case "get":
          case "put":
          case "post":
          case "delete":
            router.addREST(
              Module,
              `${route}/${name}`,
              method,
              name,
              beforeValidators,
              afterValidators
            );
        }
      });
  };

  // Shared function for adding middleware (both beforeware and afterware)
  const addMiddleware = (type, ...args) => {
    const name = typeof args[0] === "string" ? args.shift() : "$all";
    args.forEach(async (middleware) => {
      if (Array.isArray(middleware)) {
        middleware.map((m) => addMiddlewareItem(type, name, m));
      } else {
        addMiddlewareItem(type, name, middleware);
      }
    });
  };

  // Helper function to add a single middleware item
  const addMiddlewareItem = (type, name, middleware) => {
    if (Array.isArray(middleware))
      return middleware.map((m) => addMiddlewareItem(type, name, m));

    if (!serverConfigurations[type][name]) {
      serverConfigurations[type][name] = [];
    }

    serverConfigurations[type][name].push(async function (req, res, next) {
      try {
        await middleware(req, res, next);
      } catch (error) {
        res.sendError(error);
      }
    });
  };

  // Use the shared function for both middleware types
  ServerManager.addBeforware = (...args) => addMiddleware("beforeware", ...args);
  ServerManager.addAfterware = (...args) => addMiddleware("afterware", ...args);
  return ServerManager;
};

//creating an ssl setup with openssl cli
//1. `openssl genrsa -out key.pem` to generate a private key
//2. create a certificate signing request using the key we just generated
// `openssl req -new -key key.pem -out csr.pem`
//3. Answer the prompts in the terminal
//4. use the newly generate csr to generate a ssl certificate
// openssl x509 -req -days 365 -in csr.pem -signkey key.pem -out cert.pem
//(x509 is the standard to use for the certificate, days are the number of day the cert is valid)
//5. csr.pem is no longer needed
