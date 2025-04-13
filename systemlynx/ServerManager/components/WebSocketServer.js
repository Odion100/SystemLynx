module.exports = function createWebSocket(path) {
  const express = require("express");
  const SocketServer = require("http").Server(express());
  const WebSocket = require("socket.io")(SocketServer, {
    path,
    cors: {
      origin: "*", // Or your specific origin
      methods: ["GET", "POST"],
    },
  });

  return { WebSocket, SocketServer };
};
