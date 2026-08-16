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

    // RFC 010 — one reconnect at a time. An outage fires `disconnect` on the service and on every
    // module, so without this a single blip starts a reconnect per event; each opens sockets and
    // the losers get overwritten before anything can close them.
    let reconnecting = null;

    const rebuild = async () => {
      const { modules, host, port, route, namespace, socketPath } =
        await loadConnectionData(httpClient, connData.serviceUrl);

      SocketDispatcher.apply(Service, [
        { socketPath, namespace },
        events,
        systemContext,
      ]);

      modules.forEach(({ namespace, route, name, connectionData }) => {
        if (Service[name]) {
          // RFC 006: re-point each module to ITS OWN location from the freshly-composed view,
          // so one module's dead location doesn't drag its siblings. Falls back to the
          // service-level location for a plain single-location service (today's behavior).
          const loc = connectionData || {};
          Service[name].__setConnection({
            host: loc.host || host,
            port: loc.port || port,
            route,
            namespace,
            socketPath: loc.socketPath || socketPath,
          });
          Service[name].emit("reconnect");
        }
      });

      Service.emit("reconnect");
    };

    Service.resetConnection = async (cb) => {
      // A reconnect already running is the one we want — join it rather than start a rival.
      if (!reconnecting) reconnecting = rebuild().finally(() => (reconnecting = null));
      try {
        await reconnecting;
        if (typeof cb === "function") cb();
      } catch (error) {
        console.error(
          `[SystemLynx][Client]: Failed to reconnect service @${connData.serviceUrl}`
        );
        // surface the failure so callers reject instead of hanging on an unfulfilled retry
        if (typeof cb === "function") cb(error);
      }
    };

    // RFC 011 — the service-level counterpart: scope every module in one call.
    //
    //   const asUser = Profiles.withHeaders({ "Internal-Identity": sid });
    //   await asUser.Teams.add(team);
    //   await asUser.Users.get(id);
    //
    // The request handler reads the SERVICE from a closure (not `this`), so this can't work by
    // overriding `Service.headers()`. It scopes each module view instead — module headers layer on
    // top of the service's, so the result is the same and the shared service is untouched.
    Service.withHeaders = function withHeaders(extra = {}) {
      return new Proxy(Service, {
        get(target, prop, receiver) {
          if (prop === "withHeaders")
            return (more = {}) => target.withHeaders({ ...extra, ...more });
          const value = Reflect.get(target, prop, receiver);
          return value && value.__isClientModule ? value.withHeaders(extra) : value;
        },
        set() {
          throw new Error(
            "[SystemLynx][Client]: a withHeaders view is read-only — set on the service itself"
          );
        },
      });
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
