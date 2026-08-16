const { expect } = require("chai");
const createService = require("../../Service/Service");
const createClient = require("../../Client/Client");

// RFC 010 — a long-lived client must not accumulate sockets.
//
// Reported by BUApp from production: 34,418 ESTABLISHED connections against a 16,384-port
// ephemeral range took the whole machine's port range down (ssh failed with EADDRNOTAVAIL).
// Every reconnect re-applied SocketDispatcher, which opens a socket unconditionally, while the
// only handle to the previous one (dispatcher.disconnect) was overwritten by the new application.
//
// The count is asserted SERVER-side (`WebSocket.engine.clientsCount`) rather than with lsof, so it
// runs anywhere CI does.
const settle = (ms = 150) => new Promise((r) => setTimeout(r, ms));

describe("Client — socket teardown on reconnect (RFC 010)", () => {
  const port = 5701;
  const route = "leak-svc";
  const url = `http://localhost:${port}/${route}`;
  let service;

  beforeAll(async () => {
    service = createService();
    // two modules, because the leak is per-module: one reconnect used to cost 1 + M sockets
    service.module("Alpha", { ping: () => ({ ok: true }) });
    service.module("Beta", { ping: () => ({ ok: true }) });
    await service.startService({ route, port });
  });

  afterAll(async () => {
    if (service) await new Promise((r) => service.close(r));
  });

  const liveSockets = () => service.WebSocket.engine.clientsCount;

  it("does not accumulate connections across repeated reconnects", async () => {
    const client = await createClient().loadService(url);
    const reconnect = () =>
      new Promise((resolve, reject) =>
        client.resetConnection((err) => (err ? reject(err) : resolve()))
      );

    // One reconnect first, so the baseline is a settled steady state rather than a load still
    // in progress — what matters is whether the count GROWS with reconnect count.
    await reconnect();
    await settle(600);
    const steady = liveSockets();

    for (let i = 0; i < 5; i++) {
      await reconnect();
      await settle(200);
    }
    await settle(600);

    // Before the fix each pass added (1 + modules): 5 more reconnects meant 15 more sockets.
    expect(liveSockets()).to.equal(steady);
  });

  it("still works after those reconnects — teardown must not sever the live connection", async () => {
    const client = await createClient().loadService(url, { forceReload: true });
    for (let i = 0; i < 3; i++) {
      await new Promise((resolve, reject) =>
        client.resetConnection((err) => (err ? reject(err) : resolve()))
      );
      await settle();
    }
    expect(await client.Alpha.ping()).to.deep.equal({ ok: true });
    expect(await client.Beta.ping()).to.deep.equal({ ok: true });
  });

  it("subscribes ONCE per listener after reconnects — the event wrapper must not nest", async () => {
    const client = await createClient().loadService(url, { forceReload: true });
    for (let i = 0; i < 4; i++) {
      await new Promise((resolve, reject) =>
        client.resetConnection((err) => (err ? reject(err) : resolve()))
      );
      await settle();
    }

    // Each re-application used to re-wrap `on` around the already-wrapped version, so one
    // registration fanned out into one `subscribe` per layer — growing with the reconnect count.
    // Counted on the live socket the dispatcher actually holds, so it doesn't depend on which
    // namespace the server filed the connection under.
    const state = client.__socketState;
    let subscribes = 0;
    const realEmit = state.socket.emit.bind(state.socket);
    state.socket.emit = (...args) => {
      if (args[0] === "subscribe") subscribes++;
      return realEmit(...args);
    };

    client.on("some-event", () => {});
    await settle();

    expect(subscribes).to.equal(1);
  });
});
