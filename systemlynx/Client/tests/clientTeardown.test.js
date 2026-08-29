const { expect } = require("chai");
const createService = require("../../Service/Service");
const createClient = require("../../Client/Client");

// RFC 013 — a discarded client must be closable.
//
// Reported by systemview-test from the SystemView hub: a warm loop built a client every 20s on a
// failing proof and threw it away. Each loadService opens one socket PER MODULE plus one for the
// service, so every discard leaked 7 sockets against a 6-module service — ~10,000 ESTABLISHED in
// 8 hours. Not RFC 010: that was re-application onto a live service; this is repeated construction.
//
// Counted SERVER-side so it runs anywhere CI does.
const settle = (ms = 200) => new Promise((r) => setTimeout(r, ms));

describe("Client — teardown of a discarded client (RFC 013)", () => {
  const port = 5721;
  const route = "teardown-svc";
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

  it("closes the service socket and every module socket", async () => {
    const client = createClient();
    await client.loadService(url);
    await settle();
    // NOTE: socket.io-client multiplexes namespaces over one engine connection per host, so the
    // server sees 1 here even though the service and both modules each hold a namespace socket.
    // What this test locks is that teardown reaches ALL of them — the count must return to zero.
    expect(liveSockets()).to.be.greaterThan(0);

    expect(client.unloadService(url)).to.equal(true);
    await settle();
    expect(liveSockets()).to.equal(0);
  });

  it("does NOT reconnect on the way out", async () => {
    // The trap this API exists for: Service.on("disconnect", Service.resetConnection) means a naive
    // disconnect() rebuilds every socket it just closed. Teardown has to be terminal.
    const client = createClient();
    await client.loadService(url);
    await settle();
    client.unloadService(url);
    await settle(600); // well past any reconnect attempt
    expect(liveSockets()).to.equal(0);
  });

  it("does not accumulate across repeated load/discard cycles", async () => {
    for (let i = 0; i < 5; i++) {
      const client = createClient(); // a NEW client each time — the hub's exact shape
      await client.loadService(url);
      client.unloadService(url);
      await settle(80);
    }
    await settle();
    expect(liveSockets()).to.equal(0);
  });

  it("drops the cache entry, and is idempotent", async () => {
    const client = createClient();
    await client.loadService(url);
    expect(client.cachedServices[url]).to.be.an("object");

    expect(client.unloadService(url)).to.equal(true);
    expect(client.cachedServices[url]).to.equal(undefined);
    // safe to call on a failed proof without knowing whether the load got far enough to cache
    expect(client.unloadService(url)).to.equal(false);
    expect(client.unloadService("http://localhost:1/never-loaded")).to.equal(false);
    await settle();
  });

  it("Client.disconnect() closes everything the client loaded", async () => {
    const client = createClient();
    await client.loadService(url);
    await settle();
    expect(liveSockets()).to.be.greaterThan(0);

    expect(client.disconnect()).to.equal(1);
    await settle();
    expect(liveSockets()).to.equal(0);
    expect(client.disconnect()).to.equal(0);
  });
});
