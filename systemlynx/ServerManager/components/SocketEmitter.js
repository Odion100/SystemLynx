"use strict";
const SystemLynxDispatcher = require("../../Dispatcher/Dispatcher");
const shortid = require("shortid");
module.exports = function SocketEmitter(namespace, WebSocket) {
  const Emitter =
    (this || {}).on && (this || {}).emit ? this : SystemLynxDispatcher.apply(this);

  const socket = WebSocket.of(`/${namespace}`);
  const emit = Emitter.emit;

  Emitter.emit = (name, data) => {
    const id = shortid();
    const type = "WebSocket";
    socket.emit("dispatch", { id, name, data, type });
    //emit the same event locally
    emit(name, data);
  };
  return Emitter;
};
