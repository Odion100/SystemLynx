module.exports = function createWebSocket(server) {
  const express = require("express");
  const SocketServer = require("http").Server(server || express());
  const WebSocket = require("socket.io")(SocketServer);

  return { WebSocket, SocketServer };
};
