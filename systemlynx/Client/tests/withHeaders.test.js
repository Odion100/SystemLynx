const { expect } = require("chai");
const createService = require("../../Service/Service");
const createClient = require("../../Client/Client");

// RFC 011 — `setHeaders` is configuration and applies everywhere on a process-wide shared client,
// which makes per-request values (identity) ambient: last writer wins for everybody. Reported by
// buAPI after a stale identity made the wrong user root_admin of a new team.
//
// `withHeaders` returns a view carrying headers for calls made through it, mutating nothing.
describe("Client — withHeaders (RFC 011)", () => {
  const port = 5711;
  const route = "hdr-svc";
  const url = `http://localhost:${port}/${route}`;
  let service;

  beforeAll(async () => {
    service = createService();
    // echo whatever identity the request arrived with
    service.module("Teams", function () {
      this.who = function () {
        return { seen: this.req.headers["internal-identity"] || null };
      };
      this.add = function () {
        return { seen: this.req.headers["internal-identity"] || null };
      };
    });
    service.module("Users", function () {
      this.who = function () {
        return { seen: this.req.headers["internal-identity"] || null };
      };
    });
    await service.startService({ route, port });
  });

  afterAll(async () => {
    if (service) await new Promise((r) => service.close(r));
  });

  it("applies the headers to calls made through the view", async () => {
    const client = await createClient().loadService(url, { forceReload: true });
    const scoped = client.Teams.withHeaders({ "Internal-Identity": "alice" });
    expect(await scoped.who()).to.deep.equal({ seen: "alice" });
  });

  it("carries across MULTIPLE calls on the same view — it is a handle, not a one-shot", async () => {
    const client = await createClient().loadService(url, { forceReload: true });
    const asAlice = client.Teams.withHeaders({ "Internal-Identity": "alice" });

    expect(await asAlice.who()).to.deep.equal({ seen: "alice" });
    expect(await asAlice.add()).to.deep.equal({ seen: "alice" });
    expect(await asAlice.who()).to.deep.equal({ seen: "alice" });
  });

  it("never leaks onto the shared module — the next caller sees nothing", async () => {
    const client = await createClient().loadService(url, { forceReload: true });
    await client.Teams.withHeaders({ "Internal-Identity": "alice" }).who();

    // this is the bug: before RFC 011 the header set for one call stayed for every later one
    expect(await client.Teams.who()).to.deep.equal({ seen: null });
  });

  it("two views on the same module do not see each other", async () => {
    const client = await createClient().loadService(url, { forceReload: true });
    const alice = client.Teams.withHeaders({ "Internal-Identity": "alice" });
    const bob = client.Teams.withHeaders({ "Internal-Identity": "bob" });

    const [a, b, base] = await Promise.all([alice.who(), bob.who(), client.Teams.who()]);
    expect(a).to.deep.equal({ seen: "alice" });
    expect(b).to.deep.equal({ seen: "bob" });
    expect(base).to.deep.equal({ seen: null });
  });

  it("layers over setHeaders without destroying it", async () => {
    const client = await createClient().loadService(url, { forceReload: true });
    client.Teams.setHeaders({ "Internal-Identity": "service-token" });

    expect(await client.Teams.withHeaders({ "Internal-Identity": "alice" }).who()).to.deep.equal({
      seen: "alice",
    });
    // configuration is untouched by the view
    expect(await client.Teams.who()).to.deep.equal({ seen: "service-token" });
    client.Teams.setHeaders({ "Internal-Identity": undefined });
  });

  it("scopes every module when taken at the service level", async () => {
    const client = await createClient().loadService(url, { forceReload: true });
    const asAlice = client.withHeaders({ "Internal-Identity": "alice" });

    expect(await asAlice.Teams.who()).to.deep.equal({ seen: "alice" });
    expect(await asAlice.Users.who()).to.deep.equal({ seen: "alice" });
    expect(await client.Users.who()).to.deep.equal({ seen: null });
  });

  it("chains — a narrower view adds to the wider one", async () => {
    const client = await createClient().loadService(url, { forceReload: true });
    const scoped = client.Teams.withHeaders({ "Internal-Identity": "alice" }).withHeaders({
      "X-Trace": "t-1",
    });
    expect(await scoped.who()).to.deep.equal({ seen: "alice" });
  });
});
