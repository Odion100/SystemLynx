const { expect } = require("chai");
const createService = require("../../Service/Service");
const createClient = require("../../Client/Client");

// This test exists for a security coupling, not for uploads.
//
// `extractFilesFromArguments` checks `file`/`files` on each TOP-LEVEL argument and does not recurse.
// MCPServer's guard — which refuses a remote MCP caller's `file` argument, because that value would
// be resolved against the SERVER's filesystem — is written to exactly that depth.
//
// So if someone makes extraction recurse (to support uploads on nested objects, say), THIS test
// fails, and the failure is the notice that `MCPServer.dispatch` must recurse in the same change.
// Without it, a nested `{ a: { file: "/etc/passwd" } }` becomes an unauthenticated file read.
//
// Found by systemview-test, probing the fix for the bypass it implied.
const settle = (ms = 150) => new Promise((r) => setTimeout(r, ms));

describe("Client — file extraction depth (security coupling with MCPServer)", () => {
  const port = 5781;
  let service;
  let seen = null;

  beforeAll(async () => {
    service = createService();
    service.module("Depth", {
      take: function (arg) {
        seen = { path: this.req.path, arg };
        return { ok: true };
      },
    });
    await service.startService({ route: "depth", port });
    await settle();
  });

  afterAll(async () => {
    if (service) await new Promise((r) => service.close(r));
  });

  it("does NOT extract a nested file key — the client stays one level deep", async () => {
    const svc = await createClient().loadService(`http://localhost:${port}/depth`);
    await svc.Depth.take({ outer: { file: "/tmp/not-a-real-upload" } });
    await settle();

    // A plain route, not /sf/ — nothing was treated as an upload.
    expect(seen.path).to.equal("/depth/Depth/take");
    // And the value arrived untouched: no "__file__" placeholder, no multer object.
    expect(seen.arg.outer.file).to.equal("/tmp/not-a-real-upload");
  });

  it("DOES extract a top-level file key — the depth the guard is written for", async () => {
    const svc = await createClient().loadService(`http://localhost:${port}/depth`);
    let threw = null;
    try {
      // A top-level `file` IS extracted, which is why MCPServer refuses one from a remote caller.
      await svc.Depth.take({ file: "/tmp/definitely-not-here-either" });
    } catch (e) {
      threw = e;
    }
    // It tried to resolve the path into a stream — proving extraction happened at this depth.
    expect(threw).to.not.equal(null);
  });
});
