const { expect } = require("chai");
const SystemContext = require("./SystemContext");
const createDispatcher = require("../Dispatcher/Dispatcher");

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

  it("useModule returns a caller-bound view carrying __caller, and emits a coupling edge", () => {
    const { system, module } = makeSystem();
    const ctx = SystemContext(system);
    const emitted = [];
    const caller = {
      __name: "A", // RFC 008: name stamped at boot — `from` is reliable without a request
      useService: ctx.useService,
      useModule: ctx.useModule,
      $emit: (k, d) => emitted.push([k, d]),
    };
    const mod = ctx.useModule.call(caller, "M");
    expect(mod).to.not.equal(module); // caller-bound copy, not the shared module
    expect(Object.getPrototypeOf(mod)).to.equal(module); // inherits the full surface
    expect(mod.greet()).to.equal("hi");
    expect(mod.__caller).to.equal(caller); // subscriber rides on the copy (event-edge bridge)
    expect(emitted).to.deep.include(["use_module", { from: "A", to: "M" }]);
  });

  it("useModule degrades to the shared module when there is no caller", () => {
    const { system, module } = makeSystem();
    const ctx = SystemContext(system);
    const raw = ctx.useModule.call(undefined, "M"); // detached call — this === undefined
    expect(raw).to.equal(module); // exact shared module, no copy, no binding
  });
});

describe("Event edges (RFC 008) — subscribing to a module's event via useModule", () => {
  // B is a real module (a Dispatcher) that owns events; stamp its name the way addModule does.
  const makeSystem = () => {
    const B = new createDispatcher();
    Object.defineProperty(B, "__name", { value: "B", configurable: true });
    const system = { modules: [{ name: "B", module: B }], services: [], configurations: {} };
    return { system, B };
  };

  it("surfaces {from, to, event} and still wires the subscription", () => {
    const { system, B } = makeSystem();
    const ctx = SystemContext(system);
    const emitted = [];
    const A = {
      __name: "A",
      useService: ctx.useService,
      useModule: ctx.useModule,
      $emit: (k, d) => emitted.push([k, d]),
    };

    // Exactly how a module wires up in its constructor: this.useModule("B").on("ping", handler)
    let heard = 0;
    ctx.useModule.call(A, "B").on("ping", () => heard++);

    expect(emitted).to.deep.include(["use_module", { from: "A", to: "B" }]); // call edge
    expect(emitted).to.deep.include([
      "event_subscription",
      { from: "A", to: "B", event: "ping" },
    ]); // event edge

    B.emit("ping"); // the bound view didn't break the actual subscription
    expect(heard).to.equal(1);
  });

  it("attributes .once the same way", () => {
    const { system } = makeSystem();
    const ctx = SystemContext(system);
    const emitted = [];
    const A = {
      __name: "A",
      useService: ctx.useService,
      useModule: ctx.useModule,
      $emit: (k, d) => emitted.push([k, d]),
    };
    ctx.useModule.call(A, "B").once("boot", () => {});
    expect(emitted).to.deep.include([
      "event_subscription",
      { from: "A", to: "B", event: "boot" },
    ]);
  });

  it("emits no signal when a module subscribes directly (no caller-bound view)", () => {
    const { B } = makeSystem();
    const emitted = [];
    B.$emit = (k, d) => emitted.push([k, d]);
    B.on("tick", () => {}); // this === B, no __caller
    expect(emitted).to.deep.equal([]); // no attribution — today's behavior
  });
});
