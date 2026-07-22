"use strict";
const createDispatcher = require("../../Dispatcher/Dispatcher");
const shortid = require("shortid");
module.exports = function SocketEmitter(namespace, WebSocket) {
  const Emitter =
    (this || {}).on && (this || {}).emit ? this : createDispatcher.apply(this);

  const socket = WebSocket.of(`/${namespace}`);

  socket.on("connection", (clientSocket) => {
    clientSocket.on("subscribe", (name) => clientSocket.join(name));
    clientSocket.on("unsubscribe", (name) => clientSocket.leave(name));
  });

  //use $emit to emit events locally only
  Emitter.$emit = Emitter.emit;

  Emitter.emit = (name, data) => {
    const id = shortid();
    const type = "WebSocket";
    try {
      socket.to(name).emit(name, { id, data, type });
    } catch (err) {
      // A bad payload (e.g. a circular reference) makes socket.io's synchronous encode throw —
      // uncaught, that kills the whole process. Contain it, but do NOT hide it: log a one-liner so
      // it's visible by default (a local "error" event alone is invisible when nothing is
      // subscribed — silent-swallow is worse than the crash), notify any programmatic observer,
      // and drop this one message. Sanitizing app payloads is intentionally NOT our job; not
      // crashing — and not silently losing the failure — is.
      console.error(
        `[SystemLynx][emit]: dropped un-encodable "${name}" event — ${err.message}`,
      );
      Emitter.$emit("error", { event: name, message: err.message, error: err });
    }
    //emit the same event locally — local listeners work regardless of the wire-encode outcome
    Emitter.$emit(name, data);
  };
  return Emitter;
};
