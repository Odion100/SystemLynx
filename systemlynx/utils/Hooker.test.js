const { expect } = require("chai");
const Hooker = require("./Hooker");

describe("Hooker (composable middleware)", () => {
  const make = () => Hooker.apply({});

  it("composes before/after + a namespace-keyed __middleware store onto an object", () => {
    const o = make();
    expect(o).to.respondTo("before");
    expect(o).to.respondTo("after");
    expect(o.__middleware).to.have.all.keys("before", "after");
  });

  // --- configuration: what actually gets built in the store ---

  it("registers middleware under a single string namespace", () => {
    const o = make();
    const fn = () => {};
    o.before("Orders", fn);
    expect(o.__middleware.before.Orders).to.deep.equal([fn]);
  });

  it("defaults to $all when no string target is given", () => {
    const o = make();
    const fn = () => {};
    o.before(fn);
    expect(o.__middleware.before.$all).to.deep.equal([fn]);
  });

  it("registers under EVERY target when given an ARRAY of namespaces", () => {
    const o = make();
    const fn = () => {};
    o.before(["Orders", "Users"], fn);
    expect(o.__middleware.before.Orders).to.deep.equal([fn]);
    expect(o.__middleware.before.Users).to.deep.equal([fn]);
  });

  it("recursively flattens (nested) arrays of middleware under each target", () => {
    const o = make();
    const a = () => {};
    const b = () => {};
    const c = () => {};
    o.before(["m"], a, [b, [c]]);
    expect(o.__middleware.before.m).to.deep.equal([a, b, c]);
  });

  // --- mechanics: gather + runChain ---

  it("gather concatenates by specificity: namespaced ($all→Module→Module.method), then scoped ($all→method)", () => {
    const ns = make();
    const mod = make();
    const A = () => {};
    const B = () => {};
    const C = () => {};
    const D = () => {};
    const E = () => {};
    ns.before("$all", A);
    ns.before("Orders", B);
    ns.before("Orders.reprice", C);
    mod.before("$all", D);
    mod.before("reprice", E);

    const gathered = Hooker.gather(
      "before",
      { namespaced: [ns.__middleware], scoped: [mod.__middleware] },
      "Orders",
      "reprice"
    );
    expect(gathered).to.deep.equal([A, B, C, D, E]);
  });

  it("runChain runs middleware with the given context and spread args, in order", async () => {
    const seen = [];
    const ctx = { tag: "ctx" };
    const mw1 = function (a, b, next) {
      seen.push([this.tag, a, b, "1"]);
      next();
    };
    const mw2 = function (a, b, next) {
      seen.push([this.tag, a, b, "2"]);
      next();
    };
    await Hooker.runChain([mw1, mw2], ctx, ["x", "y"]);
    expect(seen).to.deep.equal([
      ["ctx", "x", "y", "1"],
      ["ctx", "x", "y", "2"],
    ]);
  });

  it("runChain rejects when a middleware throws", async () => {
    let err;
    try {
      await Hooker.runChain(
        [
          () => {
            throw new Error("boom");
          },
        ],
        {},
        []
      );
    } catch (e) {
      err = e;
    }
    expect(err).to.have.property("message", "boom");
  });
});
