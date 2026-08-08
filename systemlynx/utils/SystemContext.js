"use strict";
// RFC 007: `useModule`/`useService` are regular functions (not arrows) so `this` is the CALLER —
// the module invoking them. That lets us (a) emit a caller→callee coupling edge for observability,
// and (b) hand `useService` back a caller-bound view so an outbound RPC made through it can reach
// the originating context (the RFC-005 before hook reads `this.__caller`). If there's no caller
// (a detached call — `this === undefined` under strict mode), everything degrades to today's
// behavior: the shared module/client, no binding, no emit.
module.exports = function SystemContext(system) {
  const context = this || {};

  // A caller is a live module context — it carries the SystemContext methods. (Strict mode makes a
  // detached call `this === undefined`, so this can't latch onto the global object.)
  const callerOf = (self) =>
    self && typeof self.useService === "function" ? self : null;

  // Local-only coupling signal, emitted on the caller module so a co-loaded observer (SystemView)
  // can build the who-calls-whom graph. Guarded — no-op if the caller can't emit.
  const emitCoupling = (caller, kind, to) => {
    if (caller && typeof caller.$emit === "function")
      caller.$emit(kind, {
        // RFC 008: `__name` is stamped at addModule, so `from` is reliable at boot too — not just
        // during a request (the old `req.module_name`, kept as a fallback).
        from: caller.__name || (caller.req && caller.req.module_name) || undefined,
        to,
      });
  };

  context.useModule = function (modName) {
    const caller = callerOf(this);
    emitCoupling(caller, "use_module", modName);
    const mod = (system.modules.find((m) => m.name === modName) || {}).module || {};
    if (!caller) return mod; // no caller context — return the shared module unchanged

    // RFC 008: caller-bound view so a subsequent `.on`/`.once` can attribute WHO subscribed (via
    // `this.__caller`). A Proxy — NOT Object.create — with a get trap for `__caller` and NO set
    // trap, so writes pass THROUGH to the live module. `useModule("B")` returns the real singleton:
    // a method that reassigns a primitive on `this` (`this.count++`, a flag, a cached handle) must
    // mutate B itself. A copy would swallow those writes onto a per-call throwaway. The
    // subscription happens synchronously right after this resolve (no await), so `this.__caller` is
    // reliable without ALS.
    return new Proxy(mod, {
      get(target, prop, receiver) {
        return prop === "__caller" ? caller : Reflect.get(target, prop, receiver);
      },
    });
  };

  context.useService = function (serviceName) {
    const caller = callerOf(this);
    emitCoupling(caller, "use_service", serviceName);
    const client =
      (system.services.find((s) => s.name === serviceName) || {}).client || {};
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
