const { expect } = require("chai");
const LoadBalancer = require("../LoadBalancer")();
const createService = require("../../Service/Service");
const createApp = require("../../App/App");
const createClient = require("../../Client/Client");
const HttpClient = require("../../HttpClient/HttpClient")();
const lbPort = 5030;
const route = "loadbalancer";
const lbUrl = `http://localhost:${lbPort}/${route}`;

// Spin up N real clone Apps of one service: each defines the same module, joins the cluster
// with the `clone` plugin (so `this.clone` is live inside its methods), and registers with
// the LB. `onReady(clone)` lets a clone subscribe to broadcasts once its handle is wired.
const spawnCloneApps = async (route, moduleName, def, ports, onReady) => {
  const clones = [];
  for (const port of ports) {
    const App = createApp();
    App.module(moduleName, def);
    const plugin = LoadBalancer.clone({ url: lbUrl });
    App.use(plugin);
    if (onReady) App.on("clone_ready", onReady);
    await new Promise((r) => App.startService({ route, port }).on("ready", r));
    await plugin.joined; // registered with the LB
    clones.push({ App, plugin, port, url: `http://localhost:${port}/${route}` });
  }
  return clones;
};
// Call a method on a specific clone the way a real consumer would — over the RPC client.
const call = async (url, module, fn, ...args) =>
  (await createClient().loadService(url))[module][fn](...args);

// Define a service's module once, then spin up N instances (clones) of it on different
// ports and register each with the LoadBalancer — a real cluster: many services, each cloned.
const spawnClones = async (route, moduleName, def, ports) => {
  for (const port of ports) {
    const svc = createService();
    svc.module(moduleName, def);
    await svc.startService({ route, port });
    await LoadBalancer.Tentacle.register({ url: `http://localhost:${port}/${route}` });
  }
};

const connected = (service) => new Promise((resolve) => service.on("connect", resolve));

// A few tests below intentionally kill clones or down the whole cluster; the LoadBalancer and
// client correctly LOG those failures. `muteLogs()` opts a test into silencing those expected
// warn/error lines so a green suite doesn't print red noise — assertions still run. The
// afterEach restores console even if the test throws.
let restoreConsole = null;
const muteLogs = () => {
  const { warn, error } = console;
  restoreConsole = () => {
    console.warn = warn;
    console.error = error;
    restoreConsole = null;
  };
  console.warn = console.error = () => {};
};
afterEach(() => {
  if (restoreConsole) restoreConsole();
});

describe("LoadBalancer()", () => {
  it("should return a SystemLynx LoadBalancer with a `Clones` module", () => {
    expect(LoadBalancer)
      .to.be.an("object")
      .that.has.all.keys(
        "startService",
        "server",
        "WebSocket",
        "Tentacle",
        "clone",
        "module",
        "before",
        "after",
        "close"
      );
    expect(LoadBalancer.clone).to.be.a("function");
    expect(LoadBalancer.Tentacle)
      .to.be.an("object")
      .that.respondsTo("register")
      .that.respondsTo("directory")
      .that.respondsTo("delegate")
      .that.respondsTo("broadcast")
      .that.respondsTo("elect")
      .that.respondsTo("resign")
      .that.has.property("services")
      .that.is.an("array");
  });

  it("should start the LoadBalancer service", async () => {
    await LoadBalancer.startService({ port: lbPort, route });
    const connData = await HttpClient.request({ url: `http://localhost:${lbPort}/${route}` });
    expect(connData.modules).to.be.an("array").with.a.lengthOf(1);
  });
});

// The cluster under test: two DIFFERENT services, each with MULTIPLE clones.
//   Service A ("svc-a") → 3 clones      Service B ("svc-b") → 2 clones
const A = { route: "svc-a", module: "Work", ports: [5421, 5422, 5423] };
const B = { route: "svc-b", module: "Shop", ports: [5431, 5432] };

