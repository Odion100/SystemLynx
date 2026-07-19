import io from "socket.io-client";
import createDispatcher from "../../Dispatcher/Dispatcher.mjs";

const RESERVED = new Set(["connect", "disconnect", "error", "connect_error"]);

export default function SocketDispatcher(
  { namespace, socketPath: path },
  events = {},
  systemContext
) {
  const dispatcher =
    (this || {}).on && (this || {}).emit
      ? this
      : createDispatcher.apply(this, [events, systemContext]);

  const socket = io.connect(namespace, { path });
  const subscriptionCounts = new Map();

  const trackSubscribe = (name) => {
    const n = (subscriptionCounts.get(name) || 0) + 1;
    subscriptionCounts.set(name, n);
    if (n === 1) socket.emit("subscribe", name);
  };

  const trackUnsubscribe = (name) => {
    const n = (subscriptionCounts.get(name) || 0) - 1;
    if (n <= 0) {
      subscriptionCounts.delete(name);
      socket.emit("unsubscribe", name);
    } else {
      subscriptionCounts.set(name, n);
    }
  };

  const originalOn = dispatcher.on.bind(dispatcher);
  dispatcher.on = function (name, cb, options) {
    const unsub = originalOn(name, cb, options);
    if (!RESERVED.has(name)) {
      trackSubscribe(name);
      return function () {
        unsub();
        trackUnsubscribe(name);
      };
    }
    return unsub;
  };

  const originalOnce = dispatcher.once.bind(dispatcher);
  dispatcher.once = function (name, cb, options) {
    if (RESERVED.has(name)) return originalOnce(name, cb, options);
    let done = false;
    trackSubscribe(name);
    const unsub = originalOnce(
      name,
      function (...args) {
        if (!done) {
          done = true;
          trackUnsubscribe(name);
          cb(...args);
        }
      },
      options
    );
    return function () {
      if (!done) {
        done = true;
        unsub();
        trackUnsubscribe(name);
      }
    };
  };

  const originalClearEvent = dispatcher.$clearEvent.bind(dispatcher);
  dispatcher.$clearEvent = function (name) {
    originalClearEvent(name);
    if (subscriptionCounts.has(name)) {
      subscriptionCounts.delete(name);
      socket.emit("unsubscribe", name);
    }
  };

  const originalDestroy = dispatcher.destroy.bind(dispatcher);
  dispatcher.destroy = function () {
    subscriptionCounts.forEach((_, name) => socket.emit("unsubscribe", name));
    subscriptionCounts.clear();
    originalDestroy();
  };

  socket.onAny((name, payload) => {
    const event = { id: payload.id, name, data: payload.data, type: payload.type };
    dispatcher.emit(name, payload.data, event);
  });

  socket.on("disconnect", () => {
    socket.disconnect();
    dispatcher.emit("disconnect");
  });

  socket.on("connect", () => {
    subscriptionCounts.forEach((count, name) => {
      if (count > 0) socket.emit("subscribe", name);
    });
    dispatcher.emit("connect");
  });

  dispatcher.disconnect = () => socket.disconnect();
  return dispatcher;
}
