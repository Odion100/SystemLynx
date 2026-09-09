const { expect } = require("chai");
const createService = require("../../Service/Service");
const createClient = require("../../Client/Client");
const createMCPServer = require("../MCPServer");

// RFC 012 — SystemLynx methods served as MCP tools.
//
// The property under test throughout: a tool call is an ORDINARY client call. It goes through
// the method's own express route, so beforeware runs, `this.req` is populated, and forwarded
// headers arrive — provable by asserting on what the method itself observed.
const settle = (ms = 150) => new Promise((r) => setTimeout(r, ms));

describe("MCPServer (RFC 012)", () => {
  const port = 5731;
  const route = "mcp-svc";
  const serviceUrl = `http://localhost:${port}/${route}`;
  let service;
  const seen = { headers: null, beforeware: 0 };

  beforeAll(async () => {
    service = createService();
    service.module("Users", {
      get: function ({ id }) {
        seen.headers = this.req.headers; // proves the call came through the front door
        return { id, name: `user-${id}` };
      },
      list: () => [{ id: "u1" }, { id: "u2" }],
    });
    service.module("Teams", { add: ({ name }) => ({ added: name }) });
    service.before("Users.get", (req, res, next) => {
      seen.beforeware++; // proves beforeware runs on tool calls
      next();
    });

    const mcp = createMCPServer(service);
    mcp.schema("Users", {
      get: {
        description: "Fetch a user by id.",
        input: { id: { type: "string" } },
        required: ["id"],
      },
      list: { description: "List users.", input: {} },
    });
    mcp.schema("Teams", { add: { description: "Add a team.", input: { name: { type: "string" } } } });
    mcp.serve("support-mcp", { expose: ["Users.get", "Users.list"] });
    mcp.serve("all-mcp", { expose: "*" });

    await service.startService({ route, port });
    await settle();
  });

  afterAll(async () => {
    if (service) await new Promise((r) => service.close(r));
  });

  const load = (suffix) => createClient().loadMCP(`${serviceUrl}/${suffix}`);

  it("a served route advertises exactly what it exposes — a curated surface, not a mirror", async () => {
    const tools = await load("support-mcp");
    const names = tools.__tools.map((t) => t.name).sort();
    expect(names).to.deep.equal(["Users.get", "Users.list"]); // Teams.add is NOT here
    expect(tools.__tools[0].description).to.be.a("string").that.is.not.empty;
    expect(tools.__tools.find((t) => t.name === "Users.get").inputSchema).to.deep.equal({
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    });
    await tools.__close();
  });

  it("tools/call lands on the method through the FULL chain — this.req and beforeware included", async () => {
    const before = seen.beforeware;
    const tools = await load("support-mcp");
    const result = await tools.Users.get({ id: "u7" });
    expect(result).to.deep.equal({ id: "u7", name: "user-u7" });
    expect(seen.beforeware).to.equal(before + 1); // front door, not a module poke
    expect(seen.headers).to.be.an("object"); // this.req was populated
    await tools.__close();
  });

  it("a method outside the route's expose list is refused, even though it has a schema", async () => {
    const tools = await load("support-mcp");
    expect(tools.Teams).to.equal(undefined); // not even listed
    await tools.__close();
    const all = await load("all-mcp");
    const added = await all.Teams.add({ name: "hawks" }); // but the * route reaches it
    expect(added).to.deep.equal({ added: "hawks" });
    await all.__close();
  });

  it("every module with declarations answers at its own automatic endpoint", async () => {
    const tools = await load("Users/mcp");
    const names = tools.__tools.map((t) => t.name).sort();
    expect(names).to.deep.equal(["Users.get", "Users.list"]); // only its own module
    const result = await tools.Users.get({ id: "u9" });
    expect(result.name).to.equal("user-u9");
    await tools.__close();
  });

  it("there is NO service-wide endpoint unless one was served deliberately", async () => {
    let failed = false;
    try {
      await createClient().loadMCP(`${serviceUrl}/mcp`);
    } catch (e) {
      failed = true;
    }
    expect(failed).to.equal(true);
  });

  it("forwards the caller's headers into the method — identity rides through, never interpreted", async () => {
    const tools = await createClient().loadMCP(`${serviceUrl}/support-mcp`, {
      headers: { "x-caller-identity": "odion" },
    });
    await tools.Users.get({ id: "u1" });
    expect(seen.headers["x-caller-identity"]).to.equal("odion");
    await tools.__close();
  });

  it("client hooks apply to tool calls — where control lives", async () => {
    const client = createClient();
    let hookRan = 0;
    client.before("Users.get", (payload, next) => {
      hookRan++;
      next();
    });
    const tools = await client.loadMCP(`${serviceUrl}/support-mcp`);
    await tools.Users.get({ id: "u3" });
    expect(hookRan).to.equal(1);
    await tools.__close();
  });

  it("an unknown tool is an error, not a guess", async () => {
    // The handle map can't even express this call (Teams isn't listed on support-mcp), so speak
    // raw JSON-RPC at the wire — the same thing any stranger MCP host could send.
    const createHttpClient = require("../../HttpClient/HttpClient");
    const res = await createHttpClient().request({
      method: "post",
      url: `${serviceUrl}/support-mcp`,
      headers: { Accept: "application/json, text/event-stream" },
      body: {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "Teams.add", arguments: { name: "no" } },
      },
    });
    expect(res.result && res.result.isError).to.equal(true);
  });
});

