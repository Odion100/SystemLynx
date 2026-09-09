"use strict";
// RFC 012 — createMCPServer: SystemLynx methods served as MCP tools.
//
// An MCP endpoint is a CURATED SURFACE, not a mirror of the service. Every tool's name,
// description and schema enters the model's context on tools/list before it has done anything,
// so the unit of exposure is the ROUTE (`serve`), and one server can carry several.
//
// Dispatch goes through the FRONT DOOR: a tool call becomes an ordinary HTTP request to the
// method's own route (`/route/Module/fn` with `{ __arguments: [args] }`), so express middleware,
// beforeware/afterware and `this.req` all run — it cannot silently diverge from a real call,
// because it is one. Reaching into a module directly (`App.getModule(name)[fn]()`) is the
// forbidden shortcut: it skips all of that in one move.
//
// Dispatch uses THE REAL CLIENT (Odion's call): the standalone form is an MCP proxy, and a proxy
// should call the way any consumer calls — loadService once, then per-call withHeaders views
// (RFC 011) carry the caller's identity, unloadService (RFC 013) closes it, and a LoadBalancer
// URL gets per-module routing/failover for free. Mimicking the wire request would have owned the
// request format in two places and known nothing about clusters.
const createClient = require("../Client/Client");

const isServiceLike = (x) =>
  x && typeof x === "object" && x.server && typeof x.server.use === "function";

