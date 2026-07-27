"use strict";
const headerSetter = require("./HeaderSetter");
const ServiceRequestHandler = require("./ServiceRequestHandler");
const SocketDispatcher = require("./SocketDispatcher");
const Hooker = require("../../utils/Hooker");
const getProtocol = (url) => url.match(/^(\w+):\/\//)[0];

module.exports = function SystemLynxClientModule(
  httpClient,
  { methods, namespace, route, connectionData, name },
  { port, host, serviceUrl, socketPath },
  Service,
  systemContext,
  { client, service } = {}
) {
  const events = {};
  const ClientModule = headerSetter.apply({});

  // RFC 005: the module is a hooks-haver (composed like HeaderSetter). `__hooks` carries the
  // client/service-instance/module stores so the request handler can gather the full before/after
  // chain (client → service instance → module) off `this`. Internals non-enumerable so the
  // module's public shape (which exact-shape contracts assert) is unchanged.
  Hooker.apply(ClientModule);
  Object.defineProperties(ClientModule, {
    __name: { value: name },
    __middlewareStores: {
      // client + service instance are namespace-addressed; this module's own store is scoped to it
      value: { namespaced: [client, service], scoped: [ClientModule.__middleware] },
    },
    __isClientModule: { value: true }, // RFC 007: lets useService's caller-bound view find modules
  });

  ClientModule.__setConnection = ({ host, port, route, namespace, socketPath }) => {
    ClientModule.__connectionData = () => ({ route, host, port });

    SocketDispatcher.apply(ClientModule, [
      { namespace, socketPath },
      events,
      systemContext,
    ]);
  };
  ClientModule.__setConnection({ host, port, route, namespace, socketPath });

  // On a transport failure, reconnect at the *service* level via Service.resetConnection:
  // it re-fetches connectionData from serviceUrl (the LoadBalancer route when loaded through
  // an LB — so a dead clone fails over to a live one), re-points every module, and retries.
  // (The old per-module reconnect referenced an unimported loadConnectionData and hung.)
  const protocol = getProtocol(serviceUrl);
  methods.forEach(({ method, fn }) => {
    ClientModule[fn] = ServiceRequestHandler.apply(ClientModule, [
      httpClient,
      protocol,
      method,
      fn,
      Service,
      null,
    ]);
  });

  return ClientModule;
};
