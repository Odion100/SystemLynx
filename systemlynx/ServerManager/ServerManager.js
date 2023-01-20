"use strict";
const SystemLynxServer = require("./components/Server");
const SystemLynxRouter = require("./components/Router");
const SocketEmitter = require("./components/SocketEmitter");
const SystemLynxWebSocket = require("./components/WebSocketServer");
const parseMethods = require("./components/parseMethods");
const shortId = require("shortid");

module.exports = function SystemLynxServerManager() {
  let serverConfigurations = {
    route: null,
    port: null,
    host: "localhost",
    serviceUrl: null,
    socketPort: null,
    useREST: false,
    useService: true,
    staticRouting: false,
    middleware: [],
  };
  const server = SystemLynxServer();
  const router = SystemLynxRouter(server, () => serverConfigurations);
  const { SocketServer, WebSocket } = SystemLynxWebSocket();
  const moduleQueue = [];
  const modules = [];

  const ServerManager = { Server: () => server, WebSocket: () => WebSocket };

  ServerManager.startService = (options) => {
    let { route, host = "localhost", port, socketPort, staticRouting } = options;

    socketPort =
      socketPort || parseInt(Math.random() * parseInt(Math.random() * 10000)) + 1023;
    const namespace = staticRouting ? route : shortId();
    SocketServer.listen(socketPort);
    SocketEmitter.apply(ServerManager, [namespace, WebSocket]);

    route = route.charAt(0) === "/" ? route.substr(1) : route;
    route =
      route.charAt(route.length - 1) === "/" ? route.substr(route.length - 1) : route;
    const serviceUrl = `http://${host}:${port}/${route}`;

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

    const selectModules = (moduleList) =>
      moduleList.reduce(
        (sum, moduleName) =>
          sum.concat(modules.find(({ name }) => name === moduleName) || []),
        []
      );

    server.get(`/${route}`, (req, res) => {
      //The route will return connection data for the service including an array of
      //modules (objects) which contain instructions on how to make request to each object
      const { query } = req;

      res.json({
        ...connectionData,
        modules: query.modules ? selectModules(query.modules.split(",")) : modules,
      });
    });

    return new Promise((resolve) =>
      server.listen(port, () => {
        console.log(`[SystemLynx][Service]: Listening on ${serviceUrl}`);
        moduleQueue.forEach(({ name, Module, reserved_methods }) =>
          ServerManager.addModule(name, Module, reserved_methods)
        );
        moduleQueue.length = 0;
        resolve(connectionData);
      })
    );
  };

  ServerManager.addModule = (name, Module, reserved_methods = []) => {
    const { host, route, serviceUrl, staticRouting, useService, useREST, socketPort } =
      serverConfigurations;

    if (!serviceUrl) return moduleQueue.push({ name, Module, reserved_methods });
    const methods = parseMethods(Module, ["on", "emit", ...reserved_methods], useREST);
    const namespace = staticRouting ? name : shortId();

    SocketEmitter.apply(Module, [namespace, WebSocket]);

    if (useService) {
      const path = staticRouting ? `${route}/${name}` : `${shortId()}/${shortId()}`;

      modules.push({
        namespace: `http://${host}:${socketPort}/${namespace}`,
        route: `/${path}`,
        name,
        methods,
      });
      methods.forEach((method) => router.addService(Module, path, method, name));
    }
    if (useREST)
      methods.forEach((method) => {
        switch (method.fn) {
          case "get":
          case "put":
          case "post":
          case "delete":
            router.addREST(Module, `${route}/${name}`, method, name);
        }
      });
  };

  return ServerManager;
};
