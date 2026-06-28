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
    socket.to(name).emit(name, { id, data, type });
    //emit the same event locally
    Emitter.$emit(name, data);
  };
  return Emitter;
};