describe("MCPServer — standalone (RFC 012)", () => {
  const svcPort = 5732;
  const mcpPort = 5733;
  let service, mcp;

  beforeAll(async () => {
    service = createService();
    service.module("Games", {
      score: ({ id }) => ({ id, score: 42 }),
      // Reports the caller's identity back so the proxy hop can be observed from the far side.
      whoami: function () {
        return { origin: this.req.headers.origin || null, agent: this.req.headers["x-agent"] || null };
      },
    });
    await service.startService({ route: "games", port: svcPort });

    // Standalone form fronting a remote SystemLynx service by URL — its own listener, no plugin.
    mcp = createMCPServer(`http://localhost:${svcPort}/games`);
    mcp.schema("Games", {
      score: { description: "Get a game's score.", input: { id: { type: "string" } } },
      whoami: { description: "Report the caller's identity headers.", input: {} },
    });
    await mcp.start({ port: mcpPort, route: "mcp" });
  });

  afterAll(async () => {
    if (mcp) await mcp.close();
    if (service) await new Promise((r) => service.close(r));
  });

  it("serves its own endpoint and dispatches to the remote service", async () => {
    const tools = await createClient().loadMCP(`http://localhost:${mcpPort}/mcp`);
    expect(tools.__tools.map((t) => t.name)).to.deep.equal(["Games.score", "Games.whoami"]);
    const result = await tools.Games.score({ id: "g1" });
    expect(result).to.deep.equal({ id: "g1", score: 42 });
    await tools.__close();
  });

  // A PROXY MUST NOT BECOME AN IDENTITY. The standalone form fronts a service it does not own, so
  // the whole security story is that it forwards the caller rather than substituting itself — §6:
  // "whatever the service's auth already does, it keeps doing." Two hops (caller → proxy → service)
  // is exactly where that could quietly stop being true, and the mounted form's header test does not
  // cover it because there is no second hop there.
  //
  // This was verified once against a live external service, where sending no header was refused and
  // sending one was served. That experiment is gone; the property it proved is locked here.
  it("forwards the caller's headers ACROSS the proxy hop, unchanged", async () => {
    const tools = await createClient().loadMCP(`http://localhost:${mcpPort}/mcp`, {
      headers: { origin: "http://localhost:3000", "x-agent": "systemlynx" },
    });
    expect(await tools.Games.whoami()).to.deep.equal({
      origin: "http://localhost:3000",
      agent: "systemlynx",
    });
    await tools.__close();
  });

  it("sends no identity of its own when the caller sent none", async () => {
    // The other half: a proxy that helpfully invents headers would let an unauthenticated caller
    // through as somebody. Absence has to survive the hop as absence.
    const tools = await createClient().loadMCP(`http://localhost:${mcpPort}/mcp`);
    expect(await tools.Games.whoami()).to.deep.equal({ origin: null, agent: null });
    await tools.__close();
  });

  it("refuses to START when the schema declares a tool the service does not answer", async () => {
    const liar = createMCPServer(`http://localhost:${svcPort}/games`);
    liar.schema("Games", { winner: { description: "No such method.", input: {} } });
    let error = null;
    try {
      await liar.start({ port: 5734 });
    } catch (e) {
      error = e;
    } finally {
      await liar.close();
    }
    expect(error).to.not.equal(null);
    expect(error.message).to.include("Games.winner");
  });
});

