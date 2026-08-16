"use strict";
import headerSetter from "./HeaderSetter.mjs";
import ServiceRequestHandler from "./ServiceRequestHandler.mjs";
import SocketDispatcher from "./SocketDispatcher.mjs";
import Hooker from "../../../utils/Hooker.mjs";

const getProtocol = (url) => url.match(/^(\w+):\/\//)[0];

export default function SystemLynxClientModule(
  httpClient,
  { methods, namespace, route, connectionData, name },
  { port, host, serviceUrl, socketPath },
  Service,
  systemContext,
  { client, service } = {}
) {
  const events = {};
  const ClientModule = headerSetter.apply({});

  // RFC 005: the module is a hooks-haver. `__middlewareStores` carries the client / service-instance
  // / module stores so the request handler can gather the full before/after chain off `this`.
  // Internals non-enumerable so the module's public shape is unchanged.
  Hooker.apply(ClientModule);
  Object.defineProperties(ClientModule, {
    __name: { value: name },
    __middlewareStores: {
      value: { namespaced: [client, service], scoped: [ClientModule.__middleware] },
    },
    __isClientModule: { value: true },
  });

  // RFC 011 — `setHeaders` is configuration: it applies to everything, forever, on a client that is
  // shared app-wide. That makes per-request values (identity above all) ambient, and the last
  // writer wins for everybody. `withHeaders` returns a view of this module carrying extra headers
  // for calls made through it, mutating nothing:
  //
  //   await Teams.withHeaders({ "Internal-Identity": sid }).add(team);
  //
  // The view is a normal handle — call as many methods on it as you like. Nothing on the module
  // itself changes, so a concurrent request never sees these headers.
  ClientModule.withHeaders = function withHeaders(extra = {}) {
    const scoped = { ...extra };
    return new Proxy(ClientModule, {
      get(target, prop, receiver) {
        if (prop === "headers") return () => ({ ...target.headers(), ...scoped });
        // chaining narrows further; later keys win, and the base is still untouched
        if (prop === "withHeaders")
          return (more = {}) => target.withHeaders({ ...scoped, ...more });
        return Reflect.get(target, prop, receiver);
      },
      // a view is a lens, never a way to write onto the shared module
      set() {
        throw new Error(
          "[SystemLynx][Client]: a withHeaders view is read-only — set on the module itself"
        );
      },
    });
  };

  ClientModule.__setConnection = ({ host, port, route, namespace, socketPath }) => {
    ClientModule.__connectionData = () => ({ route, host, port });

    SocketDispatcher.apply(ClientModule, [
      { namespace, socketPath },
      events,
      systemContext,
    ]);
  };
  // RFC 006: a module may carry its OWN physical location (`mod.connectionData`) when the service
  // was composed by the LoadBalancer from members in different places. Prefer it; fall back to the
  // service-level location when absent (a plain, single-location service — today's behavior).
  const loc = connectionData || {};
  ClientModule.__setConnection({
    host: loc.host || host,
    port: loc.port || port,
    route,
    namespace,
    socketPath: loc.socketPath || socketPath,
  });

  // On a transport failure, reconnect at the *service* level via Service.resetConnection:
  // it re-fetches connectionData from serviceUrl (the LoadBalancer route when loaded through
  // an LB — so a dead clone fails over to a live one), re-points every module, and retries.
  // (The old per-module reconnect called loadConnectionData with the wrong signature and hung.)
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
}
