import express from "express";
import { Server as HttpServer } from "http";
import { Server as SocketIO } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";

// For resolving directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default function createWebSocket(pathName) {
  const app = express();

  // Serve static files from the 'public' directory (including test.html)
  const staticDir = path.join(__dirname, "public");
  app.use(express.static(staticDir));

  const SocketServer = new HttpServer(app);
  const WebSocket = new SocketIO(SocketServer, {
    path: pathName,
    cors: {
      origin: "*", // Or your specific origin
      methods: ["GET", "POST"],
    },
    // transports: ["websocket", "polling"],
  });

  return { WebSocket, SocketServer };
}
