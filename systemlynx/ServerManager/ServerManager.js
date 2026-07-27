"use strict";
const createServer = require("./components/Server");
const createRouter = require("./components/Router");
const SocketEmitter = require("./components/SocketEmitter");
const parseMethods = require("./components/parseMethods");
const http = require("http");
const https = require("https");
const socketIO = require("socket.io");
const Hooker = require("../utils/Hooker");

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
    ssl: { key: "", cert: "" },
    protocol: "http",
  };

  const server = createServer(customServer);
  const router = createRouter(server, () => serverConfigurations);
  const moduleQueue = [];
  const modules = [];

  const ServerManager = { server };

  // The server is a hooker too: it composes the SAME agnostic Hooker as the client for before/after
  // MIDDLEWARE (namespace-keyed). Only the run context differs — the server runs each middleware as
  // (req, res, next) with `this` = req.Module and a throw → res.sendError, applied by wrap().
  Hooker.apply(ServerManager);
  const wrap = (mw) => async (req, res, next) => {
    try {
      await mw.apply(req.Module, [req, res, next]);
    } catch (error) {
      res.sendError(error);
    }
  };

  // Stop listening — frees the port and makes the service unreachable (graceful shutdown /
  // simulating a clone going down). No-op before startService.
  ServerManager.close = (cb = () => {}) => {
    // Closing the Socket.IO server disconnects clients and closes the underlying HTTP server.
    // (A plain httpServer.close() would hang forever waiting on the upgraded websocket.)
    if (ServerManager.WebSocket) return ServerManager.WebSocket.close(cb);
    if (ServerManager.httpServer) return ServerManager.httpServer.close(cb);
    cb();
  };

  ServerManager.startService = (options) => {
    let { route, host = "localhost", port, ssl, protocol } = options;

    route = route.charAt(0) === "/" ? route.substr(1) : route;
    route = route.charAt(route.length - 1) === "/" ? route.slice(0, -1) : route;

    if (!["http", "https"].includes(protocol)) protocol = ssl ? "https" : "http";
    const serviceUrl = `${protocol}://${host}:${port}/${route}`;

    const httpServer = ssl ? https.createServer(ssl, server) : http.createServer(server);
    ServerManager.httpServer = httpServer;
    const socketPath = `/${route}/socket.io`;

    const WebSocket = socketIO(httpServer, {
      path: socketPath,
      cors: {
        origin: "*",
        methods: ["GET", "POST"],
      },
    });

    ServerManager.WebSocket = WebSocket;
    SocketEmitter.apply(ServerManager, [route, WebSocket]);

    const wsProtocol = protocol === "https" ? "wss" : "ws";

    const connectionData = {
      modules,
      host,
      route: `/${route}`,
      port,
      serviceUrl,
      socketPath,
      namespace: `${wsProtocol}://${host}:${port}/${route}`,
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
          ServerManager.addModule(name, Module, reserved_methods),
        );
        moduleQueue.length = 0;
        resolve(connectionData);
      });
    });
  };

  ServerManager.addModule = (name, Module, reserved_methods = []) => {
    const { host, route, serviceUrl, useService, useREST, port, WebSocket, protocol } =
      serverConfigurations;

    if (!serviceUrl) return moduleQueue.push({ name, Module, reserved_methods });

    const exclude_methods = [
      "on",
      "emit",
      "before",
      "after",
      "$clearEvent",
      "once",
      "destroy",
      ...reserved_methods,
    ];
    const methods = parseMethods(Module, exclude_methods, useREST);
    const path = `${route}/${name}`;

    // This method's middleware, gathered from the composed Hooker (namespace: $all → name → name.fn,
    // by specificity) and wrapped into the server's (req, res, next) run context.
    const middlewareHooks = (kind, fn) =>
      Hooker.gather(kind, { namespaced: [ServerManager.__middleware] }, name, fn).map(
        wrap,
      );

    if (useService) {
      SocketEmitter.apply(Module, [path, WebSocket]);

      const wsProtocol = protocol === "https" ? "wss" : "ws";

      modules.push({
        namespace: `${wsProtocol}://${host}:${port}/${path}`,
        route: `/${path}`,
        name,
        methods,
      });

      methods.forEach((method) => {
        router.addService(
          Module,
          path,
          method,
          name,
          middlewareHooks("before", method.fn),
          middlewareHooks("after", method.fn),
        );
      });
    }

    if (useREST)
      methods.forEach((method) => {
        const beforeValidators = middlewareHooks("before", method.fn);
        const afterValidators = middlewareHooks("after", method.fn);

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
              afterValidators,
            );
        }
      });
  };

  // The Service layer calls addBeforware/addAfterware; route them to the composed Hooker's
  // before/after registration (namespace target + recursive array flattening handled there).
  ServerManager.addBeforware = (...args) => ServerManager.before(...args);
  ServerManager.addAfterware = (...args) => ServerManager.after(...args);

  return ServerManager;
};
