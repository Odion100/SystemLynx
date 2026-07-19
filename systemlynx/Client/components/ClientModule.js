"use strict";
const headerSetter = require("./HeaderSetter");
const ServiceRequestHandler = require("./ServiceRequestHandler");
const SocketDispatcher = require("./SocketDispatcher");
const getProtocol = (url) => url.match(/^(\w+):\/\//)[0];

module.exports = function SystemLynxClientModule(
  httpClient,
  { methods, namespace, route, connectionData, name },
  { port, host, serviceUrl, socketPath },
  Service,
  systemContext
) {
  const events = {};
  const ClientModule = headerSetter.apply({});

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
