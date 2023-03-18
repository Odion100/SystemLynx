"use strict";
const createServerManager = require("../ServerManager/ServerManager");
const createDispatcher = require("../Dispatcher/Dispatcher");

module.exports = function createService(
  customServer,
  customWebSocketServer,
  systemContext = {}
) {
  const ServerManager = createServerManager(customServer, customWebSocketServer);
  const { startService, addRouteHandler, server, WebSocket } = ServerManager;
  const Service = { startService, server, WebSocket, before: addRouteHandler };

  Service.module = function (name, constructor, reserved_methods = []) {
    const exclude_methods = reserved_methods.concat(
      Object.getOwnPropertyNames(systemContext)
    );
    const before = (arg1, arg2) => {
      const fn = typeof arg1 === "string" ? `.${arg1}` : "";
      const handler = typeof arg1 === "function" ? arg1 : arg2;
      addRouteHandler(`${name}${fn}`, handler);
    };
    if (typeof constructor === "object" && constructor instanceof Object) {
      const Module = createDispatcher.apply(
        { ...constructor, ...systemContext, before },
        [undefined, systemContext]
      );
      ServerManager.addModule(name, Module, exclude_methods);
      return Module;
    }

    if (typeof constructor === "function") {
      if (constructor.constructor.name === "AsyncFunction")
        throw `[SystemLynx][Module][Error]: Module(name, constructor) function cannot receive an async function as the constructor`;

      const Module = createDispatcher.apply({ ...systemContext, before }, [
        undefined,
        systemContext,
      ]);
      constructor.apply(Module, [server, WebSocket]);
      ServerManager.addModule(name, Module, exclude_methods);
      return Module;
    }
  };
  return Service;
};
