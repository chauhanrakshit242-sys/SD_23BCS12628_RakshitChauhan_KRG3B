require("dotenv").config();
const express  = require("express");
const http     = require("http");
const cors     = require("cors");
const mongoose = require("mongoose");
const { Server } = require("socket.io");

const driverRoutes   = require("./routes/driverRoutes");
const locationRoutes = require("./routes/locationRoutes");
const registerSocketHandlers = require("./socket/locationSocket");

const app    = express();
const server = http.createServer(app);

// Socket.IO setup
const io = new Server(server, {
  cors: { origin: process.env.CLIENT_URL || "http://localhost:5173", methods: ["GET", "POST"] },
});

// Make io accessible in route handlers via req.app.get("io")
app.set("io", io);

// Middleware
app.use(cors({ origin: process.env.CLIENT_URL || "http://localhost:5173" }));
app.use(express.json());

// Routes
app.use("/api/drivers",  driverRoutes);
app.use("/api/location", locationRoutes);

// Health check
app.get("/health", (_req, res) => res.json({ status: "ok", time: new Date().toISOString() }));

// Register Socket.IO event handlers
registerSocketHandlers(io);

// Connect to MongoDB then start server
const PORT = process.env.PORT || 5000;
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    console.log("MongoDB connected");
    server.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
      console.log(`Socket.IO ready`);
    });
  })
  .catch((err) => {
    console.error("MongoDB connection failed:", err.message);
    process.exit(1);
  });
