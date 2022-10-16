"use strict";
const ServerManagerFactory = require("../ServerManager/ServerManager");
const Dispatcher = require("../Dispatcher/Dispatcher");

module.exports = function ServiceFactory({ defaultModule = {} } = {}) {
  const ServerManager = ServerManagerFactory();
  const { startService, Server, WebSocket } = ServerManager;
  const Service = { startService, Server, WebSocket, defaultModule };

  Service.ServerModule = function (name, constructor, reserved_methods = []) {
    if (typeof constructor === "object" && constructor instanceof Object) {
      ServerManager.addModule(name, constructor, reserved_methods);
      return constructor;
    }

    if (typeof constructor === "function") {
      if (constructor.constructor.name === "AsyncFunction")
        throw `[SystemLynx][ServerModule][Error]: ServerModule(name, constructor) function cannot receive an async function as the constructor`;

      const ServerModule = Dispatcher.apply({ ...Service.defaultModule });
      const exclude_methods = [
        ...reserved_methods,
        ...Object.getOwnPropertyNames(ServerModule),
      ];
      constructor.apply(ServerModule, [
        ServerManager.Server(),
        ServerManager.WebSocket(),
      ]);
      ServerManager.addModule(name, ServerModule, exclude_methods);
      return ServerModule;
    }
  };
  return Service;
};
