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
    const plugin = LoadBalancer.clone({ url: lbUrl, serviceId: route });
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
    await LoadBalancer.Tentacle.register({
      url: `http://localhost:${port}/${route}`,
      serviceId: route,
    });
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
        "close",
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
    const connData = await HttpClient.request({
      url: `http://localhost:${lbPort}/${route}`,
    });
    expect(connData.modules).to.be.an("array").with.a.lengthOf(1);
  });
});

// The LoadBalancer is net-new — there is no legacy join to accommodate, so registering REQUIRES a
// serviceId. No fallback that guesses an id from name/route/url ("so a lone service still registers").
describe("LoadBalancer — registering requires a serviceId (no backwards-compat fallback)", () => {
  it("Tentacle.register rejects a missing serviceId with 400 (before it even reaches the member)", async () => {
    const res = await LoadBalancer.Tentacle.register({
      url: `http://localhost:${lbPort}/${route}`,
    });
    expect(res).to.include({ status: 400 });
    expect(res.message).to.match(/serviceId is required/);
  });

  it("LoadBalancer.clone throws synchronously without a serviceId", () => {
    expect(() => LoadBalancer.clone({ url: lbUrl })).to.throw(/serviceId.*required/);
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
        seen.add(
          (await HttpClient.request({ url: `http://localhost:${lbPort}/${r}` })).port,
        );
      return seen;
    };
    expect((await hit(A.route, A.ports.length)).size).to.equal(A.ports.length); // all 3 A clones
    expect((await hit(B.route, B.ports.length)).size).to.equal(B.ports.length); // both B clones
  });

  it("should load and CALL both services from one LoadBalancer directory call", async () => {
    const bundle = await LoadBalancer.Tentacle.directory(["svc-a", "svc-b"]);
    expect(bundle).to.have.all.keys("svc-a", "svc-b"); // keyed by serviceId

    const Client = createClient();
    const a = Client.createService(bundle["svc-a"]);
    const b = Client.createService(bundle["svc-b"]);
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
    const clones = await spawnCloneApps(
      "billing",
      "Billing",
      Billing,
      [5501, 5502, 5503],
    );

    // every clone independently receives the trigger — called over the real RPC client
    const results = await Promise.all(
      clones.map((c) => call(c.url, "Billing", "runMonthEnd")),
    );

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
    const clones = await spawnCloneApps(
      "sched",
      "Scheduler",
      Scheduler,
      [5521, 5522, 5523],
    );
    const results = await Promise.all(
      clones.map((c) => call(c.url, "Scheduler", "tryLead")),
    );
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
    const services = await Promise.all(
      clones.map((c) => createClient().loadService(c.url)),
    );

    // 50 triggers racing the same key, spread across the live clones
    const results = await Promise.all(
      Array.from({ length: 50 }, (_, i) => services[i % services.length].Report.fire()),
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
    const clones = await spawnCloneApps(
      "sched2-svc",
      "Scheduler",
      Scheduler,
      [5565, 5566, 5567],
    );

    const elected = await Promise.all(
      clones.map((c) => call(c.url, "Scheduler", "lead")),
    );
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
    const clones = await spawnCloneApps(
      "lapse-svc",
      "Scheduler",
      Scheduler,
      [5344, 5322],
    );
    LoadBalancer.Tentacle.leaseTTL = 60; // tiny lease so a non-renewing leader lapses fast

    const elected = await Promise.all(
      clones.map((c) => call(c.url, "Scheduler", "lead")),
    );
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
    await LoadBalancer.Tentacle.register({ url: `http://localhost:5411/${r}`, serviceId: r });

    // a clone that has since died is added to the pool, and is tried first
    const svc = LoadBalancer.Tentacle.services.find((s) => s.route === `/${r}`);
    svc.members.unshift(`http://localhost:5999/${r}`);

    const connData = await HttpClient.request({ url: `http://localhost:${lbPort}/${r}` });
    expect(connData.port).to.equal(5411); // served the live one
    expect(svc.members).to.not.include(`http://localhost:5999/${r}`); // dead one evicted
  });

  it("should 404 gracefully when every clone is dead — terminates, never loops", async () => {
    muteLogs(); // every clone is dead by design; the LB correctly warns as it evicts each
    const r = "all-dead-svc";
    const s = createService();
    await s.startService({ route: r, port: 5412 });
    await LoadBalancer.Tentacle.register({ url: `http://localhost:5412/${r}`, serviceId: r });

    const svc = LoadBalancer.Tentacle.services.find((x) => x.route === `/${r}`);
    svc.members = [`http://localhost:5997/${r}`, `http://localhost:5998/${r}`]; // all dead

    let error;
    try {
      await HttpClient.request({ url: `http://localhost:${lbPort}/${r}` });
    } catch (e) {
      error = e; // the request RESOLVES (404) rather than hanging in the eviction recursion
    }
    expect(error)
      .to.have.property("message")
      .that.matches(/No live members/);
    expect(svc.members).to.be.empty; // every dead location was evicted
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
    await LoadBalancer.Tentacle.register({ url: loc1, serviceId: r });
    await LoadBalancer.Tentacle.register({ url: loc2, serviceId: r });

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
    await LoadBalancer.Tentacle.register({ url: loc1, serviceId: r });
    await LoadBalancer.Tentacle.register({ url: loc2, serviceId: r });

    LoadBalancer.Tentacle.heartbeatTTL = 60;
    LoadBalancer.Tentacle.heartbeat({ location: loc1 });
    LoadBalancer.Tentacle.heartbeat({ location: loc2 });
    await new Promise((res) => setTimeout(res, 120)); // both lapse
    LoadBalancer.Tentacle.heartbeat({ location: loc1 }); // only loc1 keeps beating

    const url = `http://localhost:${lbPort}/${r}`;
    await HttpClient.request({ url }); // routing sweeps out the stale loc2
    await HttpClient.request({ url });

    const svc = LoadBalancer.Tentacle.services.find((s) => s.route === `/${r}`);
    expect(svc.members).to.include(loc1);
    expect(svc.members).to.not.include(loc2);

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

describe("LoadBalancer.Tentacle — observability (SystemView hooks)", () => {
  it("emits a local route_assigned event naming the chosen clone + policy on each routing decision", async () => {
    const r = "obs-route";
    const s = createService();
    s.module("Api", { ping: () => ({ ok: true }) });
    await s.startService({ route: r, port: 5571 });
    const location = `http://localhost:5571/${r}`;
    await LoadBalancer.Tentacle.register({ url: location, serviceId: r });

    // a co-loaded observer (e.g. a SystemView plugin inside the LB) subscribes exactly like this
    const assigned = new Promise((resolve) =>
      LoadBalancer.Tentacle.on("route_assigned", (evt) => {
        if (evt.route === `/${r}`) resolve(evt);
      }),
    );
    await HttpClient.request({ url: `http://localhost:${lbPort}/${r}` }); // a discovery = a routing decision
    const evt = await assigned;

    expect(evt).to.have.property("location", location); // which clone got the connection
    expect(evt).to.have.property("policy"); // under which policy the choice was made
  });

  it("getClusterState() returns a stable, read-only snapshot — over RPC (real usage) and in-process", async () => {
    // real usage: a client loads the LoadBalancer and calls Tentacle.getClusterState() over the wire
    const lb = await createClient().loadService(lbUrl);
    const state = await lb.Tentacle.getClusterState();
    expect(state).to.have.all.keys("policy", "services", "loads", "ttls");
    expect(state.services).to.be.an("array");
    expect(state.loads).to.be.an("array");
    expect(state.ttls).to.have.all.keys("delegate", "lease", "heartbeat");

    // in-process (the co-loaded-plugin path): the snapshot is a copy — mutating it never touches live state
    const snapshot = LoadBalancer.Tentacle.getClusterState();
    const liveCount = LoadBalancer.Tentacle.services.length;
    snapshot.services.push({ route: "/injected" });
    expect(LoadBalancer.Tentacle.services).to.have.lengthOf(liveCount);
  });
});

describe("LoadBalancer — transparent failover (reconnect through the LB)", () => {
  it("returns connectionData whose serviceUrl points back through the LoadBalancer", async () => {
    const r = "reconnect-svc";
    const s = createService();
    s.module("Api", { hi: () => ({ hi: true }) });
    await s.startService({ route: r, port: 5481 });
    await LoadBalancer.Tentacle.register({ url: `http://localhost:5481/${r}`, serviceId: r });

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
    await LoadBalancer.Tentacle.register({ url: `http://localhost:5491/${r}`, serviceId: r });
    await LoadBalancer.Tentacle.register({ url: `http://localhost:5492/${r}`, serviceId: r });

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

  it("directory-loaded services also reconnect through the LB (serviceUrl points at the LB)", async () => {
    const r = "dir-failover";
    const s = createService();
    s.module("Api", { hi: () => ({ ok: true }) });
    await s.startService({ route: r, port: 5541 });
    await LoadBalancer.Tentacle.register({ url: `http://localhost:5541/${r}`, serviceId: r });
    // hit the LB over HTTP once so it learns its own base URL (the lbBase middleware)
    await HttpClient.request({ url: `http://localhost:${lbPort}/${r}` });

    const bundle = await LoadBalancer.Tentacle.directory([`/${r}`]);
    // a client building from this connectionData reconnects through the LB, not the clone
    expect(bundle[r].serviceUrl).to.equal(`http://localhost:${lbPort}/${r}`); // keyed by serviceId
  });

  it("rejects (does not hang) when the whole cluster is down", async () => {
    muteLogs(); // the whole cluster is downed by design; client + LB correctly log the failure
    const r = "doomed";
    const only = createService();
    only.module("Api", { ping: () => ({ ok: true }) });
    await only.startService({ route: r, port: 5495 });
    await LoadBalancer.Tentacle.register({ url: `http://localhost:5495/${r}`, serviceId: r });

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
      const plugin = LoadBalancer.clone({ url: lbUrl, serviceId: "jobs" });
      App.use(plugin);
      await new Promise((r) => App.startService({ route: "jobs", port }).on("ready", r));
      await plugin.joined; // wait until it has actually registered with the LB
    };
    await Promise.all([5451, 5452, 5453].map(makeClone));

    // the plugin auto-registered all three clones under one service, no manual register()
    const jobs = LoadBalancer.Tentacle.services.find((s) => s.route === "/jobs");
    expect(jobs.members).to.have.lengthOf(3);

    // fire the same event on every clone; exactly one should do the work
    const results = await Promise.all(
      [5451, 5452, 5453].map((port) =>
        HttpClient.request({
          method: "POST",
          url: `http://localhost:${port}/jobs/Jobs/run`,
          body: { __arguments: [] },
        }),
      ),
    );
    expect(ran).to.have.lengthOf(1);
    expect(results.filter((r) => r.returnValue.delegated)).to.have.lengthOf(1);
  });

  it("exposes App.clone as a capturable handle for background/event code (no `this`)", async () => {
    const App = createApp();
    App.module("Noop", { ping: () => ({ ok: true }) });
    const plugin = LoadBalancer.clone({ url: lbUrl, serviceId: "bg" });
    App.use(plugin);
    await new Promise((r) =>
      App.startService({ route: "bg", port: 5471 }).on("ready", r),
    );
    await plugin.installed;

    const res = await App.clone.delegate("bg-only-once");
    expect(res).to.have.property("delegated", true);
  });

  it("throws (rejects `installed`) when a module already defines its `clone` namespace", async () => {
    const App = createApp();
    App.module("Collider", function () {
      this.clone = () => "my own method";
    });
    const plugin = LoadBalancer.clone({ url: lbUrl, serviceId: "collide" });
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
    const plugin = LoadBalancer.clone({ url: lbUrl, serviceId: "relocated", namespace: "cluster" });
    App.use(plugin);
    await new Promise((r) =>
      App.startService({ route: "relocated", port: 5473 }).on("ready", r),
    );
    await plugin.installed;

    expect(App.getModule("HasClone").clone()).to.equal("my own clone method"); // intact
    expect(App.cluster).to.respondTo("delegate"); // tentacle moved aside
  });
});

// RFC 006 — members that host DIFFERENT module subsets attach under one serviceId, and the LB
// composes them into a single logical service. The client makes one loadService call and gets one
// service whose modules physically live in different places — with zero behavioral change: a plain
// service is unchanged, this only lights up when members deliberately attach under a serviceId.
describe("LoadBalancer.Tentacle — module-level attachment (RFC 006)", () => {
  it("attaches disjoint members into one logical service (union); each module is reached at its own location", async () => {
    // two SEPARATE physical services — different routes, different module subsets — one serviceId
    const core = createService();
    core.module("Cart", { total: () => ({ from: "core", total: 42 }) });
    await core.startService({ route: "orders-core", port: 5601 });

    const reprice = createService();
    reprice.module("Reprice", { run: () => ({ from: "reprice", ok: true }) });
    await reprice.startService({ route: "reprice-svc", port: 5602 });

    await LoadBalancer.Tentacle.register({
      url: "http://localhost:5601/orders-core",
      serviceId: "shop",
    });
    await LoadBalancer.Tentacle.register({
      url: "http://localhost:5602/reprice-svc",
      serviceId: "shop",
    });

    // ONE call, served at /shop, yields BOTH modules — the client never knows they're split
    const shop = await createClient().loadService(`http://localhost:${lbPort}/shop`);
    expect(shop.Cart).to.respondTo("total");
    expect(shop.Reprice).to.respondTo("run");
    expect(await shop.Cart.total()).to.deep.equal({ from: "core", total: 42 }); // hit :5601
    expect(await shop.Reprice.run()).to.deep.equal({ from: "reprice", ok: true }); // hit :5602
  });

  it("composed connData self-describes (serviceId + discovery + per-module locations); a plain service carries none", async () => {
    // /shop was composed in the previous test — read its raw connData
    const composed = await HttpClient.request({ url: `http://localhost:${lbPort}/shop` });
    expect(composed.serviceId).to.equal("shop");
    expect(composed.discovery).to.equal(true);
    const cart = composed.modules.find((m) => m.name === "Cart");
    const reprice = composed.modules.find((m) => m.name === "Reprice");
    expect(cart.connectionData.port).to.equal(5601); // Cart's own physical location
    expect(reprice.connectionData.port).to.equal(5602); // Reprice's own physical location

    // a plain, directly-loaded service has none of the discovery fields — backwards compatible
    const plain = createService();
    plain.module("Api", { ping: () => ({ ok: true }) });
    await plain.startService({ route: "plain-svc", port: 5603 });
    const direct = await HttpClient.request({ url: "http://localhost:5603/plain-svc" });
    expect(direct.serviceId).to.equal(undefined);
    expect(direct.discovery).to.equal(undefined);
    expect(direct.modules[0].connectionData).to.equal(undefined);
  });

  it("per-module failover: a cloned module survives one location dying, while a sibling module is never disturbed", async () => {
    muteLogs(); // a member is killed by design; the LB correctly warns on eviction
    const mkStock = (port) => {
      const s = createService();
      s.module("Stock", { level: () => ({ servedBy: port }) });
      return s;
    };
    const s1 = mkStock(5611);
    const s2 = mkStock(5612);
    await s1.startService({ route: "stock-1", port: 5611 });
    await s2.startService({ route: "stock-2", port: 5612 });
    const audit = createService();
    audit.module("Audit", { log: () => ({ servedBy: 5613 }) });
    await audit.startService({ route: "audit-1", port: 5613 });

    for (const [port, r] of [
      [5611, "stock-1"],
      [5612, "stock-2"],
      [5613, "audit-1"],
    ])
      await LoadBalancer.Tentacle.register({
        url: `http://localhost:${port}/${r}`,
        serviceId: "warehouse",
      });

    const wh = await createClient().loadService(`http://localhost:${lbPort}/warehouse`);
    expect(await wh.Audit.log()).to.deep.equal({ servedBy: 5613 });

    const first = await wh.Stock.level();
    const dead = first.servedBy; // whichever Stock clone served it
    await new Promise((res) => (dead === 5611 ? s1 : s2).close(res)); // that location dies

    const next = await wh.Stock.level(); // Stock transparently re-resolves to the surviving clone
    expect(next.servedBy).to.equal(dead === 5611 ? 5612 : 5611);
    expect(await wh.Audit.log()).to.deep.equal({ servedBy: 5613 }); // sibling untouched
  });

  it("partial overlap: a shared module balances across every member that hosts it, while a member-exclusive module stays pinned", async () => {
    // The "scale a hot module" shape: member 1 (the monolith) serves BOTH modules; member 2 is a
    // split-out copy of the HOT module only. Hosts are tracked per module, so `Search` (on both)
    // load-balances while `Admin` (on member 1 only) always routes there.
    const m1 = createService();
    m1.module("Search", { find: () => ({ ok: true }) });
    m1.module("Admin", { stats: () => ({ ok: true }) });
    await m1.startService({ route: "cat-full", port: 5621 });

    const m2 = createService();
    m2.module("Search", { find: () => ({ ok: true }) }); // ONLY Search — the extra copy
    await m2.startService({ route: "cat-search", port: 5622 });

    await LoadBalancer.Tentacle.register({
      url: "http://localhost:5621/cat-full",
      serviceId: "catalog",
    });
    await LoadBalancer.Tentacle.register({
      url: "http://localhost:5622/cat-search",
      serviceId: "catalog",
    });

    // two composes: the shared module cycles across its two hosts; the exclusive one never moves
    const searchPorts = new Set();
    const adminPorts = new Set();
    for (let i = 0; i < 2; i++) {
      const cd = await HttpClient.request({ url: `http://localhost:${lbPort}/catalog` });
      searchPorts.add(cd.modules.find((m) => m.name === "Search").connectionData.port);
      adminPorts.add(cd.modules.find((m) => m.name === "Admin").connectionData.port);
    }
    expect(searchPorts).to.include(5621).and.to.include(5622); // balanced across both members
    expect([...adminPorts]).to.deep.equal([5621]); // only ever from its single host
  });
});
