"use strict";
const createServerManager = require("../ServerManager/ServerManager");
const createDispatcher = require("../Dispatcher/Dispatcher");

module.exports = function createService(
  customServer,
  customWebSocketServer,
  systemContext = {}
) {
  const ServerManager = createServerManager(customServer, customWebSocketServer);
  const { startService, addBeforware, addAfterware, server } = ServerManager;
  const Service = {
    startService,
    server,
    before: addBeforware,
    after: addAfterware,
    close: (...args) => ServerManager.close(...args),
  };

  // RFC 012 — how a composed capability publishes its own facts in `GET /<route>`. Non-enumerable
  // for the same reason as on ServerManager: plumbing, not public surface.
  // Same passthrough, same reason (see ServerManager.__arity): a count, never a function.
  Object.defineProperty(Service, "__arity", {
    get: () => ServerManager.__arity,
    enumerable: false,
    configurable: true,
  });

  Object.defineProperty(Service, "__inputKeys", {
    get: () => ServerManager.__inputKeys,
    enumerable: false,
    configurable: true,
  });

  Object.defineProperty(Service, "contributeConnectionData", {
    value: (...args) => ServerManager.contributeConnectionData(...args),
    enumerable: false,
    configurable: true,
  });
  // `WebSocket` only exists once startService has built it, so read it live — destructuring it
  // here handed out `undefined` forever, including to every module constructor below.
  Object.defineProperty(Service, "WebSocket", {
    enumerable: true,
    get: () => ServerManager.WebSocket,
  });

  Service.module = function (name, constructor, reserved_methods = []) {
    const exclude_methods = reserved_methods.concat(
      Object.getOwnPropertyNames(systemContext)
    );
    const before = (...args) => {
      if (typeof args[0] === "string") {
        const arg1 = args.shift();
        const fn = arg1 === "$all" ? "" : `.${arg1}`;
        addBeforware(`${name}${fn}`, ...args);
      } else {
        addBeforware(`${name}`, ...args);
      }
    };
    const after = (...args) => {
      if (typeof args[0] === "string") {
        const arg1 = args.shift();
        const fn = arg1 === "$all" ? "" : `.${arg1}`;
        addAfterware(`${name}${fn}`, ...args);
      } else {
        addAfterware(`${name}`, ...args);
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
          after,
        },
        [undefined, systemContext]
      );
      ServerManager.addModule(name, Module, exclude_methods);
      return Module;
    }

    if (typeof constructor === "function") {
      if (constructor.constructor.name === "AsyncFunction")
        throw `[SystemLynx][Service][Error]: Module(name, constructor) function cannot receive an async function as the constructor`;

      const Module = createDispatcher.apply({ ...systemContext, before, after }, [
        undefined,
        systemContext,
      ]);
      constructor.apply(Module, [server, ServerManager.WebSocket]);
      ServerManager.addModule(name, Module, exclude_methods);
      return Module;
    }
  };
  return Service;
};
