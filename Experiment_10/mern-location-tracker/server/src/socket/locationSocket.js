const Driver          = require("../models/Driver");
const LocationHistory = require("../models/LocationHistory");

module.exports = function registerSocketHandlers(io) {
  io.on("connection", (socket) => {
    console.log(`[Socket] Client connected: ${socket.id}`);

    // Driver identifies itself on connect
    socket.on("driver:identify", async ({ driverId }) => {
      socket.driverId = driverId;
      socket.join(`driver:${driverId}`);
      console.log(`[Socket] Driver ${driverId} identified`);

      // Mark driver as AVAILABLE in DB
      await Driver.findByIdAndUpdate(driverId, { status: "AVAILABLE" }).catch(() => {});
      io.emit("driver:status", { driverId, status: "AVAILABLE" });
    });

    // Driver sends location ping
    socket.on("driver:location", async (payload) => {
      const { driverId, lat, lng, speedKmh = 0, headingDeg = 0, tripId } = payload;

      if (!driverId || lat == null || lng == null) return;

      try {
        // Update last known position in MongoDB
        const driver = await Driver.findByIdAndUpdate(
          driverId,
          { lastLocation: { lat, lng, updatedAt: new Date() } },
          { new: true }
        );
        if (!driver) return;

        // Persist history (fire-and-forget)
        LocationHistory.create({ driverId, tripId, lat, lng, speedKmh, headingDeg }).catch(() => {});

        // Broadcast to ALL connected clients (riders watching the map)
        io.emit("driver:location", {
          driverId,
          name: driver.name,
          vehicleType: driver.vehicleType,
          status: driver.status,
          lat,
          lng,
          speedKmh,
          headingDeg,
          timestamp: new Date().toISOString(),
        });

        // Ack back to driver
        socket.emit("location:ack", { receivedAt: new Date().toISOString() });
      } catch (err) {
        console.error("[Socket] location update error:", err.message);
      }
    });

    // Rider subscribes to a specific driver
    socket.on("rider:track", ({ driverId }) => {
      socket.join(`driver:${driverId}`);
      console.log(`[Socket] Rider ${socket.id} tracking driver ${driverId}`);
    });

    socket.on("disconnect", async () => {
      console.log(`[Socket] Client disconnected: ${socket.id}`);
      if (socket.driverId) {
        await Driver.findByIdAndUpdate(socket.driverId, { status: "OFFLINE" }).catch(() => {});
        io.emit("driver:status", { driverId: socket.driverId, status: "OFFLINE" });
      }
    });
  });
};
