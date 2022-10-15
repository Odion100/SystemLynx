"use strict";
const loadConnectionData = require("./components/loadConnectionData");
const SocketDispatcher = require("./components/SocketDispatcher");
const ClientModule = require("./components/ClientModule");

module.exports = function SystemLynxClient() {
  const Client = {};
  Client.loadedServices = {};

  Client.loadService = async (url, options = {}) => {
    if (Client.loadedServices[url] && !options.forceReload)
      return Client.loadedServices[url];

    const connData = await loadConnectionData(url, options);
    const Service = SocketDispatcher(connData.namespace);
    Client.loadedServices[url] = Service;
    if (options.name) Client[options.name] = Service;

    Service.resetConnection = async (cb) => {
      const { modules, host, port, namespace } = await loadConnectionData(url, options);

      SocketDispatcher.apply(Service, [namespace]);

      modules.forEach(({ namespace, route, name }) =>
        Service[name].__setConnection(host, port, route, namespace)
      );

      if (typeof cb === "function") cb();
    };

    connData.modules.forEach(
      (mod) => (Service[mod.name] = ClientModule(mod, connData, Service.resetConnection))
    );

    Service.on("disconnect", Service.resetConnection);

    await new Promise((resolve) => Service.on("connect", resolve));
    return Service;
  };

  return Client;
};