describe("LoadBalancer.Tentacle — service discovery & balancing", () => {
  beforeAll(async () => {
    await spawnClones(A.route, A.module, { who: () => ({ service: "A" }) }, A.ports);
    await spawnClones(B.route, B.module, { who: () => ({ service: "B" }) }, B.ports);
  });

  it("should round-robin across ALL clones of each service", async () => {
    const hit = async (r, n) => {
      const seen = new Set();
      for (let i = 0; i < n; i++)
        seen.add((await HttpClient.request({ url: `http://localhost:${lbPort}/${r}` })).port);
      return seen;
    };
    expect((await hit(A.route, A.ports.length)).size).to.equal(A.ports.length); // all 3 A clones
    expect((await hit(B.route, B.ports.length)).size).to.equal(B.ports.length); // both B clones
  });

  it("should load and CALL both services from one LoadBalancer directory call", async () => {
    const bundle = await LoadBalancer.Tentacle.directory(["/svc-a", "/svc-b"]);
    expect(bundle).to.have.all.keys("/svc-a", "/svc-b");

    const Client = createClient();
    const a = Client.createService(bundle["/svc-a"]);
    const b = Client.createService(bundle["/svc-b"]);
    await Promise.all([connected(a), connected(b)]);

    expect(await a.Work.who()).to.deep.equal({ service: "A" });
    expect(await b.Shop.who()).to.deep.equal({ service: "B" });
  });
});

describe("LoadBalancer — cluster coordination via this.clone (real clones)", () => {
  it("delegate: only ONE clone does the work — `this.clone.delegate` inside a module method", async () => {
    const ran = [];
    // a real service module whose method delegates its side effect so it runs once cluster-wide
    const Billing = function () {
      this.runMonthEnd = async function () {
        const { delegated } = await this.clone.delegate("month-end");
        if (delegated) ran.push(this.req.headers.host); // only the chosen clone acts
        return { delegated };
      };
    };
    const clones = await spawnCloneApps("billing", "Billing", Billing, [5501, 5502, 5503]);

    // every clone independently receives the trigger — called over the real RPC client
    const results = await Promise.all(clones.map((c) => call(c.url, "Billing", "runMonthEnd")));

    expect(ran).to.have.lengthOf(1); // the work happened once across the whole cluster
    expect(results.filter((r) => r.delegated)).to.have.lengthOf(1);
  });

  it("broadcast: `this.clone.broadcast` reaches every clone's `this.clone.on` handler", async () => {
    const flushed = [];
    // each clone subscribes to the cluster flush once its clone handle is wired
    const subscribe = (id) => (clone) => clone.on("flush-cache", () => flushed.push(id));
    const Cache = { evict: () => ({ ok: true }) };

    const [a] = await spawnCloneApps("cache", "Cache", Cache, [5511], subscribe("a"));
    await spawnCloneApps("cache", "Cache", Cache, [5512], subscribe("b"));
    await new Promise((r) => setTimeout(r, 200)); // let both room subscriptions land

    await a.App.clone.broadcast("flush-cache"); // one clone fires a cluster-wide flush
    await new Promise((r) => setTimeout(r, 200));

    expect(flushed).to.have.members(["a", "b"]); // every clone reacted
  });

  it("elect: exactly ONE clone becomes leader — `this.clone.elect` inside a method", async () => {
    const Scheduler = function () {
      this.tryLead = async function () {
        const { leader } = await this.clone.elect({
          role: "cron",
          holderId: this.req.headers.host,
        });
        return { leader };
      };
    };
    const clones = await spawnCloneApps("sched", "Scheduler", Scheduler, [5521, 5522, 5523]);
    const results = await Promise.all(clones.map((c) => call(c.url, "Scheduler", "tryLead")));
    expect(results.filter((r) => r.leader)).to.have.lengthOf(1); // exactly one leader
  });
});

