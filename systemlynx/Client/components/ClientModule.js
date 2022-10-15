"use strict";
const ServiceRequestHandler = require("./ServiceRequestHandler");
const SocketDispatcher = require("./SocketDispatcher");
module.exports = function SystemLynxClientModule(
  { methods, namespace, route },
  { port, host },
  resetConnection
) {
  const events = {};
  const ClientModule = this || {};

  ClientModule.__setConnection = (host, port, route, namespace) => {
    ClientModule.__connectionData = () => ({ route, host, port });
    SocketDispatcher.apply(ClientModule, [namespace, events]);
  };

  ClientModule.__setConnection(host, port, route, namespace);

  methods.forEach(({ method, fn }) => {
    ClientModule[fn] = ServiceRequestHandler.apply(ClientModule, [
      method,
      fn,
      resetConnection,
    ]);
  });

  return ClientModule;
};
