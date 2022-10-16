"use strict";
const ServerManagerFactory = require("../ServerManager/ServerManager");
const Dispatcher = require("../Dispatcher/Dispatcher");

module.exports = function ServiceFactory({ defaultModule = {} } = {}) {
  const ServerManager = ServerManagerFactory();
  const { startService, Server, WebSocket } = ServerManager;
  const Service = { startService, Server, WebSocket, defaultModule };

  Service.module = function (name, constructor, reserved_methods = []) {
    if (typeof constructor === "object" && constructor instanceof Object) {
      ServerManager.addModule(name, constructor, reserved_methods);
      return constructor;
    }

    if (typeof constructor === "function") {
      if (constructor.constructor.name === "AsyncFunction")
        throw `[SystemLynx][Module][Error]: Module(name, constructor) function cannot receive an async function as the constructor`;

      const Module = Dispatcher.apply({ ...Service.defaultModule });
      const exclude_methods = [
        ...reserved_methods,
        ...Object.getOwnPropertyNames(Module),
      ];
      constructor.apply(Module, [ServerManager.Server(), ServerManager.WebSocket()]);
      ServerManager.addModule(name, Module, exclude_methods);
      return Module;
    }
  };
  return Service;
};