describe("this.clone — delegate & elect under real conditions (real clones)", () => {
  it("delegate holds under a concurrent burst — exactly ONE winner cluster-wide", async () => {
    const wins = [];
    // a real service method that delegates its side effect so it runs once across the cluster
    const Report = function () {
      this.fire = async function () {
        const { delegated } = await this.clone.delegate("burst-job");
        if (delegated) wins.push(this.req.headers.host); // only the chosen clone acts
        return { delegated };
      };
    };
    const clones = await spawnCloneApps("burst", "Report", Report, [5551, 5552, 5553]);
    const services = await Promise.all(clones.map((c) => createClient().loadService(c.url)));

    // 50 triggers racing the same key, spread across the live clones
    const results = await Promise.all(
      Array.from({ length: 50 }, (_, i) => services[i % services.length].Report.fire())
    );

    expect(results.filter((r) => r.delegated)).to.have.lengthOf(1); // one winner in the race
    expect(wins).to.have.lengthOf(1); // the work happened exactly once
  });

  it("delegate frees a key after its retention window (dedupes, but not forever)", async () => {
    // the same trigger fired repeatedly on one clone: deduped while the window is open, live after
    const Nightly = function () {
      this.run = async function () {
        return this.clone.delegate("nightly");
      };
    };
    const [clone] = await spawnCloneApps("nightly-svc", "Nightly", Nightly, [5554]);
    LoadBalancer.Tentacle.delegateTTL = 50; // tiny retention window for the test

    expect((await call(clone.url, "Nightly", "run")).delegated).to.equal(true);
    expect((await call(clone.url, "Nightly", "run")).delegated).to.equal(false); // deduped in-window
    await new Promise((r) => setTimeout(r, 90)); // window lapses
    expect((await call(clone.url, "Nightly", "run")).delegated).to.equal(true); // re-delegable after

    LoadBalancer.Tentacle.delegateTTL = 60000; // restore
  });

  it("elect: a leader resigns and the next clone takes over immediately", async () => {
    // a scheduler role held by one clone; it can step down so another leads right now
    const Scheduler = function () {
      this.lead = async function () {
        return this.clone.elect({ role: "sched2", holderId: this.req.headers.host });
      };
      this.stepDown = async function () {
        return this.clone.resign({ role: "sched2", holderId: this.req.headers.host });
      };
    };
    const clones = await spawnCloneApps("sched2-svc", "Scheduler", Scheduler, [5565, 5566, 5567]);

    const elected = await Promise.all(clones.map((c) => call(c.url, "Scheduler", "lead")));
    expect(elected.filter((r) => r.leader)).to.have.lengthOf(1); // exactly one leader
    const leader = clones[elected.findIndex((r) => r.leader)];

    await call(leader.url, "Scheduler", "stepDown"); // the leader resigns
    const other = clones.find((c) => c !== leader);
    expect((await call(other.url, "Scheduler", "lead")).leader).to.equal(true); // another takes over
  });

  it("elect: a lapsed (crashed) leader is replaced without a resign", async () => {
    const Scheduler = function () {
      this.lead = async function () {
        return this.clone.elect({ role: "cron2", holderId: this.req.headers.host });
      };
    };
    const clones = await spawnCloneApps("lapse-svc", "Scheduler", Scheduler, [5558, 5559]);
    LoadBalancer.Tentacle.leaseTTL = 60; // tiny lease so a non-renewing leader lapses fast

    const elected = await Promise.all(clones.map((c) => call(c.url, "Scheduler", "lead")));
    expect(elected.filter((r) => r.leader)).to.have.lengthOf(1); // one leader, one loser
    const loser = clones[elected.findIndex((r) => !r.leader)];

    // while the lease is live, the loser cannot steal the role
    expect((await call(loser.url, "Scheduler", "lead")).leader).to.equal(false);
    await new Promise((r) => setTimeout(r, 130)); // the leader "crashes" — never renews
    expect((await call(loser.url, "Scheduler", "lead")).leader).to.equal(true); // wins the lapsed role

    LoadBalancer.Tentacle.leaseTTL = 15000; // restore
  });
});

