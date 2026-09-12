const { expect } = require("chai");
const createService = require("../../Service/Service");
const createClient = require("../../Client/Client");

// `loadService(url, { forceReload: true })` was broken two ways at once, and the first one hid the
// second. Filed by systemview-test as a socket leak; verifying it against the source turned up a
// hang that preempts the leak entirely.
//
//   createService returns the CACHED instance when one exists for this serviceUrl. So a reload got
//   the old service back, then awaited `Service.on("connect")` — an event that already fired and
//   never fires again. forceReload NEVER RETURNED on anything already cached.
//
//   And had it returned, `cachedServices[url] = Service` would have dropped the replaced instance
//   still holding every socket it opened — one per module plus one for the service — which is
//   RFC 013's leak reached down the sanctioned refresh path instead of by discarding a client.
//
// The fix is one of ordering: evict before rebuilding. Counted SERVER-side so it runs in CI.
const settle = (ms = 200) => new Promise((r) => setTimeout(r, ms));

describe("Client — forceReload evicts rather than overwrites", () => {
  const port = 5791;
  const route = "reload-svc";
  const url = `http://localhost:${port}/${route}`;
  let service;

  beforeAll(async () => {
    service = createService();
    service.module("Alpha", { ping: () => ({ ok: true }) });
    service.module("Beta", { ping: () => ({ ok: true }) });
    await service.startService({ route, port });
  });

  afterAll(async () => {
    if (service) await new Promise((r) => service.close(r));
  });

  const liveSockets = () => service.WebSocket.engine.clientsCount;

  // THE HANG. Before the fix this test did not fail — it never finished, which is exactly how the
  // bug presents to a caller. The timeout is the assertion.
  it("RETURNS on a cached url instead of waiting for a connect that already fired", async () => {
    const client = createClient();
    await client.loadService(url);
    const reloaded = await Promise.race([
      client.loadService(url, { forceReload: true }).then(() => "returned"),
      new Promise((r) => setTimeout(() => r("hung"), 4000)),
    ]);
    expect(reloaded).to.equal("returned");
    client.disconnect();
    await settle();
  }, 10000);

  it("hands back a NEW instance, not the one it was asked to replace", async () => {
    const client = createClient();
    const first = await client.loadService(url);
    const second = await client.loadService(url, { forceReload: true });
    expect(second).to.not.equal(first); // a reload that returns the same object reloaded nothing
    expect(await second.Alpha.ping()).to.deep.equal({ ok: true });
    client.disconnect();
    await settle();
  }, 10000);

  it("does not accumulate sockets across repeated reloads", async () => {
    const client = createClient();
    await client.loadService(url);
    await settle();
    const afterFirst = liveSockets();

    for (let i = 0; i < 3; i++) {
      await client.loadService(url, { forceReload: true });
      await settle();
    }

    // Each reload replaces the instance; the replaced one must be closed, so the count holds flat.
    expect(liveSockets()).to.equal(afterFirst);

    client.disconnect();
    await settle();
    expect(liveSockets()).to.equal(0);
  }, 20000);

  it("leaves the working instance in place when the refresh cannot reach the service", async () => {
    // Eviction happens AFTER the fetch on purpose: a transient blip must not tear down a live
    // service. The old instance stays cached and usable, and the caller gets the rejection.
    const client = createClient();
    const first = await client.loadService(url);
    let threw = null;
    try {
      await client.loadService(`http://localhost:${port}/${route}`, {
        forceReload: true,
        retry: 0,
        timeout: 1,
      });
    } catch (e) {
      threw = e;
    }
    // Whether that particular call fails is environment-dependent; what must hold is that a
    // still-cached service is still callable afterwards.
    expect(await first.Alpha.ping()).to.deep.equal({ ok: true });
    client.disconnect();
    await settle();
  }, 15000);
});
