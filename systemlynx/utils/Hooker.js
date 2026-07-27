"use strict";
// A composable, context-agnostic MIDDLEWARE capability — same family as HeaderSetter / Dispatcher.
// `Hooker.apply(obj)` composes it onto an object: the object becomes a hooker that handles
// before/after middleware, namespace-keyed, in its own `__middleware` store. Pure composition — not
// owned by the client or the server; both compose it and supply their own run context. The essence
// is context-free: register middleware under a namespace, gather what applies to a (module, method)
// call by specificity, run it as a chain.
//
// namespace: "$all", a module ("Orders"), or a module.method ("Orders.reprice"); a module-level
// store also accepts a bare method name. No string target ⇒ "$all".

function Hooker() {
  const before = {}; // namespace -> [middleware]
  const after = {};

  // register() pulls the namespace target, then recursiveRegister() folds each middleware in —
  // recursing through (nested) arrays down to individual functions.
  const recursiveRegister = (bag, target, mw) => {
    if (Array.isArray(mw)) return mw.map((m) => recursiveRegister(bag, target, m));
    (bag[target] || (bag[target] = [])).push(mw);
  };
  // The first arg names the target(s): a string, or an ARRAY of strings to hook many at once — each
  // interpreted at THIS store's level (namespaces for a namespaced store; bare methods for a
  // module's scoped store, since you're already under its namespace). No string/string[] ⇒ "$all".
  // The rest are middleware (recursively flattened), registered under every target.
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

  // non-enumerable so composing this capability doesn't alter the object's public shape
  Object.defineProperties(this, {
    before: { value: register(before) },
    after: { value: register(after) },
    __middleware: { value: { before, after } },
  });
  return this;
}

// The middleware that applies to a (module, method) call, concatenated by specificity (broad →
// specific) like the server. Two kinds of stores, by how they're addressed — nothing client- or
// server-specific:
//   • `namespaced` — addressed by full namespace: "$all" → "Module" → "Module.method".
//   • `scoped`     — already bound to one module, so addressed by "$all" → bare method name.
// Pass ordered arrays of each; they run in order (outermost first).
Hooker.gather = (kind, { namespaced = [], scoped = [] } = {}, moduleName, methodName) => {
  const collect = (stores, targets) =>
    stores.flatMap((store) => (store ? targets.flatMap((t) => store[kind][t] || []) : []));
  return [
    ...collect(namespaced, ["$all", moduleName, `${moduleName}.${methodName}`]),
    ...collect(scoped, ["$all", methodName]),
  ];
};

// Run a gathered chain in ANY context: each middleware is called `mw.call(context, ...args, next)`,
// so the client runs (payload, next) and the server runs (req, res, next) off the same code. Each
// calls next() (optionally async) to proceed; a throw or next(err) rejects the chain.
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

module.exports = Hooker;
