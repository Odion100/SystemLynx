"use strict";
const SystemLynxServerManager = require("../ServerManager/ServerManager");
const SystemLynxDispatcher = require("../Dispatcher/Dispatcher");

module.exports = function SystemLynxService(systemContext = {}) {
  const ServerManager = SystemLynxServerManager();
  const { startService, server, WebSocket } = ServerManager;
  const Service = { startService, server, WebSocket };

  Service.module = function (name, constructor, reserved_methods = []) {
    const exclude_methods = reserved_methods.concat(
      Object.getOwnPropertyNames(systemContext)
    );

    if (typeof constructor === "object" && constructor instanceof Object) {
      const Module = SystemLynxDispatcher.apply({ ...constructor, ...systemContext }, [
        undefined,
        systemContext,
      ]);
      ServerManager.addModule(name, Module, exclude_methods);
      return Module;
    }

    if (typeof constructor === "function") {
      if (constructor.constructor.name === "AsyncFunction")
        throw `[SystemLynx][Module][Error]: Module(name, constructor) function cannot receive an async function as the constructor`;

      const Module = SystemLynxDispatcher.apply(systemContext, [
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