describe("MCPServer — a hostile Host header cannot steer dispatch (RFC 012)", () => {
  // Found by systemview-test in review: the mounted form used to build its loopback base from
  // `req.headers.host`, which the caller controls. `Host: anywhere` would make the server call
  // THAT host and forward the caller's headers to it. The base now comes from the accepted TCP
  // connection, which no header can reach.
  const port = 5741;
  const decoyPort = 5742;
  const serviceUrl = `http://localhost:${port}/victim`;
  let service, decoy;
  const landed = { onVictim: 0, onDecoy: 0 };

  beforeAll(async () => {
    service = createService();
    service.module("Vault", {
      read: () => {
        landed.onVictim++;
        return { from: "victim" };
      },
    });
    const mcp = createMCPServer(service);
    mcp.schema("Vault", { read: { description: "Read.", input: {} } });
    mcp.serve("v-mcp", { expose: "*" });
    await service.startService({ route: "victim", port });

    // A second service standing in for "somewhere the attacker points us".
    decoy = createService();
    decoy.module("Vault", {
      read: () => {
        landed.onDecoy++;
        return { from: "decoy" };
      },
    });
    await decoy.startService({ route: "victim", port: decoyPort });
    await settle();
  });

  afterAll(async () => {
    if (service) await new Promise((r) => service.close(r));
    if (decoy) await new Promise((r) => decoy.close(r));
  });

  it("ignores a spoofed Host and dispatches to the socket it arrived on", async () => {
    const createHttpClient = require("../../HttpClient/HttpClient");
    const before = { ...landed };
    const res = await createHttpClient().request({
      method: "post",
      url: `${serviceUrl}/v-mcp`,
      // the attack: name a different host than the one we connected to
      headers: { Host: `localhost:${decoyPort}` },
      body: {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "Vault.read", arguments: {} },
      },
    });

    expect(res.result.isError).to.equal(undefined);
    expect(res.result.content[0].text).to.include("victim");
    expect(landed.onVictim).to.equal(before.onVictim + 1);
    expect(landed.onDecoy).to.equal(before.onDecoy); // the decoy was never reached
  });
});

describe("MCPServer — the mounted form verifies too (RFC 012)", () => {
  // The standalone form fails at start(); mounted cannot (modules attach later), so it verifies
  // once on first contact and refuses to ADVERTISE what the service does not answer.
  const port = 5743;
  const serviceUrl = `http://localhost:${port}/honest`;
  let service;

  beforeAll(async () => {
    service = createService();
    service.module("Games", { score: () => ({ score: 1 }) });
    const mcp = createMCPServer(service);
    mcp.schema("Games", {
      score: { description: "Real.", input: {} },
      winner: { description: "Declared but never implemented.", input: {} },
    });
    mcp.serve("h-mcp", { expose: "*" });
    await service.startService({ route: "honest", port });
    await settle();
  });

  afterAll(async () => {
    if (service) await new Promise((r) => service.close(r));
  });

  it("does not advertise a method the service cannot answer", async () => {
    const tools = await createClient().loadMCP(`${serviceUrl}/h-mcp`);
    const names = tools.__tools.map((t) => t.name);
    expect(names).to.deep.equal(["Games.score"]); // Games.winner declared, dropped
    await tools.__close();
  });
});