describe("LoadBalancer.Tentacle — discovery robustness (loops & failover)", () => {
  it("should evict a dead clone and serve a live one — real failover, no loop", async () => {
    muteLogs(); // intentionally routes to a dead clone; the LB correctly warns on eviction
    const r = "failover-svc";
    const live = createService();
    live.module("Ping", { ping: () => ({ ok: true }) });
    await live.startService({ route: r, port: 5411 });
    await LoadBalancer.Tentacle.register({ url: `http://localhost:5411/${r}` });

    // a clone that has since died is added to the pool, and is tried first
    const svc = LoadBalancer.Tentacle.services.find((s) => s.route === `/${r}`);
    svc.locations.unshift(`http://localhost:5999/${r}`);

    const connData = await HttpClient.request({ url: `http://localhost:${lbPort}/${r}` });
    expect(connData.port).to.equal(5411); // served the live one
    expect(svc.locations).to.not.include(`http://localhost:5999/${r}`); // dead one evicted
  });

  it("should 404 gracefully when every clone is dead — terminates, never loops", async () => {
    muteLogs(); // every clone is dead by design; the LB correctly warns as it evicts each
    const r = "all-dead-svc";
    const s = createService();
    await s.startService({ route: r, port: 5412 });
    await LoadBalancer.Tentacle.register({ url: `http://localhost:5412/${r}` });

    const svc = LoadBalancer.Tentacle.services.find((x) => x.route === `/${r}`);
    svc.locations = [`http://localhost:5997/${r}`, `http://localhost:5998/${r}`]; // all dead

    let error;
    try {
      await HttpClient.request({ url: `http://localhost:${lbPort}/${r}` });
    } catch (e) {
      error = e; // the request RESOLVES (404) rather than hanging in the eviction recursion
    }
    expect(error).to.have.property("message").that.matches(/No live clones/);
    expect(svc.locations).to.be.empty; // every dead location was evicted
  });
});

describe("LoadBalancer.Tentacle — intelligent routing & health", () => {
  it("routes to the least-loaded clone under the least-load policy", async () => {
    const r = "balanced-svc";
    const c1 = createService();
    const c2 = createService();
    await c1.startService({ route: r, port: 5461 });
    await c2.startService({ route: r, port: 5462 });
    const loc1 = `http://localhost:5461/${r}`;
    const loc2 = `http://localhost:5462/${r}`;
    await LoadBalancer.Tentacle.register({ url: loc1 });
    await LoadBalancer.Tentacle.register({ url: loc2 });

    LoadBalancer.Tentacle.report({ location: loc1, load: 10 });
    LoadBalancer.Tentacle.report({ location: loc2, load: 2 });
    LoadBalancer.Tentacle.policy = "least-load";

    const url = `http://localhost:${lbPort}/${r}`;
    const a = await HttpClient.request({ url });
    const b = await HttpClient.request({ url });
    expect(a.port).to.equal(5462); // the lighter clone
    expect(b.port).to.equal(5462); // still, until the load picture changes

    LoadBalancer.Tentacle.policy = "round-robin"; // restore
  });

  it("evicts a clone whose heartbeat goes stale", async () => {
    const r = "hb-svc";
    const s1 = createService();
    const s2 = createService();
    await s1.startService({ route: r, port: 5463 });
    await s2.startService({ route: r, port: 5464 });
    const loc1 = `http://localhost:5463/${r}`;
    const loc2 = `http://localhost:5464/${r}`;
    await LoadBalancer.Tentacle.register({ url: loc1 });
    await LoadBalancer.Tentacle.register({ url: loc2 });

    LoadBalancer.Tentacle.heartbeatTTL = 60;
    LoadBalancer.Tentacle.heartbeat({ location: loc1 });
    LoadBalancer.Tentacle.heartbeat({ location: loc2 });
    await new Promise((res) => setTimeout(res, 120)); // both lapse
    LoadBalancer.Tentacle.heartbeat({ location: loc1 }); // only loc1 keeps beating

    const url = `http://localhost:${lbPort}/${r}`;
    await HttpClient.request({ url }); // routing sweeps out the stale loc2
    await HttpClient.request({ url });

    const svc = LoadBalancer.Tentacle.services.find((s) => s.route === `/${r}`);
    expect(svc.locations).to.include(loc1);
    expect(svc.locations).to.not.include(loc2);

    LoadBalancer.Tentacle.heartbeatTTL = 30000; // restore
  });

  it("a clone's plugin actually pushes its load + heartbeat to the LB", async () => {
    await spawnCloneApps("metrics-svc", "M", { ping: () => ({ ok: true }) }, [5531]);
    await new Promise((r) => setTimeout(r, 250)); // the plugin reports once on join

    const location = "http://localhost:5531/metrics-svc";
    expect(LoadBalancer.Tentacle.loads.has(location)).to.equal(true); // load reached the LB
    const entry = LoadBalancer.Tentacle.loads.get(location);
    expect(entry).to.have.property("load");
    expect(entry).to.have.property("seen"); // and it doubles as a heartbeat
  });
});

