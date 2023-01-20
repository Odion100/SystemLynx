"use strict";
const loadConnectionData = require("./components/loadConnectionData");
const SocketDispatcher = require("./components/SocketDispatcher");
const ClientModule = require("./components/ClientModule");

module.exports = function SystemLynxClient(systemContext) {
  const Client = {};
  Client.loadedServices = {};

  Client.loadService = async (url, options = {}) => {
    if (Client.loadedServices[url] && !options.forceReload)
      return Client.loadedServices[url];

    const connData = await loadConnectionData(url, options);
    const Service = Client.createService(connData);
    if (options.name) Client[options.name] = Service;
    await new Promise((resolve) => Service.on("connect", resolve));
    return Service;
  };

  Client.createService = (connData) => {
    const Service = SocketDispatcher(connData.namespace, undefined, systemContext);

    Service.resetConnection = async (cb) => {
      const { modules, host, port, namespace } = await loadConnectionData(url);

      SocketDispatcher.apply(Service, [namespace, undefined, systemContext]);

      modules.forEach(({ namespace, route, name }) =>
        Service[name].__setConnection(host, port, route, namespace)
      );

      if (typeof cb === "function") cb();
    };

    connData.modules.forEach(
      (mod) =>
        (Service[mod.name] = ClientModule(
          mod,
          connData,
          Service.resetConnection,
          systemContext
        ))
    );

    Service.on("disconnect", Service.resetConnection);

    return Service;
  };

  return Client;
};