describe("MCPServer — routes are discoverable, and servable after start (RFC 012)", () => {
  const port = 5751;
  const serviceUrl = `http://localhost:${port}/late`;
  let service, mcp;

  beforeAll(async () => {
    service = createService();
    service.module("Users", { get: ({ id }) => ({ id }) });
    service.module("Teams", { add: ({ name }) => ({ name }) });
    mcp = createMCPServer(service);
    mcp.schema("Users", { get: { description: "u", input: {} } });
    mcp.schema("Teams", { add: { description: "t", input: {} } });
    await service.startService({ route: "late", port });
    await settle();
  });

  afterAll(async () => {
    if (service) await new Promise((r) => service.close(r));
  });

  const connData = () => require("../../HttpClient/HttpClient")().request({ url: serviceUrl });

  // Load-bearing per systemview-test: the harness's own proxy adds routes at runtime as agents
  // are configured, so this is architecture, not an incidental property.
  it("a route served AFTER startService is live on the next call", async () => {
    let failed = false;
    try {
      await createClient().loadMCP(`${serviceUrl}/harness-mcp`);
    } catch (e) {
      failed = true;
    }
    expect(failed).to.equal(true); // not served yet

    mcp.serve("harness-mcp", { expose: ["Users.get", "Teams.add"] }); // after start

    const tools = await createClient().loadMCP(`${serviceUrl}/harness-mcp`);
    expect(tools.__tools.map((t) => t.name).sort()).to.deep.equal(["Teams.add", "Users.get"]);
    await tools.__close();
  });

  it("publishes its routes in connectionData — asked, not told", async () => {
    const data = await connData();
    const paths = data.mcp.map((r) => r.path).sort();
    // the automatic per-module endpoints, plus the one served above
    expect(paths).to.deep.equal(["Teams/mcp", "Users/mcp", "harness-mcp"]);
    expect(data.mcp.find((r) => r.path === "harness-mcp").kind).to.equal("served");
    expect(data.mcp.find((r) => r.path === "Users/mcp").kind).to.equal("module");
  });

  it("publishes routes LIVE, so one added later still appears", async () => {
    mcp.serve("even-later-mcp", { expose: ["Users.get"] });
    const data = await connData();
    expect(data.mcp.map((r) => r.path)).to.include("even-later-mcp");
  });

  it("does not publish tool names or counts — that is tools/list's job", async () => {
    const data = await connData();
    data.mcp.forEach((r) => {
      expect(r.tools).to.equal(undefined);
      expect(r.count).to.equal(undefined);
    });
  });
});

