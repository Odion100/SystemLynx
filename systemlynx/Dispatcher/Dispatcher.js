"use strict";
module.exports = function SystemLynxDispatcher(events = {}) {
  const Dispatcher = this || {};

  Dispatcher.emit = (eventName, data, event) => {
    if (events[eventName]) events[eventName].forEach((callback) => callback(data, event));
    return Dispatcher;
  };

  Dispatcher.on = (eventName, callback) => {
    if (typeof callback !== "function")
      throw Error(
        "SystemLynxDispatcher Error: object.on(eventName, callback) invalid parameters"
      );
    if (!events[eventName]) events[eventName] = [];
    events[eventName].push(callback);
    return Dispatcher;
  };

  return Dispatcher;
};
