"use strict";
const loadConnectionData = require("./components/loadConnectionData");
const SocketDispatcher = require("./components/SocketDispatcher");
const HeaderSetter = require("./components/HeaderSetter");
const ClientModule = require("./components/ClientModule");
const HttpClient = require("../HttpClient/HttpClient");
const Hooker = require("../utils/Hooker");

module.exports = function createClient(httpClient = HttpClient(), systemContext) {
  const Client = {};
  Client.cachedServices = {};

  // RFC 005: the client is a hooks-haver — client-level before/after apply to every outbound call
  // on every loaded service. Composed the same way as HeaderSetter.
  Hooker.apply(Client);
  Client.use = (plugin) => (plugin(Client), Client);

  Client.loadService = async (url, options = {}) => {
    if (Client.cachedServices[url] && !options.forceReload)
      return Client.cachedServices[url];

    const connData = await loadConnectionData(httpClient, url, options);
    const Service = Client.createService(connData);
    Client.cachedServices[url] = Service;
    await new Promise((resolve) => Service.on("connect", resolve));
    return Service;
  };

  Client.createService = (connData) => {
    const events = {};

    if (Client.cachedServices[connData.serviceUrl])
      return Client.cachedServices[connData.serviceUrl];

    const Service = {};
    SocketDispatcher.apply(Service, [connData, events, systemContext]);
    HeaderSetter.apply(Service);
    Client.cachedServices[connData.serviceUrl] = Service;

    // RFC 005: the service instance is a hooks-haver — before/after apply to every call on this
    // loaded service. Composed the same way (non-enumerable, so the public shape is unchanged).
    Hooker.apply(Service);

    Service.resetConnection = async (cb) => {
      try {
        const { modules, host, port, route, namespace, socketPath } =
          await loadConnectionData(httpClient, connData.serviceUrl);

        SocketDispatcher.apply(Service, [
          { socketPath, namespace },
          events,
          systemContext,
        ]);

        modules.forEach(({ namespace, route, name }) => {
          if (Service[name]) {
            Service[name].__setConnection({ host, port, route, namespace, socketPath });
            Service[name].emit("reconnect");
          }
        });

        Service.emit("reconnect");
        if (typeof cb === "function") cb();
      } catch (error) {
        console.error(
          `[SystemLynx][Client]: Failed to reconnect service @${connData.serviceUrl}`
        );
        // surface the failure so callers reject instead of hanging on an unfulfilled retry
        if (typeof cb === "function") cb(error);
      }
    };

    connData.modules.forEach(
      (mod) =>
        (Service[mod.name] = ClientModule(
          httpClient,
          mod,
          connData,
          Service,
          systemContext,
          { client: Client.__middleware, service: Service.__middleware }
        ))
    );

    Service.on("disconnect", Service.resetConnection);

    return Service;
  };

  return Client;
};