describe("MCPServer — file arguments cannot cross the transport (RFC 012)", () => {
  // PROVEN against a live service before it was fixed: a remote caller passed a path outside the
  // repo, the in-process client resolved it against the SERVER's filesystem, and the method wrote
  // that file's contents into the repo. Arbitrary file read from anything that could reach the
  // endpoint. Found by systemview-test asking what `attach`'s description should say.
  const port = 5771;
  const serviceUrl = `http://localhost:${port}/up`;
  let service;
  const saved = [];

  beforeAll(async () => {
    service = createService();
    service.module("Files", {
      attach: ({ file, note }) => {
        saved.push(file); // would be a live read stream of a server-side path
        return { got: !!file, note };
      },
      plain: ({ id }) => ({ id }),
    });
    const mcp = createMCPServer(service);
    mcp.schema("Files", {
      attach: {
        description: "Takes an upload.",
        input: { file: { type: "string" }, note: { type: "string" } },
        args: null,
      },
      plain: { description: "Takes no upload.", input: { id: { type: "string" } } },
    });
    mcp.serve("up-mcp", { expose: "*" }); // even a wildcard must not reach it
    await service.startService({ route: "up", port });
    await settle();
  });

  afterAll(async () => {
    if (service) await new Promise((r) => service.close(r));
  });

  const rpc = (body) =>
    require("../../HttpClient/HttpClient")().request({
      method: "post",
      url: `${serviceUrl}/up-mcp`,
      body,
    });

  it("never advertises a method whose schema takes a file, even under expose '*'", async () => {
    const res = await rpc({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
    expect(res.result.tools.map((t) => t.name)).to.deep.equal(["Files.plain"]);
  });

  it("refuses a file argument at call time, and never touches the filesystem", async () => {
    const before = saved.length;
    const res = await rpc({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "Files.attach", arguments: { file: "/etc/hosts", note: "attack" } },
    });
    expect(res.result.isError).to.equal(true);
    expect(res.result.content[0].text).to.include("cannot cross");
    expect(saved.length).to.equal(before); // the method never ran
  });
});

// MCP hands a tool ONE object; a SystemLynx method may be positional. Before `args`, the object
// bound to the FIRST parameter and every later one was undefined — a method that searched for its
// pattern searched for the literal JSON and returned zero, confidently. Found by systemview-test
// consuming the live workbench, not by any test here, which is why these exist now.
describe("MCPServer — positional methods (RFC 012)", () => {
  const port = 5761;
  const serviceUrl = `http://localhost:${port}/pos`;
  let service, mcp;

  beforeAll(async () => {
    service = createService();
    service.module("M", {
      // variadic, exactly like Codebase.grep(pattern, dir)
      pair: (a, b) => ({ a, b }),
      count: function () {
        return { n: arguments.length };
      },
      single: ({ id } = {}) => ({ id }),
    });
    mcp = createMCPServer(service);
    mcp.schema("M", {
      pair: {
        description: "positional",
        input: { a: { type: "string" }, b: { type: "string" } },
        args: ["a", "b"],
      },
      count: {
        description: "reports how many arguments it actually received",
        input: { a: { type: "string" }, b: { type: "string" } },
        args: ["a", "b"],
      },
      single: { description: "takes one object", input: { id: { type: "string" } } },
    });
    mcp.serve("pos-mcp", { expose: "*" });
    await service.startService({ route: "pos", port });
    await settle();
  });

  afterAll(async () => {
    if (service) await new Promise((r) => service.close(r));
  });

  const call = (name, args) =>
    require("../../HttpClient/HttpClient")()
      .request({
        method: "post",
        url: `${serviceUrl}/pos-mcp`,
        body: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } },
      })
      .then((res) => JSON.parse(res.result.content[0].text));

  it("spreads the arguments object across a positional method's parameters", async () => {
    expect(await call("M.pair", { a: "one", b: "two" })).to.deep.equal({ a: "one", b: "two" });
  });

  it("binds the whole object to the first parameter when `args` is absent", async () => {
    expect(await call("M.single", { id: "u1" })).to.deep.equal({ id: "u1" });
  });

  it("omits a trailing argument rather than passing an explicit undefined", async () => {
    // `grep(pattern)` and `grep(pattern, undefined)` differ to a method reading arguments.length.
    expect(await call("M.count", { a: "one" })).to.deep.equal({ n: 1 });
    expect(await call("M.count", { a: "one", b: "two" })).to.deep.equal({ n: 2 });
  });

  it("refuses a file argument in ANY position, not just the first", async () => {
    const res = await require("../../HttpClient/HttpClient")().request({
      method: "post",
      url: `${serviceUrl}/pos-mcp`,
      body: {
        jsonrpc: "2.0",
        id: 9,
        method: "tools/call",
        params: { name: "M.pair", arguments: { a: "ok", b: { file: "/etc/hosts" } } },
      },
    });
    expect(res.result.isError).to.equal(true);
    expect(res.result.content[0].text).to.include("cannot cross");
  });

  it("rejects an `args` name that is not a declared input, at declaration time", () => {
    const m = createMCPServer();
    expect(() =>
      m.schema("X", { f: { description: "d", input: { a: { type: "string" } }, args: ["a", "typo"] } })
    ).to.throw(/typo/);
  });
});

// A method's CALLING CONVENTION is unguessable once it declares more than one input, and guessing
// wrong is silent. So the author declares it. (systemview-test's rule, narrowed: what is required
// is one word where ambiguity exists, not an annotation on everything.)
// buAPI killed the rule that every multi-input method must declare `args`: one-object methods are
// the overwhelming majority across its ~65 modules, so the requirement was a migration answered by
// typing `args: null` unread — and a reflexive annotation reproduces the silent failure it exists to
// prevent. Declaring stays OPTIONAL; arity is what enforces (see the next suite).
describe("MCPServer — declaring the calling convention is optional (RFC 012)", () => {
  it("does not demand an annotation from a multi-input one-object method", () => {
    const m = createMCPServer();
    expect(() =>
      m.schema("X", {
        f: { description: "d", input: { a: { type: "string" }, b: { type: "string" } } },
      })
    ).to.not.throw();
  });

  it("still rejects an `args` name that is not a declared input", () => {
    const m = createMCPServer();
    expect(() =>
      m.schema("X", {
        f: { description: "d", input: { a: { type: "string" } }, args: ["a", "typo"] },
      })
    ).to.throw(/typo/);
  });
});

