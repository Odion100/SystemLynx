const { expect } = require("chai");
const createService = require("../../Service/Service");
const createClient = require("../../Client/Client");
const settle = (ms = 150) => new Promise((r) => setTimeout(r, ms));

describe("Router — the error event carries enough to interpret its arguments", () => {
  const port = 5761;
  let service, seen = null;
  beforeAll(async () => {
    service = createService();
    const Mod = service.module("Boom", {
      go: () => {
        throw { status: 500, message: "nope" };
      },
    });
    Mod.on("error", (payload) => (seen = payload));
    await service.startService({ route: "err", port });
    await settle();
  });
  afterAll(async () => { if (service) await new Promise((r) => service.close(r)); });

  it("includes the request path, so an observer can tell an upload route from a plain one", async () => {
    const svc = await createClient().loadService(`http://localhost:${port}/err`);
    try { await svc.Boom.go({ a: 1 }); } catch (e) {}
    await settle();
    expect(seen).to.be.an("object");
    expect(seen.path).to.equal("/err/Boom/go"); // not /sf/ or /mf/ — a plain route
    expect(seen.arguments).to.deep.equal([{ a: 1 }]);
  });
});
