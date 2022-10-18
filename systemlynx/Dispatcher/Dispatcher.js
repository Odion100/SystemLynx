"use strict";
module.exports = function SystemLynxDispatcher(events = {}, systemContext) {
  const Dispatcher = this || {};

  Dispatcher.emit = (eventName, data, event) => {
    if (events[eventName])
      events[eventName].forEach((callback) =>
        callback.apply(systemContext, [data, event])
      );
    return Dispatcher;
  };

  Dispatcher.on = (eventName, callback) => {
    if (typeof callback !== "function")
      throw Error(
        "[SystemLynx][EventHandler][Error]: EventHandler.on(eventName, callback) received invalid parameters"
      );
    if (!events[eventName]) events[eventName] = [];
    events[eventName].push(callback);
    return Dispatcher;
  };

  return Dispatcher;
};