// The declaration can be MISSING or it can be WRONG. Missing throws at schema() time. This is the
// wrong one — `args: null` on a genuinely positional method — which is what a reflexive annotation
// habit eventually produces, and it reproduces the exact silent-empty-answer it was meant to stop.
// Caught by arity, which is asymmetric evidence: >= 2 proves positional, 1 proves nothing.
describe("MCPServer — a declaration that contradicts the method (RFC 012)", () => {
  const port = 5771;
  const serviceUrl = `http://localhost:${port}/lie`;
  let service, errors;

  beforeAll(async () => {
    errors = [];
    const realError = console.error;
    console.error = (...a) => errors.push(a.join(" "));

    service = createService();
    service.module("M", {
      // POSITIONAL, arity 2 — but its schema will claim it takes one object.
      grep: (pattern, dir) => ({ pattern, dir }),
      // arity 1, genuinely one object
      honest: ({ id } = {}) => ({ id }),
      // Modeled on buAPI's real Networking/Chats: `async function start(data, initialMessage)`.
      // Its schema says NOTHING about how it is called, which is now allowed — arity catches it.
      start: (data, initialMessage) => ({ data, initialMessage }),
    });
    const mcp = createMCPServer(service);
    mcp.schema("M", {
      grep: {
        description: "lies about how it is called",
        input: { pattern: { type: "string" }, dir: { type: "string" } },
        args: null, // ← the lie
      },
      honest: { description: "truthful", input: { id: { type: "string" } } },
      start: {
        description: "positional, and says nothing about it",
        input: { data: { type: "object" }, initialMessage: { type: "string" } },
      },
    });
    mcp.serve("lie-mcp", { expose: "*" });
    await service.startService({ route: "lie", port });
    await settle();

    // first contact triggers the one-time verification
    await require("../../HttpClient/HttpClient")().request({
      method: "post",
      url: `${serviceUrl}/lie-mcp`,
      body: { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
    });
    console.error = realError;
  });

  afterAll(async () => {
    if (service) await new Promise((r) => service.close(r));
  });

  const rpc = (body) =>
    require("../../HttpClient/HttpClient")().request({
      method: "post",
      url: `${serviceUrl}/lie-mcp`,
      body,
    });

  it("refuses to advertise a one-object declaration on a positional method", async () => {
    const res = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    expect(res.result.tools.map((t) => t.name)).to.deep.equal(["M.honest"]);
  });

  it("catches an UNDECLARED positional method too, not just a wrong declaration", () => {
    // No `args` at all — the buAPI shape. Arity >= 2 proves positional with no false positives,
    // which is why nothing has to be typed by an author who would type it unread.
    expect(errors.join("\n")).to.include("M.start");
  });

  it("says WHY, naming the empty-answer failure rather than a type mismatch", () => {
    const said = errors.join("\n");
    expect(said).to.include("M.grep");
    expect(said).to.include("2 positional parameters");
    expect(said).to.include("EMPTY");
  });

  it("still serves the method whose declaration is true", async () => {
    const res = await rpc({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "M.honest", arguments: { id: "u1" } },
    });
    expect(JSON.parse(res.result.content[0].text)).to.deep.equal({ id: "u1" });
  });

  it("publishes arity as a NUMBER, never the function", () => {
    expect(service.__arity.M.grep).to.equal(2);
    // `({ id } = {})` is arity 0, not 1 — `fn.length` stops at the first defaulted parameter. The
    // asymmetry in miniature: a LOW number tells you nothing at all, which is why this can only
    // ever contradict a declaration and never supply one.
    expect(service.__arity.M.honest).to.equal(0);
    expect(Object.keys(service)).to.not.include("__arity"); // non-enumerable: public shape unchanged
  });
});

