"use strict";
// RFC 007: `useModule`/`useService` are regular functions (not arrows) so `this` is the CALLER —
// the module invoking them. That lets us (a) emit a caller→callee coupling edge for observability,
// and (b) hand `useService` back a caller-bound view so an outbound RPC made through it can reach
// the originating context (the RFC-005 before hook reads `this.__caller`). If there's no caller
// (a detached call — `this === undefined` under strict mode), everything degrades to today's
// behavior: the shared module/client, no binding, no emit.
module.exports = function SystemObject(system) {
  const context = this || {};

  // A caller is a live module context — it carries the SystemContext methods. (Strict mode makes a
  // detached call `this === undefined`, so this can't latch onto the global object.)
  const callerOf = (self) =>
    self && typeof self.useService === "function" ? self : null;

  // Local-only coupling signal, emitted on the caller module so a co-loaded observer (SystemView)
  // can build the who-calls-whom graph. Guarded — no-op if the caller can't emit.
  const emitCoupling = (caller, kind, to) => {
    if (caller && typeof caller.$emit === "function")
      caller.$emit(kind, { from: (caller.req && caller.req.module_name) || undefined, to });
  };

  context.useModule = function (modName) {
    emitCoupling(callerOf(this), "use_module", modName);
    // in-process call — no transport/trace to carry, so return the shared module as-is
    return (system.modules.find((mod) => mod.name === modName) || {}).module || {};
  };

  context.useService = function (serviceName) {
    const caller = callerOf(this);
    emitCoupling(caller, "use_service", serviceName);
    const client = (system.services.find((s) => s.name === serviceName) || {}).client || {};
    if (!caller) return client; // no caller context — return the shared client unchanged

    // Caller-bound view: accessing a module comes back as a lightweight copy (Object.create) that
    // carries `__caller`, so an RFC-005 before hook on the outbound call can reach the originating
    // context. Non-module props pass straight through, so the service's shape/behavior is unchanged.
    return new Proxy(client, {
      get(target, prop, receiver) {
        const val = Reflect.get(target, prop, receiver);
        if (val && val.__isClientModule) {
          const bound = Object.create(val);
          bound.__caller = caller;
          return bound;
        }
        return val;
      },
    });
  };

  context.useConfig = () => system.configurations.module || {};
  return context;
};
