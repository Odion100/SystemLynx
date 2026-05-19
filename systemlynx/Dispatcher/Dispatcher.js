"use strict";
const throttle = require("../../utils/throttle");

module.exports = function createDispatcher(_, systemContext) {
  const events = new Map();
  const Dispatcher = this || {};

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

    const key = eventId || Symbol();
    if (!events.has(eventName)) events.set(eventName, new Map());
    const registry = events.get(eventName);
    if (registry.has(key)) registry.delete(key);

    let fn = typeof interval === "number" ? throttle(callback, limit, interval) : callback;
    if (systemContext) fn = fn.bind(systemContext);
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

    const key = eventId || Symbol();
    if (!events.has(eventName)) events.set(eventName, new Map());
    const registry = events.get(eventName);
    if (registry.has(key)) registry.delete(key);

    const throttled =
      typeof interval === "number" ? throttle(callback, limit, interval) : callback;

    const boundFn = function (...args) {
      registry.delete(key);
      if (registry.size === 0) events.delete(eventName);
      return throttled.apply(systemContext, args);
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
