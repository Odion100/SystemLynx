"use strict";
const throttle = require("../../utils/throttle");

module.exports = function createDispatcher(_, systemContext) {
  const events = new Map();
  const Dispatcher = this || {};

  // RFC 008: when `.on`/`.once` is called through a caller-bound `useModule` view, the subscriber is
  // on `this.__caller` and the emitter (the module that owns the event) is `this` itself. Surface the
  // local-only event edge so a co-loaded observer (SystemView) can map who-listens-to-whose-events.
  // `$emit`, never `.emit` — stays in-process, never socket-broadcast. Guarded no-op otherwise.
  const emitEventEdge = (self, eventName) => {
    const caller = self && self.__caller;
    if (caller && typeof caller.$emit === "function")
      caller.$emit("event_subscription", {
        from: caller.__name,
        to: (self && self.__name) || undefined,
        event: eventName,
      });
  };

  Dispatcher.emit = function (eventName, data, event) {
    const registry = events.get(eventName);
    if (!registry) return Dispatcher;
    for (const listener of registry.values()) {
      listener(data, event);
    }
    return Dispatcher;
  };

  Dispatcher.on = function (eventName, callback, { limit, interval, eventId } = {}) {
    if (typeof callback !== "function") return Dispatcher;
    emitEventEdge(this, eventName);

    const key = eventId || Symbol();
    if (!events.has(eventName)) events.set(eventName, new Map());
    const registry = events.get(eventName);
    if (registry.has(key)) registry.delete(key);

    let fn = typeof interval === "number" ? throttle(callback, limit, interval) : callback;
    // RFC 007: bind the handler to the module (so `this` is the module — consistent with methods
    // and middleware) when this dispatcher IS a module; fall back to systemContext otherwise (e.g.
    // the App dispatcher, which relies on systemContext for useModule/useService).
    const bindTarget =
      Dispatcher && typeof Dispatcher.useService === "function" ? Dispatcher : systemContext;
    if (bindTarget) fn = fn.bind(bindTarget);
    registry.set(key, fn);

    return function () {
      const currentRegistry = events.get(eventName);
      if (!currentRegistry) return;
      currentRegistry.delete(key);
      if (currentRegistry.size === 0) events.delete(eventName);
    };
  };

  Dispatcher.once = function (eventName, callback, { limit, interval, eventId } = {}) {
    if (typeof callback !== "function") return function () {};
    emitEventEdge(this, eventName);

    const key = eventId || Symbol();
    if (!events.has(eventName)) events.set(eventName, new Map());
    const registry = events.get(eventName);
    if (registry.has(key)) registry.delete(key);

    const throttled =
      typeof interval === "number" ? throttle(callback, limit, interval) : callback;
    // RFC 007: same rule as `.on` — `this` is the module when this dispatcher is one.
    const bindTarget =
      Dispatcher && typeof Dispatcher.useService === "function" ? Dispatcher : systemContext;

    const boundFn = function (...args) {
      registry.delete(key);
      if (registry.size === 0) events.delete(eventName);
      return throttled.apply(bindTarget, args);
    };

    registry.set(key, boundFn);

    return function () {
      const currentRegistry = events.get(eventName);
      if (!currentRegistry) return;
      currentRegistry.delete(key);
      if (currentRegistry.size === 0) events.delete(eventName);
    };
  };

  Dispatcher.$clearEvent = function (eventName, fn) {
    if (!events.get(eventName)) return Dispatcher;

    if (!fn) {
      events.delete(eventName);
    } else if (typeof fn === "function") {
      const registry = events.get(eventName);
      for (const [key, listener] of registry.entries()) {
        if (listener.name === fn.name) {
          registry.delete(key);
          break;
        }
      }
      if (registry.size === 0) events.delete(eventName);
    } else {
      console.error(
        "SystemLynxError: the second parameter of the Dispatcher.$clearEvent takes the original function to the event"
      );
    }

    return Dispatcher;
  };

  Dispatcher.destroy = function () {
    events.clear();
    return Dispatcher;
  };

  return Dispatcher;
};