module.exports = function createMCPServer(serviceOrTarget) {
  const MCPServer = {};
  const schemas = {}; // moduleName -> { fn: { description, input, required } }
  const served = {}; // routePath -> { expose }
  // One client for the proxy's lifetime; loadService is cached per URL inside it, and close()
  // hands everything to Client.disconnect() (RFC 013).
  const client = createClient();

  const service = isServiceLike(serviceOrTarget) ? serviceOrTarget : null;
  // A standalone server may front a remote SystemLynx service by URL.
  const remoteTarget =
    typeof serviceOrTarget === "string" ? serviceOrTarget.replace(/\/+$/, "") : null;

  let standalone = null; // { httpServer, url } once start() ran

  // ---------------------------------------------------------------- declarations
  // `schema` declares what a method IS — protocol-neutral, declared once. Handing a schema to an
  // MCP server is the opt-in; there is no per-method "publish" switch.
  //
  // `args` — POSITIONAL METHODS. MCP hands a tool exactly ONE object (`params.arguments`), but a
  // SystemLynx method may be variadic: `grep(pattern, dir)`. Without a declared order there is no
  // way to know, and the default — pass the object as the first argument — is silently WRONG for
  // such a method: it binds `{pattern:"x"}` to `pattern` and the method searches for the literal
  // JSON. It returns a confident, empty, wrong answer. (Found by systemview-test consuming the
  // workbench: a live symbol reported zero matches.)
  //
  // So a positional method declares its order once: `args: ["pattern", "dir"]`. Absent means the
  // method takes the single object, which is the common shape.
  //
  // It is AUTHORED rather than derived on purpose, and this is the one place authoring is right:
  // the standalone form fronts a service by URL and has nothing but a client proxy, whose function
  // arity is the proxy's, not the method's. A fact that cannot be derived in one form must not be
  // derived in the other, or the two forms disagree about how a call is made.
  //
  // Names are checked against `input` HERE, at declaration, because the failure it prevents is
  // exactly the silent one above: a typo'd name would pass `undefined` and look like an optional
  // argument the caller omitted.
  MCPServer.schema = (moduleName, defs = {}) => {
    Object.keys(defs).forEach((fn) => {
      const def = defs[fn] || {};
      // HOW A METHOD IS CALLED IS DECLARED, NOT GUESSED — but only where it is genuinely unknowable.
      //
      // An earlier version demanded `args` from every method declaring two or more inputs. buAPI
      // killed that rule: 5 services, ~65 modules, and one-object methods are the overwhelming
      // majority, so the requirement was a migration across hundreds of methods answered by typing
      // `args: null` without reading it — and a reflexive annotation reproduces the exact silent
      // failure it exists to prevent. It taxed the safe shape to protect the unsafe one.
      //
      // What replaced it is the ARITY CHECK below (see verifyOnce). buAPI is also the evidence that
      // positional methods are not a curiosity: `Chats.start(data, initialMessage)` is arity 2, and
      // its middleware addresses arguments by index (`"[0].chat_id"`, `"[1].sender"`) in 46 places.
      // Multi-argument is idiomatic there, so this must be caught — just not by taxing everyone.
      if (def.args === undefined || def.args === null) return;
      if (!Array.isArray(def.args) || def.args.some((k) => typeof k !== "string"))
        throw new Error(
          `[SystemLynx][MCPServer]: ${moduleName}.${fn} — \`args\` must be an array of input names`
        );
      const unknown = def.args.filter((k) => !(def.input && k in def.input));
      if (unknown.length)
        throw new Error(
          `[SystemLynx][MCPServer]: ${moduleName}.${fn} — \`args\` names ${unknown.join(", ")}, ` +
            `which ${unknown.length === 1 ? "is" : "are"} not in \`input\`. A caller can only send ` +
            `declared inputs, so ${unknown.length === 1 ? "it" : "they"} would always be undefined.`
        );
    });
    schemas[moduleName] = { ...(schemas[moduleName] || {}), ...defs };
    return MCPServer;
  };

  // `serve` stands up a surface: one route, one tool list. expose entries are "Module.fn",
  // "Module", or "*".
  MCPServer.serve = (routePath, { expose = "*" } = {}) => {
    const clean = String(routePath).replace(/^\/+|\/+$/g, "");
    // REFUSE RATHER THAN SERVE NOTHING. `expose` as a per-request function was proposed, built, and
    // removed (see RFC 012, "Not built"). Anything that is not "*" or a list of names used to fall
    // through `[].concat(fn)` into a one-element array that matches no module, so the route came up
    // with an EMPTY tool list and no complaint — a route that looks alive and advertises nothing.
    // That is the same silent-zero this whole surface is built to prevent, so it throws here.
    const ok = expose === "*" || typeof expose === "string" || Array.isArray(expose);
    if (!ok)
      throw new Error(
        `[SystemLynx][MCPServer]: serve("${clean}") got expose of type ${typeof expose} — it must be ` +
          `"*" or a list of "Module" / "Module.method" names. A surface that varies per request is ` +
          `not supported; serve one route per scope instead.`
      );
    served[clean] = { expose: expose === "*" ? "*" : [].concat(expose) };
    return MCPServer;
  };

  // ---------------------------------------------------------------- tool resolution
  const isExposed = (expose, moduleName, fn) =>
    expose === "*" ||
    expose.includes(moduleName) ||
    expose.includes(`${moduleName}.${fn}`);

  // FILE ARGUMENTS CANNOT CROSS THIS TRANSPORT, AND TRYING IS AN EXPLOIT.
  //
  // SystemLynx uploads work by the CLIENT resolving a `file` argument into a read stream from its
  // own disk (`extractFilesFromArguments` → `convertToReadStream`) and posting multipart. But the
  // client here runs INSIDE the server, so a `file` value supplied by a remote MCP caller is a path
  // read from the SERVER's filesystem. Proven against the live testbed: a caller passed
  // `/tmp/outside-the-repo.txt` and the service read that file and wrote its contents into the repo.
  // Arbitrary file read, unauthenticated, from any caller that can reach the endpoint.
  //
  // An MCP host is not a multipart client and has no way to hand over bytes, so there is no
  // legitimate use of these keys over this transport — only mistakes and attacks. Refused twice:
  // never listed (here), and rejected at call time (below) in case a `*` expose or a schema-less
  // route reaches one anyway.
  const takesFile = (def) =>
    !!(def && def.input && (def.input.file !== undefined || def.input.files !== undefined));

  const toolsFor = (expose, missing) => {
    const tools = [];
    Object.keys(schemas).forEach((moduleName) => {
      Object.keys(schemas[moduleName]).forEach((fn) => {
        if (!isExposed(expose, moduleName, fn)) return;
        if (missing && missing.has(`${moduleName}.${fn}`)) return; // declared, not answered
        const def = schemas[moduleName][fn] || {};
        if (takesFile(def)) return; // uploads cannot cross this transport — see above
        tools.push({
          // Full Module.method, so two modules' `get` are distinguishable within one route.
          // It does NOT make a method's identity stable across routes: hosts prefix the server
          // name and rewrite the dot, so serving one method on two routes gives a consumer two
          // distinct tools (mcp__workbench__Repo_findRfc vs mcp__wb-repo__Repo_findRfc). Verified
          // against a real host, not assumed — the dotted name appears nowhere a consumer sees.
          name: `${moduleName}.${fn}`,
          description: def.description || "",
          inputSchema: {
            type: "object",
            properties: def.input || {},
            ...(def.required ? { required: def.required } : {}),
          },
        });
      });
    });
    return tools;
  };

  // Per-module endpoints, automatic: every module with declarations answers at
  // `<base>/<Module>/mcp`, exposing only itself. Routes the server adds itself — not magic.
  const routeFor = (suffix) => {
    if (served[suffix]) return served[suffix];
    const m = suffix.match(/^([^/]+)\/mcp$/);
    if (m && schemas[m[1]]) return { expose: [m[1]] };
    return null;
  };

  // ---------------------------------------------------------------- dispatch (the front door)
  const FORWARD_STRIP = /^(host|content-length|content-type|connection|accept|accept-encoding)$/i;

  const loadTarget = (baseUrl) => client.loadService(baseUrl);

  // Fail at START, not at call time: a declared tool the service does not answer makes the
  // schema a liar, so verify the claim against the loaded handles and refuse loudly.
  const verifyAgainst = (svc, where) => {
    const missing = [];
    Object.keys(schemas).forEach((moduleName) =>
      Object.keys(schemas[moduleName]).forEach((fn) => {
        if (!svc[moduleName] || typeof svc[moduleName][fn] !== "function")
          missing.push(`${moduleName}.${fn}`);
      })
    );
    if (missing.length)
      throw new Error(
        `[SystemLynx][MCPServer]: schema declares ${missing.join(", ")} but ${where} does not answer ${
          missing.length === 1 ? "it" : "them"
        }`
      );
  };

  // The mounted form cannot verify at construction — modules attach later and the service has not
  // started — so it verifies ONCE on first contact instead. A method the service does not answer
  // is dropped from what this server advertises, rather than advertised and failing at call time.
  // Same principle as start()'s check, moved to the only moment the answer exists.
  let verified = null; // Promise<Set<"Module.fn">> of what is missing
  const verifyOnce = (baseUrl) => {
    if (verified) return verified;
    verified = loadTarget(baseUrl)
      .then((svc) => {
        const missing = new Set();
        Object.keys(schemas).forEach((moduleName) =>
          Object.keys(schemas[moduleName]).forEach((fn) => {
            if (!svc[moduleName] || typeof svc[moduleName][fn] !== "function")
              missing.add(`${moduleName}.${fn}`);
          })
        );
        if (missing.size)
          console.error(
            `[SystemLynx][MCPServer]: schema declares ${[...missing].join(", ")} but ${baseUrl} ` +
              `does not answer ${missing.size === 1 ? "it" : "them"} — not advertising ${
                missing.size === 1 ? "it" : "them"
              }`
          );

        // THE POSITIONAL CHECK. This is where a method that takes `(data, initialMessage)` is
        // caught, whether its schema said nothing or said `args: null`. Both mean "hand it one
        // object", and for an arity-2 method that binds the object to the first parameter and
        // leaves the rest undefined — a plausible EMPTY answer, never an error.
        //
        // Checked, not derived. `__arity` is asymmetric evidence: arity >= 2 PROVES positional,
        // because no method taking a single object can have it. Arity 1 proves nothing, so a
        // positional method with defaults still slips through — which is precisely why the
        // declaration stays the source of truth and this is only ever a contradiction test.
        //
        // Mounted form only: the standalone form fronts a URL and has no arity to read. That is a
        // gap in COVERAGE, not a difference in behaviour — a schema valid here is valid there.
        const declaredArity = service && service.__arity;
        if (declaredArity)
          Object.keys(schemas).forEach((moduleName) =>
            Object.keys(schemas[moduleName]).forEach((fn) => {
              const def = schemas[moduleName][fn] || {};
              const n = (declaredArity[moduleName] || {})[fn];
              // `!def.args` covers BOTH the missing declaration and the explicit `args: null`
              // lie — either way the server would hand this method one object.
              if (def.args || !(n >= 2) || missing.has(`${moduleName}.${fn}`)) return;
              missing.add(`${moduleName}.${fn}`);
              console.error(
                `[SystemLynx][MCPServer]: ${moduleName}.${fn} is served as taking one object, but ` +
                  `the method takes ${n} positional parameters — one object handed to it would bind ` +
                  `to the first and the rest would be undefined, which returns a plausible EMPTY ` +
                  `answer rather than an error. Declare args: [...] in its schema. Not advertising it.`
              );
            })
          );
        // THE SCHEMA CAN BE FICTION. Neither check above asks the question that actually failed in
        // practice: are the declared inputs the inputs the method READS? `verifyAgainst` proves a
        // method exists; arity proves a declaration is not impossible. A schema inventing
        // `$text: {$search}` for a method that destructures `{ q, city, state }` passes both, and a
        // caller following it lands on a bare framework error with no way to tell fiction from a
        // broken method. That happened, on the first real service, to a schema written by hand.
        //
        // Same asymmetry as arity, one level in (systemview-test's proposal):
        //   • declared but NOT destructured  → PROOF the method cannot read it
        //   • destructured but not declared  → proves nothing (an input the schema chose to omit)
        //   • not an object pattern, or a rest element present → no opinion, no check
        //
        // Sound across builds because a destructuring pattern's KEYS are load-bearing: a minifier
        // can rename the binding (`{q}` → `{q: a}`) but never the property.
        const keysByModule = service && service.__inputKeys;
        if (keysByModule)
          Object.keys(schemas).forEach((moduleName) =>
            Object.keys(schemas[moduleName]).forEach((fn) => {
              const def = schemas[moduleName][fn] || {};
              if (def.args || missing.has(`${moduleName}.${fn}`)) return; // positional: not this check
              const known = (keysByModule[moduleName] || {})[fn];
              if (!known) return; // no opinion available
              const lies = Object.keys(def.input || {}).filter((k) => !known.includes(k));
              if (!lies.length) return;
              missing.add(`${moduleName}.${fn}`);
              console.error(
                `[SystemLynx][MCPServer]: ${moduleName}.${fn} declares input ${lies.join(", ")}, but ` +
                  `the method reads only ${known.join(", ") || "(nothing)"} — a caller following this ` +
                  `schema would send a field the method never looks at. Not advertising it.`
              );
            })
          );

        return missing;
      })
      .catch(() => new Set()); // unreachable target is its own error at call time, not a lie here
    return verified;
  };

  const dispatch = async (baseUrl, incomingHeaders, name, args) => {
    const [moduleName, fn] = String(name).split(".");
    if (!moduleName || !fn || !schemas[moduleName] || !schemas[moduleName][fn])
      throw { message: `[SystemLynx][MCPServer]: unknown tool "${name}"`, status: 404 };

    const svc = await loadTarget(baseUrl);
    if (!svc[moduleName] || typeof svc[moduleName][fn] !== "function")
      throw {
        message: `[SystemLynx][MCPServer]: "${name}" is declared but the service does not answer it`,
        status: 404,
      };

    // Backstop for the above: refuse a file argument no matter how the tool got reached. The value
    // would be resolved against the SERVER's filesystem, so accepting it is arbitrary file read.
    //
    // DEPTH IS COUPLED TO THE CLIENT, DELIBERATELY. This checks the TOP LEVEL of each argument only,
    // because `extractFilesFromArguments` (Client/components/ServiceRequestHandler.js) checks
    // `arg.file` / `arg.files` one level deep and never recurses — so a nested `file` never becomes
    // a read stream and there is nothing to refuse. **If that function ever recurses, this guard
    // must recurse the same day**, or the hole reopens for nested payloads. A test in
    // Client/tests/fileExtractionDepth.test.js fails if the client's depth changes, and names this
    // guard as the reason. (Coupling found by systemview-test probing for the bypass.)
    // Build the ACTUAL argument list first, so the file guard below scans exactly what will be
    // sent — a positional method's second argument is no less dangerous than its first.
    const def = schemas[moduleName][fn];
    const payload = args === undefined || args === null ? {} : args;
    let callArgs;
    if (def.args) {
      callArgs = def.args.map((k) => (payload && typeof payload === "object" ? payload[k] : undefined));
      // Trailing omissions are omissions, not explicit undefineds: `grep(pattern)` and
      // `grep(pattern, undefined)` differ to a method that checks `arguments.length`.
      while (callArgs.length && callArgs[callArgs.length - 1] === undefined) callArgs.pop();
    } else {
      callArgs = [payload];
    }

    const withFile = callArgs.find(
      (a) => a && typeof a === "object" && (a.file !== undefined || a.files !== undefined)
    );
    if (withFile)
      throw {
        message:
          `[SystemLynx][MCPServer]: "${name}" was called with a file argument, which cannot cross ` +
          `MCP — a file value here would be read from the SERVER's filesystem, not yours. Upload ` +
          `through a SystemLynx client instead.`,
        status: 400,
      };

    // Identity is forwarded, never interpreted: the caller's headers ride a per-call
    // withHeaders VIEW (RFC 011), so nothing sticks to the shared client between calls.
    const headers = {};
    Object.keys(incomingHeaders || {}).forEach((k) => {
      if (!FORWARD_STRIP.test(k)) headers[k] = incomingHeaders[k];
    });

    const view = svc[moduleName].withHeaders(headers);
    return view[fn].apply(view, callArgs);
  };

  // ---------------------------------------------------------------- the MCP protocol
  // Stateless streamable-HTTP, plain-JSON responses — a mode the spec explicitly allows, and the
  // whole protocol surface an MCP host actually exercises here is three JSON-RPC methods. Handling
  // them directly (no SDK) keeps the server dependency-free, browser-mirrorable, and exactly as
  // wide as what it serves: initialize, tools/list, tools/call. Everything else is answered
  // honestly (-32601), and notifications get the 202 the spec asks for.
  const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

  const handleMCP = async (req, res, expose, baseUrl) => {
    const message = req.body;
    const reply = (payload) => res.status(200).json(payload);
    const rpcError = (id, code, msg) =>
      reply({ jsonrpc: "2.0", id: id === undefined ? null : id, error: { code, message: msg } });

    if (!message || typeof message !== "object" || Array.isArray(message))
      return rpcError(null, -32700, "Parse error: a single JSON-RPC message is expected");

    const { id, method, params = {} } = message;

    // Notifications carry no id and expect no body — 202, as the transport spec asks.
    if (id === undefined && typeof method === "string")
      return res.status(202).end();

    switch (method) {
      case "initialize": {
        const requested = params.protocolVersion;
        return reply({
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: PROTOCOL_VERSIONS.includes(requested)
              ? requested
              : PROTOCOL_VERSIONS[0],
            capabilities: { tools: {} },
            serverInfo: { name: "systemlynx", version: require("../../package.json").version },
          },
        });
      }
      case "ping":
        return reply({ jsonrpc: "2.0", id, result: {} });
      case "tools/list":
        return reply({
          jsonrpc: "2.0",
          id,
          result: { tools: toolsFor(expose, await verifyOnce(baseUrl)) },
        });
      case "tools/call": {
        const { name, arguments: args } = params;
        const asTool = (text, isError) =>
          reply({
            jsonrpc: "2.0",
            id,
            result: { content: [{ type: "text", text }], ...(isError ? { isError: true } : {}) },
          });
        if (!isExposed(expose, ...String(name || "").split(".")))
          return asTool(`unknown tool "${name}"`, true);
        try {
          const returnValue = await dispatch(baseUrl, req.headers, name, args);
          return asTool(
            returnValue === undefined ? "" : JSON.stringify(returnValue, null, 2)
          );
        } catch (error) {
          return asTool((error && error.message) || JSON.stringify(error), true);
        }
      }
      default:
        return rpcError(id, -32601, `Method not found: ${method}`);
    }
  };

  // ---------------------------------------------------------------- mounting
  // Suffix-matched middleware: the service owns its route prefix and may not have started yet,
  // so endpoints are recognized by what the path ENDS with, and the loopback base is derived
  // from the CONNECTION — no config to know, and nothing the caller can steer.
  //
  // SECURITY (found by systemview-test in review): an earlier version built the base from
  // `req.headers.host`, which is caller-controlled. A POST carrying `Host: anywhere` would make
  // the mounted server `loadService` THAT host and forward the caller's headers to it — SSRF with
  // credential forwarding, reachable by anything that can reach the endpoint. It also grew
  // `cachedServices` (and its sockets) once per distinct spoofed host.
  //
  // `req.socket.localAddress` / `localPort` are properties of the accepted TCP connection, so they
  // cannot be forged by a header: the mounted form dispatches to the socket the request arrived
  // on, which is by definition itself. `encrypted` likewise beats `req.protocol`, which would
  // trust `X-Forwarded-Proto` if the app ever enabled trust proxy.
  const loopbackOrigin = (req) => {
    const socket = req.socket || {};
    const raw = (socket.localAddress || "127.0.0.1").replace(/^::ffff:/, "");
    const host = raw.includes(":") ? `[${raw}]` : raw; // IPv6 literals need brackets in a URL
    const port = socket.localPort;
    const protocol = socket.encrypted ? "https" : "http";
    return `${protocol}://${host}${port ? `:${port}` : ""}`;
  };
  const middleware = (req, res, next) => {
    const path = req.path.replace(/\/+$/, "");
    const suffix = Object.keys(served)
      .concat(Object.keys(schemas).map((m) => `${m}/mcp`))
      .find((s) => path === `/${s}` || path.endsWith(`/${s}`));
    if (!suffix) return next();
    const route = routeFor(suffix);
    if (!route) return next();

    if (req.method === "GET" || req.method === "DELETE")
      return res.status(405).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Method not allowed — POST only (stateless)" },
        id: null,
      });
    if (req.method !== "POST") return next();

    const basePath = path.slice(0, path.length - (`/${suffix}`.length));
    const baseUrl = remoteTarget || `${loopbackOrigin(req)}${basePath}`;
    handleMCP(req, res, route.expose, baseUrl).catch((err) => {
      if (!res.headersSent)
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: (err && err.message) || String(err) },
          id: null,
        });
    });
  };

  // What this server advertises about ITSELF in the service's connectionData. Routes only —
  // deliberately not tool names or counts, because a tool list belongs to `tools/list` and copying
  // it here would recreate the exact drift this exists to prevent. `kind` is the one thing worth
  // adding: it is structural (computed from how the route came to exist, so it cannot rot) and it
  // is what a chooser actually needs — "these are mechanical per-module surfaces, this one a human
  // curated for a purpose" is the difference between picking well and probing fifty endpoints.
  MCPServer.routes = () => [
    ...Object.keys(served).map((path) => ({ path, kind: "served" })),
    ...Object.keys(schemas).map((moduleName) => ({
      path: `${moduleName}/mcp`,
      kind: "module",
      module: moduleName,
    })),
  ];

  // Mounted form: rides the service's own express app — no new port, no second process.
  if (service) {
    service.server.use(middleware);
    // RFC 012 — DISCOVERY. A consumer that must be TOLD where the tools are can drift from the
    // service; one that can ASK cannot. The service knows its own routes, `connectionData` is
    // already the document saying what is here, so it publishes them there. A hub's registry then
    // aggregates a fact each service tells about itself rather than a database to keep in sync.
    // Live, so a route served after startService is published too.
    if (typeof service.contributeConnectionData === "function")
      service.contributeConnectionData(() => ({ mcp: MCPServer.routes() }));
  }

  // Plugin form: the same mount expressed the way the framework expresses attachment —
  // App.use(mcp.plugin) / service.use(mcp.plugin).
  MCPServer.plugin = (App) => {
    if (App && App.server && typeof App.server.use === "function")
      App.server.use(middleware);
  };

  // Standalone form: owns its listener. Fronts a remote SystemLynx service when constructed
  // with a URL; otherwise tools/call has nowhere to go and says so loudly.
  MCPServer.start = async ({ port, route = "mcp", host = "localhost" } = {}) => {
    // The proxy's whole job is the service behind it — prove the claim before taking traffic.
    if (remoteTarget) verifyAgainst(await loadTarget(remoteTarget), remoteTarget);
    const express = require("express");
    const app = express();
    app.use(express.json({ limit: "5mb" }));
    if (!served[route.replace(/^\/+|\/+$/g, "")]) MCPServer.serve(route);
    app.use((req, res, next) => {
      if (!remoteTarget && req.method === "POST") {
        // tools/list still works — a schema-only server is browsable, not callable.
        const suffix = req.path.replace(/^\/+|\/+$/g, "");
        if (routeFor(suffix) && req.body && req.body.method === "tools/call")
          return res.status(200).json({
            jsonrpc: "2.0",
            id: req.body.id,
            error: {
              code: -32603,
              message:
                "[SystemLynx][MCPServer]: no service behind this server — construct with createMCPServer(service) or createMCPServer(serviceUrl)",
            },
          });
      }
      next();
    });
    app.use(middleware);
    return new Promise((resolve) => {
      const httpServer = app.listen(port, () => {
        const url = `http://${host}:${port}/${route.replace(/^\/+|\/+$/g, "")}`;
        standalone = { httpServer, url };
        console.log(`[SystemLynx][MCPServer]: Listening on ${url}\n`);
        resolve(url);
      });
    });
  };

  MCPServer.close = async () => {
    client.disconnect(); // RFC 013 — every service this proxy loaded, closed in one call
    return new Promise((resolve) => {
      if (standalone && standalone.httpServer) standalone.httpServer.close(resolve);
      else resolve();
    });
  };

  // Introspection — what a given route would advertise. Reads, decides nothing.
  MCPServer.tools = (routePath) => {
    const route = routePath ? routeFor(String(routePath).replace(/^\/+|\/+$/g, "")) : null;
    return toolsFor(route ? route.expose : "*");
  };

  return MCPServer;
};
