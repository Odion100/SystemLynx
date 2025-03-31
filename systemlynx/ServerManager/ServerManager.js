"use strict";
const createServer = require("./components/Server");
const createRouter = require("./components/Router");
const SocketEmitter = require("./components/SocketEmitter");
const parseMethods = require("./components/parseMethods");
const shortId = require("shortid");
const http = require("http");
const https = require("https");
const socketIO = require("socket.io");

module.exports = function createServerManager(customServer) {
  let serverConfigurations = {
    server: null,
    WebSocket: null,
    route: null,
    port: null,
    host: "localhost",
    serviceUrl: null,
    port: null,
    useREST: false,
    useService: true,
    staticRouting: false,
    ssl: { key: "", cert: "" },
    beforeware: { $all: [] },
    afterware: { $all: [] },
    protocol: "http",
  };

  const server = createServer(customServer);
  const router = createRouter(server, () => serverConfigurations);
  const moduleQueue = [];
  const modules = [];

  const ServerManager = { server };

  ServerManager.startService = (options) => {
    let { route, host = "localhost", port, staticRouting, ssl, protocol } = options;

    route = route.charAt(0) === "/" ? route.substr(1) : route;
    route = route.charAt(route.length - 1) === "/" ? route.slice(0, -1) : route;

    const namespace = staticRouting ? route : shortId();
    if (!["http", "https"].includes(protocol)) protocol = ssl ? "https" : "http";
    const serviceUrl = `${protocol}://${host}:${port}/${route}`;

    const httpServer = ssl ? https.createServer(ssl, server) : http.createServer(server);

    const WebSocket = socketIO(httpServer);

    SocketEmitter.apply(ServerManager, [namespace, WebSocket]);

    const wsProtocol = protocol === "https" ? "wss" : "ws";

    const connectionData = {
      modules,
      host,
      route: `/${route}`,
      port,
      serviceUrl,
      namespace: `${wsProtocol}://${host}:${port}/${namespace}`,
      SystemLynxService: true,
    };

    Object.assign(serverConfigurations, {
      ...options,
      server: httpServer,
      WebSocket,
      serviceUrl,
      route,
      port,
      protocol,
    });

    server.get(`/${route}`, (req, res) => {
      res.json({ ...connectionData, modules });
    });

    return new Promise((resolve) => {
      httpServer.listen(port, () => {
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
      port,
      beforeware,
      afterware,
      WebSocket,
      protocol,
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
      const wsProtocol = protocol === "https" ? "wss" : "ws";

      modules.push({
        namespace: `${wsProtocol}://${host}:${port}/${namespace}`,
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

  ServerManager.addBeforware = (...args) => addMiddleware("beforeware", ...args);
  ServerManager.addAfterware = (...args) => addMiddleware("afterware", ...args);

  return ServerManager;
};
