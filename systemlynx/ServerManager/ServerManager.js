"use strict";
const createServer = require("./components/Server");
const createRouter = require("./components/Router");
const SocketEmitter = require("./components/SocketEmitter");
const parseMethods = require("./components/parseMethods");
const http = require("http");
const https = require("https");
const socketIO = require("socket.io");
const Hooker = require("../utils/Hooker");

module.exports = function createServerManager(customServer) {
  let serverConfigurations = {
    server: null,
    WebSocket: null,
    route: null,
    port: null,
    host: "localhost",
    serviceUrl: null,
    port: null,
    useREST: false,
    useService: true,
    ssl: { key: "", cert: "" },
    protocol: "http",
  };

  const server = createServer(customServer);
  const router = createRouter(server, () => serverConfigurations);
  const connectionContributors = []; // () => ({ …live fields for GET /<route> })
  const moduleQueue = [];
  const modules = [];

  const ServerManager = { server };

  // The server is a hooker too: it composes the SAME agnostic Hooker as the client for before/after
  // MIDDLEWARE (namespace-keyed). Only the run context differs — the server runs each middleware as
  // (req, res, next) with `this` = req.Module and a throw → res.sendError, applied by wrap().
  Hooker.apply(ServerManager);
  const wrap = (mw) => async (req, res, next) => {
    try {
      await mw.apply(req.Module, [req, res, next]);
    } catch (error) {
      res.sendError(error);
    }
  };

  // Stop listening — frees the port and makes the service unreachable (graceful shutdown /
  // simulating a clone going down). No-op before startService.
  ServerManager.close = (cb = () => {}) => {
    // Closing the Socket.IO server disconnects clients and closes the underlying HTTP server.
    // (A plain httpServer.close() would hang forever waiting on the upgraded websocket.)
    if (ServerManager.WebSocket) return ServerManager.WebSocket.close(cb);
    if (ServerManager.httpServer) return ServerManager.httpServer.close(cb);
    cb();
  };

  ServerManager.startService = (options) => {
    let { route, host = "localhost", port, ssl, protocol } = options;

    route = route.charAt(0) === "/" ? route.substr(1) : route;
    route = route.charAt(route.length - 1) === "/" ? route.slice(0, -1) : route;

    if (!["http", "https"].includes(protocol)) protocol = ssl ? "https" : "http";
    const serviceUrl = `${protocol}://${host}:${port}/${route}`;

    const httpServer = ssl ? https.createServer(ssl, server) : http.createServer(server);
    ServerManager.httpServer = httpServer;
    const socketPath = `/${route}/socket.io`;

    const WebSocket = socketIO(httpServer, {
      path: socketPath,
      cors: {
        origin: "*",
        methods: ["GET", "POST"],
      },
    });

    ServerManager.WebSocket = WebSocket;
    SocketEmitter.apply(ServerManager, [route, WebSocket]);

    const wsProtocol = protocol === "https" ? "wss" : "ws";

    const connectionData = {
      modules,
      host,
      route: `/${route}`,
      port,
      serviceUrl,
      socketPath,
      namespace: `${wsProtocol}://${host}:${port}/${route}`,
      SystemLynxService: true,
    };

    Object.assign(serverConfigurations, {
      ...options,
      server: httpServer,
      WebSocket,
      serviceUrl,
      route,
      port,
      protocol,
    });

    // RFC 012 — connectionData is the document that says WHAT IS HERE, and anything a consumer
    // must otherwise be TOLD belongs in it. Contributors register a function rather than a value
    // so late additions are published too (an MCP route served after startService, for one), and
    // so the answer can never drift from the thing describing itself.
    server.get(`/${route}`, (req, res) => {
      const contributed = connectionContributors.reduce(
        (acc, fn) => Object.assign(acc, fn() || {}),
        {}
      );
      res.json({ ...connectionData, ...contributed, modules });
    });

    return new Promise((resolve) => {
      httpServer.listen(port, () => {
        console.log(`[SystemLynx][Service]: Listening on ${serviceUrl}\n`);
        moduleQueue.forEach(({ name, Module, reserved_methods }) =>
          ServerManager.addModule(name, Module, reserved_methods),
        );
        moduleQueue.length = 0;
        resolve(connectionData);
      });
    });
  };

  // Register a contributor of live connectionData fields. Composed capabilities use this instead of
  // reaching into the payload, so `GET /<route>` stays the single place a service describes itself.
  // NON-ENUMERABLE: this is plumbing between capabilities, not user API — the public shape of a
  // ServerManager is unchanged, which the shape contracts in the test suite assert.
  Object.defineProperty(ServerManager, "contributeConnectionData", {
    value: (fn) => {
      if (typeof fn === "function") connectionContributors.push(fn);
      return ServerManager;
    },
    enumerable: false,
    configurable: true,
  });

  // Declared arity per method, as a NUMBER — never the function.
  //
  // MCPServer needs to know whether a method is positional, and `fn.length` is the only honest
  // evidence. Handing out the function itself would publish exactly the shortcut the Router exists
  // to prevent (`getModule(name)[fn]()` skips middleware, beforeware and `this.req` in one move),
  // so what is published is the one fact and nothing else: a count.
  //
  // Read it as ASYMMETRIC evidence (systemview-test's framing, and the reason this cannot replace a
  // declaration): arity >= 2 PROVES positional — an object-taking method cannot have it. Arity 1
  // proves nothing, because `({id, section}) => …` and `(pattern, dir = "x") => …` are
  // indistinguishable. Good enough to catch a lie, never good enough to be the source of truth.
  //
  // NON-ENUMERABLE for the same reason as above: plumbing between capabilities, not user API.
  const arity = {};
  Object.defineProperty(ServerManager, "__arity", {
    value: arity,
    enumerable: false,
    configurable: true,
  });

  // The PROPERTY NAMES a method destructures out of its first parameter, or null when the question
  // does not apply. Same contract as __arity: a fact about the method, never the method itself.
  //
  // Sound because a destructuring pattern's KEYS are load-bearing — a minifier may rename the local
  // binding (`{q}` → `{q: a}`) but can never rename the property, or the method would stop reading
  // the caller's field. So these names survive builds in a way `fn.length` does, and identifiers do
  // not. (Verified against a minifier's constraint, not assumed.)
  //
  // null — meaning "no opinion" — whenever proof is unavailable:
  //   • first parameter is not an object pattern      `function get(query)`
  //   • the pattern has a rest element                `({ q, ...rest })` can read anything
  //   • the source cannot be parsed for any reason
  const inputKeys = {};
  Object.defineProperty(ServerManager, "__inputKeys", {
    value: inputKeys,
    enumerable: false,
    configurable: true,
  });

  const destructuredKeys = (fn) => {
    let src;
    try {
      src = Function.prototype.toString.call(fn);
    } catch {
      return null;
    }
    const open = src.indexOf("(");
    if (open === -1) return null;
    // Walk to the matching ")" so a default value containing parens cannot end the list early.
    let depth = 0,
      end = -1;
    for (let i = open; i < src.length; i++) {
      const c = src[i];
      if (c === "(") depth++;
      else if (c === ")") {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end === -1) return null;
    const params = src.slice(open + 1, end).trim();
    if (!params.startsWith("{")) return null; // not an object pattern — no opinion

    let braces = 0,
      close = -1;
    for (let i = 0; i < params.length; i++) {
      const c = params[i];
      if (c === "{") braces++;
      else if (c === "}") {
        braces--;
        if (braces === 0) {
          close = i;
          break;
        }
      }
    }
    if (close === -1) return null;
    const body = params.slice(1, close);
    if (/\.\.\./.test(body)) return null; // a rest element can read anything

    // Split on top-level commas only, then take the key before ":" or "=".
    const parts = [];
    let cur = "",
      d = 0;
    for (const c of body) {
      if ("([{".includes(c)) d++;
      else if (")]}".includes(c)) d--;
      if (c === "," && d === 0) {
        parts.push(cur);
        cur = "";
      } else cur += c;
    }
    parts.push(cur);

    const keys = [];
    for (const raw of parts) {
      const t = raw.trim();
      if (!t) continue;
      if (t.startsWith("[")) return null; // computed key — no opinion
      const m = t.match(/^([A-Za-z_$][\w$]*)\s*(?:[:=]|$)/);
      if (!m) return null;
      keys.push(m[1]);
    }
    return keys;
  };

  ServerManager.addModule = (name, Module, reserved_methods = []) => {
    const { host, route, serviceUrl, useService, useREST, port, WebSocket, protocol } =
      serverConfigurations;

    if (!serviceUrl) return moduleQueue.push({ name, Module, reserved_methods });

    // RFC 008: stamp a stable, non-enumerable module name so coupling attribution works at boot
    // (not just during a request). Non-enumerable so it never leaks into parseMethods / exposure.
    Object.defineProperty(Module, "__name", { value: name, configurable: true });

    const exclude_methods = [
      "on",
      "emit",
      "before",
      "after",
      "$clearEvent",
      "once",
      "destroy",
      ...reserved_methods,
    ];
    const methods = parseMethods(Module, exclude_methods, useREST);
    const path = `${route}/${name}`;

    inputKeys[name] = methods.reduce(
      (acc, { fn }) =>
        typeof Module[fn] === "function"
          ? Object.assign(acc, { [fn]: destructuredKeys(Module[fn]) })
          : acc,
      {}
    );

    arity[name] = methods.reduce(
      (acc, { fn }) =>
        typeof Module[fn] === "function" ? Object.assign(acc, { [fn]: Module[fn].length }) : acc,
      {}
    );

    // This method's middleware, gathered from the composed Hooker (namespace: $all → name → name.fn,
    // by specificity) and wrapped into the server's (req, res, next) run context.
    const middlewareHooks = (kind, fn) =>
      Hooker.gather(kind, { namespaced: [ServerManager.__middleware] }, name, fn).map(
        wrap,
      );

    if (useService) {
      SocketEmitter.apply(Module, [path, WebSocket]);

      const wsProtocol = protocol === "https" ? "wss" : "ws";

      modules.push({
        namespace: `${wsProtocol}://${host}:${port}/${path}`,
        route: `/${path}`,
        name,
        methods,
      });

      methods.forEach((method) => {
        router.addService(
          Module,
          path,
          method,
          name,
          middlewareHooks("before", method.fn),
          middlewareHooks("after", method.fn),
        );
      });
    }

    if (useREST)
      methods.forEach((method) => {
        const beforeValidators = middlewareHooks("before", method.fn);
        const afterValidators = middlewareHooks("after", method.fn);

        switch (method.fn) {
          case "get":
          case "put":
          case "post":
          case "delete":
            router.addREST(
              Module,
              `${route}/${name}`,
              method,
              name,
              beforeValidators,
              afterValidators,
            );
        }
      });
  };

  // The Service layer calls addBeforware/addAfterware; route them to the composed Hooker's
  // before/after registration (namespace target + recursive array flattening handled there).
  ServerManager.addBeforware = (...args) => ServerManager.before(...args);
  ServerManager.addAfterware = (...args) => ServerManager.after(...args);

  return ServerManager;
};
