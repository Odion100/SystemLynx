const { expect } = require("chai");
const SystemContext = require("./SystemContext");

describe("SystemContext — useService/useModule (RFC 007)", () => {
  const makeSystem = () => {
    const bMod = { ping: () => "pong" };
    Object.defineProperty(bMod, "__isClientModule", { value: true });
    const client = { Mod: bMod, emit: () => {} };
    const module = { name: "M", greet: () => "hi" };
    const system = {
      modules: [{ name: "M", module }],
      services: [{ name: "B", client }],
      configurations: {},
    };
    return { system, client, module, bMod };
  };

  it("useService returns a caller-bound view whose modules carry __caller", () => {
    const { system, client, bMod } = makeSystem();
    const ctx = SystemContext(system);
    const emitted = [];
    const caller = {
      useService: ctx.useService,
      $emit: (k, d) => emitted.push([k, d]),
      req: { module_name: "A" },
    };

    const view = ctx.useService.call(caller, "B");
    expect(view.Mod).to.not.equal(bMod); // a per-call copy, not the shared module
    expect(view.Mod.ping()).to.equal("pong"); // inherits the module's full surface
    expect(view.Mod.__caller).to.equal(caller); // the caller rides on the copy (the trace bridge)
    expect(view.emit).to.equal(client.emit); // non-module props pass straight through
    expect(emitted).to.deep.include(["use_service", { from: "A", to: "B" }]); // coupling edge
  });

  it("useService degrades to the shared client when there is no caller", () => {
    const { system, client } = makeSystem();
    const ctx = SystemContext(system);
    const raw = ctx.useService.call(undefined, "B"); // detached call — this === undefined
    expect(raw).to.equal(client); // exact shared client, no proxy, no binding
  });

  it("useModule returns the shared module and emits a coupling edge", () => {
    const { system, module } = makeSystem();
    const ctx = SystemContext(system);
    const emitted = [];
    const caller = {
      useService: ctx.useService,
      useModule: ctx.useModule,
      $emit: (k, d) => emitted.push([k, d]),
      req: { module_name: "A" },
    };
    const mod = ctx.useModule.call(caller, "M");
    expect(mod).to.equal(module); // in-process — shared module, no copy
    expect(emitted).to.deep.include(["use_module", { from: "A", to: "M" }]);
  });
});
