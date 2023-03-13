"use strict";
const ServiceRequestHandler = require("./ServiceRequestHandler");
const SocketDispatcher = require("./SocketDispatcher");
const getProtocol = (url) => url.match(/^(\w+):\/\//)[0];

module.exports = function SystemLynxClientModule(
  httpClient,
  { methods, namespace, route, connectionData, name },
  { port, host, serviceUrl },
  reconnectService,
  systemContext
) {
  const events = {};
  const ClientModule = {};

  ClientModule.__setConnection = (host, port, route, namespace) => {
    ClientModule.__connectionData = () => ({ route, host, port });

    SocketDispatcher.apply(ClientModule, [namespace, events, systemContext]);
  };
  ClientModule.__setConnection(host, port, route, namespace);

  const reconnectModule = async (cb) => {
    const url = connectionData.serviceUrl + `?modules=${name}`;
    const { modules, port, host } = await loadConnectionData(url);
    const { namespace, route } = modules[0];
    ClientModule.__setConnection(host, port, route, namespace);

    if (typeof cb === "function") cb();
  };
  const protocol = getProtocol(serviceUrl);
  methods.forEach(({ method, fn }) => {
    ClientModule[fn] = ServiceRequestHandler.apply(ClientModule, [
      httpClient,
      protocol,
      method,
      fn,
      reconnectService,
      connectionData && reconnectModule,
    ]);
  });

  return ClientModule;
};
