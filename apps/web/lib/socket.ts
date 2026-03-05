import { io, type Socket } from "socket.io-client";
import { WS_BASE_URL } from "./config";

export function createGameSocket(token: string): Socket {
  return io(`${WS_BASE_URL}/ws/game`, {
    transports: ["websocket"],
    auth: {
      token,
    },
  });
}
