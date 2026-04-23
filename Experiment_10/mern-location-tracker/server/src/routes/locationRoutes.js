const express         = require("express");
const router          = express.Router();
const Driver          = require("../models/Driver");
const LocationHistory = require("../models/LocationHistory");

// POST /api/location/:driverId — Update driver location (REST fallback; WebSocket is primary)
router.post("/:driverId", async (req, res) => {
  try {
    const { lat, lng, speedKmh = 0, headingDeg = 0, tripId } = req.body;

    if (lat == null || lng == null) {
      return res.status(400).json({ error: "lat and lng are required" });
    }
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return res.status(400).json({ error: "Invalid coordinates" });
    }

    const driver = await Driver.findByIdAndUpdate(
      req.params.driverId,
      { lastLocation: { lat, lng, updatedAt: new Date() } },
      { new: true }
    );
    if (!driver) return res.status(404).json({ error: "Driver not found" });

    // Persist to history (non-blocking)
    LocationHistory.create({ driverId: driver._id, tripId, lat, lng, speedKmh, headingDeg }).catch(() => {});

    // Broadcast to all connected clients via Socket.IO
    req.app.get("io").emit("driver:location", {
      driverId: driver._id,
      name: driver.name,
      vehicleType: driver.vehicleType,
      lat,
      lng,
      speedKmh,
      headingDeg,
      timestamp: new Date().toISOString(),
    });

    res.json({ status: "accepted", serverTimestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/location/:driverId — Get last known location
router.get("/:driverId", async (req, res) => {
  try {
    const driver = await Driver.findById(req.params.driverId).select("name lastLocation status").lean();
    if (!driver || !driver.lastLocation?.lat) {
      return res.status(404).json({ error: "No location data found for this driver" });
    }
    res.json({ driverId: driver._id, name: driver.name, status: driver.status, ...driver.lastLocation });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/location/:driverId/history?from=&to= — Location history
router.get("/:driverId/history", async (req, res) => {
  try {
    const { from, to } = req.query;
    const filter = { driverId: req.params.driverId };
    if (from || to) {
      filter.recordedAt = {};
      if (from) filter.recordedAt.$gte = new Date(from);
      if (to)   filter.recordedAt.$lte = new Date(to);
    }
    const history = await LocationHistory.find(filter)
      .sort({ recordedAt: 1 })
      .limit(1000)
      .lean();
    res.json({ driverId: req.params.driverId, totalPoints: history.length, locations: history });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/location/nearby?lat=&lng=&radiusKm= — Find nearby available drivers
router.get("/", async (req, res) => {
  try {
    const { lat, lng, radiusKm = 5 } = req.query;
    if (!lat || !lng) return res.status(400).json({ error: "lat and lng are required" });

    // Pull all available drivers and filter by distance in JS (works without Atlas)
    const drivers = await Driver.find({ status: "AVAILABLE" }).lean();
    const nearby = drivers
      .map((d) => {
        if (!d.lastLocation?.lat) return null;
        const dist = haversineKm(parseFloat(lat), parseFloat(lng), d.lastLocation.lat, d.lastLocation.lng);
        return dist <= parseFloat(radiusKm) ? { ...d, distanceKm: Math.round(dist * 100) / 100 } : null;
      })
      .filter(Boolean)
      .sort((a, b) => a.distanceKm - b.distanceKm);

    res.json({ drivers: nearby, total: nearby.length, searchRadiusKm: parseFloat(radiusKm) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

module.exports = router;
