module.exports = function SystemLynxWebWebSocket() {
  const express = require("express");
  const SocketServer = require("http").Server(express());
  const WebSocket = require("socket.io")(SocketServer);

  return { WebSocket, SocketServer };
};
