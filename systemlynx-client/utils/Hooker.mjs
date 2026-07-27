"use strict";
// A composable, context-agnostic MIDDLEWARE capability — same family as HeaderSetter / Dispatcher.
// `Hooker.apply(obj)` composes it onto an object: the object becomes a hooker that handles
// before/after middleware, namespace-keyed, in its own `__middleware` store. Pure composition — not
// owned by the client or the server; both compose it and supply their own run context.
//
// namespace: "$all", a module ("Orders"), or a module.method ("Orders.reprice"); a module-level
// store also accepts a bare method name. No string/string[] target ⇒ "$all".

function Hooker() {
  const before = {}; // namespace -> [middleware]
  const after = {};

  const recursiveRegister = (bag, target, mw) => {
    if (Array.isArray(mw)) return mw.map((m) => recursiveRegister(bag, target, m));
    (bag[target] || (bag[target] = [])).push(mw);
  };
  // first arg: a string, or an ARRAY of strings to hook many targets at once; else "$all". The rest
  // are middleware (recursively flattened), registered under every target.
  const register = (bag) => (...args) => {
    const targets =
      typeof args[0] === "string"
        ? [args.shift()]
        : Array.isArray(args[0]) && args[0].every((t) => typeof t === "string")
        ? args.shift()
        : ["$all"];
    targets.forEach((target) => args.forEach((mw) => recursiveRegister(bag, target, mw)));
    return this;
  };

  Object.defineProperties(this, {
    before: { value: register(before) },
    after: { value: register(after) },
    __middleware: { value: { before, after } },
  });
  return this;
}

// Applicable middleware for a call, concatenated by specificity: namespaced stores match
// $all → Module → Module.method; scoped (module) stores match $all → method. Outermost-first.
Hooker.gather = (kind, { namespaced = [], scoped = [] } = {}, moduleName, methodName) => {
  const collect = (stores, targets) =>
    stores.flatMap((store) => (store ? targets.flatMap((t) => store[kind][t] || []) : []));
  return [
    ...collect(namespaced, ["$all", moduleName, `${moduleName}.${methodName}`]),
    ...collect(scoped, ["$all", methodName]),
  ];
};

// Run a gathered chain in ANY context: `mw.call(context, ...args, next)`. Each calls next()
// (optionally async) to proceed; a throw or next(err) rejects the chain.
Hooker.runChain = (middleware, context, args = []) =>
  new Promise((resolve, reject) => {
    let i = 0;
    const next = (err) => {
      if (err) return reject(err);
      if (i >= middleware.length) return resolve();
      const mw = middleware[i++];
      try {
        mw.call(context, ...args, next);
      } catch (e) {
        reject(e);
      }
    };
    next();
  });

export default Hooker;
