import { io } from "socket.io-client";

// Single shared socket instance
const socket = io("http://localhost:5000", {
  transports: ["websocket", "polling"],
  autoConnect: true,
});

export default socket;