describe("LoadBalancer — transparent failover (reconnect through the LB)", () => {
  it("returns connectionData whose serviceUrl points back through the LoadBalancer", async () => {
    const r = "reconnect-svc";
    const s = createService();
    s.module("Api", { hi: () => ({ hi: true }) });
    await s.startService({ route: r, port: 5481 });
    await LoadBalancer.Tentacle.register({ url: `http://localhost:5481/${r}` });

    const connData = await HttpClient.request({ url: `http://localhost:${lbPort}/${r}` });
    expect(connData.port).to.equal(5481); // direct connection targets the clone...
    // ...but reconnect flows back through the LB, so a dead clone fails over to a live one
    expect(connData.serviceUrl).to.equal(`http://localhost:${lbPort}/${r}`);
  });

  it("switches clones mid-call: a method works, its clone dies, the next call is seamlessly served by another", async () => {
    muteLogs(); // one clone dies mid-call by design; the LB correctly warns on eviction
    const r = "resilient";
    const clone = (port) => ({
      whoami: () => ({ servedBy: port }),
      ping: () => ({ servedBy: port, pong: true }),
    });
    const A = createService();
    const B = createService();
    A.module("Api", clone(5491));
    B.module("Api", clone(5492));
    await A.startService({ route: r, port: 5491 });
    await B.startService({ route: r, port: 5492 });
    await LoadBalancer.Tentacle.register({ url: `http://localhost:5491/${r}` });
    await LoadBalancer.Tentacle.register({ url: `http://localhost:5492/${r}` });

    // a consumer loads the service THROUGH the LoadBalancer and makes a call — lands on one clone
    const service = await createClient().loadService(`http://localhost:${lbPort}/${r}`);
    const first = await service.Api.whoami();
    const servedBy = first.servedBy;

    // that clone dies
    await new Promise((res) => (servedBy === 5491 ? A : B).close(res));

    // the very next call — the consumer does nothing special — is transparently reconnected
    // through the LB and answered by the OTHER clone, mid-call
    const next = await service.Api.ping();
    expect(next.pong).to.equal(true);
    expect(next.servedBy).to.equal(servedBy === 5491 ? 5492 : 5491);
  });

  it("reconnects when a stranger (non-SystemLynx server) answers on the clone's port", async () => {
    const http = require("http");
    const r = "takeover";
    const A = createService();
    const B = createService();
    A.module("Api", { hi: () => ({ from: "A" }) });
    B.module("Api", { hi: () => ({ from: "B" }) });
    await A.startService({ route: r, port: 5497 });
    await B.startService({ route: r, port: 5498 });
    await LoadBalancer.Tentacle.register({ url: `http://localhost:5497/${r}` });
    await LoadBalancer.Tentacle.register({ url: `http://localhost:5498/${r}` });

    const service = await createClient().loadService(`http://localhost:${lbPort}/${r}`);
    const onPort = (await service.Api.hi()).from === "A" ? 5497 : 5498;
    const survivor = onPort === 5497 ? "B" : "A";

    // take that clone off the LB, kill it, and put a *stranger* on its port that returns a
    // perfectly valid 200 — but without the SystemLynx marker
    const svc = LoadBalancer.Tentacle.services.find((s) => s.route === `/${r}`);
    svc.locations = svc.locations.filter((l) => !l.includes(`:${onPort}/`));
    await new Promise((res) => (onPort === 5497 ? A : B).close(res));
    const stranger = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("{}");
    });
    await new Promise((res) => stranger.listen(onPort, res));

    // the call gets a non-SystemLynx 200 → the client rejects it and reconnects to the survivor
    expect((await service.Api.hi()).from).to.equal(survivor);
    await new Promise((res) => stranger.close(res));
  });

  it("directory-loaded services also reconnect through the LB (serviceUrl points at the LB)", async () => {
    const r = "dir-failover";
    const s = createService();
    s.module("Api", { hi: () => ({ ok: true }) });
    await s.startService({ route: r, port: 5541 });
    await LoadBalancer.Tentacle.register({ url: `http://localhost:5541/${r}` });
    // hit the LB over HTTP once so it learns its own base URL (the lbBase middleware)
    await HttpClient.request({ url: `http://localhost:${lbPort}/${r}` });

    const bundle = await LoadBalancer.Tentacle.directory([`/${r}`]);
    // a client building from this connectionData reconnects through the LB, not the clone
    expect(bundle[`/${r}`].serviceUrl).to.equal(`http://localhost:${lbPort}/${r}`);
  });

  it("rejects (does not hang) when the whole cluster is down", async () => {
    muteLogs(); // the whole cluster is downed by design; client + LB correctly log the failure
    const r = "doomed";
    const only = createService();
    only.module("Api", { ping: () => ({ ok: true }) });
    await only.startService({ route: r, port: 5495 });
    await LoadBalancer.Tentacle.register({ url: `http://localhost:5495/${r}` });

    const service = await createClient().loadService(`http://localhost:${lbPort}/${r}`);
    await service.Api.ping(); // works while the clone is up
    await new Promise((res) => only.close(res)); // kill the only clone

    let err;
    try {
      await service.Api.ping();
    } catch (e) {
      err = e;
    }
    expect(err).to.exist; // rejected rather than hanging forever
  });
});

