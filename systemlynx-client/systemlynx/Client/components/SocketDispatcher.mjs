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

  // RFC 010 — re-application must REPLACE the connection, not stack another one. The old socket
  // was only ever reachable through `dispatcher.disconnect`, which the next application
  // overwrote; every reconnect then left a live socket nobody could close (BUApp measured 34,418).
  // State lives on the dispatcher so a re-application swaps the socket underneath the existing
  // wrappers instead of wrapping them again — the wrappers must never nest.
  const openSocket = (state) => {
    const socket = io.connect(namespace, { path });

    socket.onAny((name, payload) => {
      const event = { id: payload.id, name, data: payload.data, type: payload.type };
      dispatcher.emit(name, payload.data, event);
    });

    socket.on("disconnect", () => {
      socket.disconnect();
      dispatcher.emit("disconnect");
    });

    socket.on("connect", () => {
      state.subscriptionCounts.forEach((count, name) => {
        if (count > 0) socket.emit("subscribe", name);
      });
      dispatcher.emit("connect");
    });

    return socket;
  };

  const existing = dispatcher.__socketState;
  if (existing) {
    // Tear down before rebuilding: drop the old socket's handlers so it can't emit into this
    // dispatcher on its way out, then close it. Subscriptions carry over and are re-sent on
    // the new socket's `connect`.
    const previous = existing.socket;
    if (previous) {
      try {
        previous.removeAllListeners();
        previous.disconnect();
      } catch (e) {
        /* a socket that never connected still has to be let go */
      }
    }
    existing.socket = openSocket(existing);
    return dispatcher;
  }

  const state = { socket: null, subscriptionCounts: new Map() };
  Object.defineProperty(dispatcher, "__socketState", {
    value: state,
    writable: true,
    enumerable: false,
  });
  const subscriptionCounts = state.subscriptionCounts;
  const socketRef = () => state.socket;

  const trackSubscribe = (name) => {
    const n = (subscriptionCounts.get(name) || 0) + 1;
    subscriptionCounts.set(name, n);
    if (n === 1) socketRef().emit("subscribe", name);
  };

  const trackUnsubscribe = (name) => {
    const n = (subscriptionCounts.get(name) || 0) - 1;
    if (n <= 0) {
      subscriptionCounts.delete(name);
      socketRef().emit("unsubscribe", name);
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
      socketRef().emit("unsubscribe", name);
    }
  };

  const originalDestroy = dispatcher.destroy.bind(dispatcher);
  dispatcher.destroy = function () {
    subscriptionCounts.forEach((_, name) => socketRef().emit("unsubscribe", name));
    subscriptionCounts.clear();
    originalDestroy();
  };

  dispatcher.disconnect = () => socketRef() && socketRef().disconnect();
  state.socket = openSocket(state);
  return dispatcher;
}