// THE BUG THIS SESSION ACTUALLY SHIPPED. A hand-written schema declared `$text: {$search}` for
// buAPI's Locations.search, which destructures `{ q, street, city, ... }` and geocodes an address.
// verifyAgainst passed (the method exists), the arity check passed (arity 1, nothing impossible),
// every test was green, and a consumer following the description hit a bare framework error with no
// way to tell fiction from a broken method. Caught here by the same asymmetry as arity, one level in.
describe("MCPServer — a schema that declares inputs the method cannot read (RFC 012)", () => {
  const port = 5781;
  const serviceUrl = `http://localhost:${port}/fiction`;
  let service, errors;

  beforeAll(async () => {
    errors = [];
    const realError = console.error;
    console.error = (...a) => errors.push(a.join(" "));

    service = createService();
    service.module("Locations", {
      // the real buAPI shape
      search: ({ q, street, city, state, location_type } = {}) => ({ q, city, state, location_type }),
      // reads whatever it is given — no opinion possible, so no check
      passthrough: (query) => query,
      // a rest element can read anything — also no opinion
      loose: ({ q, ...rest }) => ({ q, rest }),
    });
    const mcp = createMCPServer(service);
    mcp.schema("Locations", {
      search: {
        description: "declares a field the method never destructures",
        input: { $text: { type: "object" }, q: { type: "string" } },
        args: null,
      },
      passthrough: { description: "not an object pattern", input: { anything: { type: "string" } } },
      loose: {
        description: "has a rest element",
        input: { whatever: { type: "string" } },
        args: null,
      },
    });
    mcp.serve("f-mcp", { expose: "*" });
    await service.startService({ route: "fiction", port });
    await settle();
    await require("../../HttpClient/HttpClient")().request({
      method: "post",
      url: `${serviceUrl}/f-mcp`,
      body: { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
    });
    console.error = realError;
  });

  afterAll(async () => {
    if (service) await new Promise((r) => service.close(r));
  });

  it("refuses to advertise a method whose schema declares a field it cannot read", async () => {
    const res = await require("../../HttpClient/HttpClient")().request({
      method: "post",
      url: `${serviceUrl}/f-mcp`,
      body: { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    });
    const names = res.result.tools.map((t) => t.name);
    expect(names).to.not.include("Locations.search");
  });

  it("names the offending field and what the method actually reads", () => {
    const said = errors.join("\n");
    expect(said).to.include("$text");
    expect(said).to.include("q, street, city, state, location_type");
  });

  it("has NO OPINION when the parameter is not an object pattern", async () => {
    const res = await require("../../HttpClient/HttpClient")().request({
      method: "post",
      url: `${serviceUrl}/f-mcp`,
      body: { jsonrpc: "2.0", id: 3, method: "tools/list", params: {} },
    });
    expect(res.result.tools.map((t) => t.name)).to.include("Locations.passthrough");
  });

  it("has NO OPINION when a rest element could read anything", async () => {
    const res = await require("../../HttpClient/HttpClient")().request({
      method: "post",
      url: `${serviceUrl}/f-mcp`,
      body: { jsonrpc: "2.0", id: 4, method: "tools/list", params: {} },
    });
    expect(res.result.tools.map((t) => t.name)).to.include("Locations.loose");
  });

  it("reads keys, not bindings — a renamed binding still publishes its property", () => {
    expect(service.__inputKeys.Locations.search).to.deep.equal([
      "q",
      "street",
      "city",
      "state",
      "location_type",
    ]);
    expect(service.__inputKeys.Locations.loose).to.equal(null);
  });
});

// A route that serves nothing while looking alive is the same silent zero as everything else here.
// `expose` as a function was proposed and removed; passing one used to yield an empty tool list.
describe("MCPServer — serve() refuses an expose it cannot honour (RFC 012)", () => {
  it("throws rather than advertising nothing", () => {
    const m = createMCPServer();
    expect(() => m.serve("x-mcp", { expose: (req) => ["A"] })).to.throw(/must be/);
  });

  it("still accepts the two shapes it does support", () => {
    const m = createMCPServer();
    expect(() => m.serve("a-mcp", { expose: "*" })).to.not.throw();
    expect(() => m.serve("b-mcp", { expose: ["A.b"] })).to.not.throw();
    expect(() => m.serve("c-mcp", { expose: "A" })).to.not.throw();
  });
});