describe("LoadBalancer.clone — the tentacle plugin (real cluster join)", () => {
  const createApp = require("../../App/App");
  const lbUrl = `http://localhost:${lbPort}/${route}`;

  it("joins with one App.use, and this.clone.delegate runs work ONCE across real clones", async () => {
    const ran = [];
    const makeClone = async (port) => {
      const App = createApp();
      App.module("Jobs", function () {
        this.run = async function () {
          const { delegated } = await this.clone.delegate("cluster-report");
          if (delegated) ran.push(port);
          return { delegated };
        };
      });
      const plugin = LoadBalancer.clone({ url: lbUrl });
      App.use(plugin);
      await new Promise((r) => App.startService({ route: "jobs", port }).on("ready", r));
      await plugin.joined; // wait until it has actually registered with the LB
    };
    await Promise.all([5451, 5452, 5453].map(makeClone));

    // the plugin auto-registered all three clones under one service, no manual register()
    const jobs = LoadBalancer.Tentacle.services.find((s) => s.route === "/jobs");
    expect(jobs.locations).to.have.lengthOf(3);

    // fire the same event on every clone; exactly one should do the work
    const results = await Promise.all(
      [5451, 5452, 5453].map((port) =>
        HttpClient.request({
          method: "POST",
          url: `http://localhost:${port}/jobs/Jobs/run`,
          body: { __arguments: [] },
        })
      )
    );
    expect(ran).to.have.lengthOf(1);
    expect(results.filter((r) => r.returnValue.delegated)).to.have.lengthOf(1);
  });

  it("exposes App.clone as a capturable handle for background/event code (no `this`)", async () => {
    const App = createApp();
    App.module("Noop", { ping: () => ({ ok: true }) });
    const plugin = LoadBalancer.clone({ url: lbUrl });
    App.use(plugin);
    await new Promise((r) => App.startService({ route: "bg", port: 5471 }).on("ready", r));
    await plugin.installed;

    const res = await App.clone.delegate("bg-only-once");
    expect(res).to.have.property("delegated", true);
  });

  it("throws (rejects `installed`) when a module already defines its `clone` namespace", async () => {
    const App = createApp();
    App.module("Collider", function () {
      this.clone = () => "my own method";
    });
    const plugin = LoadBalancer.clone({ url: lbUrl });
    App.use(plugin);
    App.startService({ route: "collide", port: 5472 });

    let err;
    try {
      await plugin.installed;
    } catch (e) {
      err = e;
    }
    expect(err).to.exist;
    expect(err.message).to.match(/already defines "clone"/);
  });

  it("relocates with { namespace } so a module's own `clone` method survives", async () => {
    const App = createApp();
    App.module("HasClone", function () {
      this.clone = () => "my own clone method";
    });
    const plugin = LoadBalancer.clone({ url: lbUrl, namespace: "cluster" });
    App.use(plugin);
    await new Promise((r) => App.startService({ route: "relocated", port: 5473 }).on("ready", r));
    await plugin.installed;

    expect(App.getModule("HasClone").clone()).to.equal("my own clone method"); // intact
    expect(App.cluster).to.respondTo("delegate"); // tentacle moved aside
  });
});
