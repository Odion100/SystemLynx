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

  // RFC 013 — CLOSING A CLIENT. Every `loadService` opens one socket per module PLUS one for the
  // service, and until now nothing could close them: `disconnect`/`destroy` live on each dispatcher
  // and nothing aggregated them. A caller that discards a client (SystemView's hub rebuilt one every
  // 20s on a failed proof) left 7 live sockets per discard with no handle attached to anything —
  // ~10,000 ESTABLISHED in 8 hours. Not RFC 010: that was re-application onto a live service; this
  // is repeated construction, and it leaked identically after that fix.
  //
  // The order below is the whole reason this belongs in the framework rather than in a caller:
  // `Service.on("disconnect", Service.resetConnection)` means a naive `disconnect()` FIRES A
  // RECONNECT and rebuilds everything it just closed.
  Client.unloadService = (url) => {
    const Service = Client.cachedServices[url];
    if (!Service) return false; // idempotent: safe on a failed proof, cached or not

    // Drop the entry FIRST so anything re-entrant can't resurrect this service mid-teardown.
    delete Client.cachedServices[url];

    const quietly = (fn) => {
      try {
        if (typeof fn === "function") fn();
      } catch (e) {
        /* a socket that never connected still has to be let go */
      }
    };

    // Stop the reconnect BEFORE anything closes, or teardown reopens itself. This removes only the
    // handler the client installed — a caller's own `on("disconnect", …)` is left alone.
    quietly(Service.__stopReconnect);

    Object.keys(Service).forEach((key) => {
      const Module = Service[key];
      if (!Module || !Module.__isClientModule) return;
      // destroy() unsubscribes tracked events OVER the socket, so it must run before the close.
      quietly(() => Module.destroy());
      quietly(() => Module.disconnect());
    });

    quietly(() => Service.destroy());
    quietly(() => Service.disconnect());
    return true;
  };

  // The discarded-client case: close everything this client ever loaded.
  Client.disconnect = () =>
    Object.keys(Client.cachedServices).reduce(
      (closed, url) => closed + (Client.unloadService(url) ? 1 : 0),
      0
    );

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

    // RFC 013 — KEEP THE UNSUBSCRIBE. `on()` hands back the function that removes exactly this
    // handler; discarding it is what forced teardown to reach for `$clearEvent("disconnect")`,
    // which removes EVERY disconnect listener including a caller's own. Precise beats broad.
    const stopReconnectingOnDisconnect = Service.on("disconnect", Service.resetConnection);
    Object.defineProperty(Service, "__stopReconnect", {
      value: stopReconnectingOnDisconnect,
      enumerable: false,
      configurable: true,
    });

    return Service;
  };

  return Client;
};
