"use strict";
const createServerManager = require("../ServerManager/ServerManager");
const createDispatcher = require("../Dispatcher/Dispatcher");

module.exports = function createService(
  customServer,
  customWebSocketServer,
  systemContext = {}
) {
  const ServerManager = createServerManager(customServer, customWebSocketServer);
  const { startService, server, WebSocket } = ServerManager;
  const Service = { startService, server, WebSocket };

  Service.module = function (name, constructor, reserved_methods = []) {
    const exclude_methods = reserved_methods.concat(
      Object.getOwnPropertyNames(systemContext)
    );

    if (typeof constructor === "object" && constructor instanceof Object) {
      const Module = createDispatcher.apply({ ...constructor, ...systemContext }, [
        undefined,
        systemContext,
      ]);
      ServerManager.addModule(name, Module, exclude_methods);
      return Module;
    }

    if (typeof constructor === "function") {
      if (constructor.constructor.name === "AsyncFunction")
        throw `[SystemLynx][Module][Error]: Module(name, constructor) function cannot receive an async function as the constructor`;

      const Module = createDispatcher.apply(systemContext, [undefined, systemContext]);
      constructor.apply(Module, [server, WebSocket]);
      ServerManager.addModule(name, Module, exclude_methods);
      return Module;
    }
  };
  return Service;
};
