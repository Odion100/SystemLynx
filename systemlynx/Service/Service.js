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
    const before = (...args) => {
      if (typeof args[0] === "string") {
        const arg1 = args.shift();
        const fn = arg1 === "$all" ? "" : `.${arg1}`;
        addRouteHandler(`${name}${fn}`, ...args);
      } else {
        addRouteHandler(`${name}`, ...args);
      }
    };
    if (typeof constructor === "object" && constructor instanceof Object) {
      const Module = createDispatcher.apply(
        {
          ...Object.getOwnPropertyNames(constructor).reduce((obj, fn) => {
            if (typeof constructor[fn] === "function") obj[fn] = constructor[fn];
            return obj;
          }, {}),
          ...systemContext,
          before,
        },
        [undefined, systemContext]
      );
      ServerManager.addModule(name, Module, exclude_methods);
      return Module;
    }

    if (typeof constructor === "function") {
      if (constructor.constructor.name === "AsyncFunction")
        throw `[SystemLynx][Service][Error]: Module(name, constructor) function cannot receive an async function as the constructor`;

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
