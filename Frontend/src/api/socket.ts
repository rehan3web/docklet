import { io, Socket } from "socket.io-client";
import { getToken } from "./client";

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (socket && socket.connected) return socket;

  // Tear down any stale socket so we can re-attach with the latest token.
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }

  // Connect through the same origin — vite proxies /socket.io to the backend.
  // Auth: pass the JWT in the handshake so the backend's io.use() middleware
  // can verify and join the per-user room.
  socket = io({
    path: "/socket.io",
    transports: ["websocket", "polling"],
    autoConnect: true,
    reconnection: true,
    reconnectionDelay: 1000,
    auth: (cb) => cb({ token: getToken() || "" }),
  });
  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
}
