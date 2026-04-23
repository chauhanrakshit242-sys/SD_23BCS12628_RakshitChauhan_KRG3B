const express = require("express");
const router  = express.Router();
const Driver  = require("../models/Driver");

// Valid status transitions
const TRANSITIONS = {
  OFFLINE:   ["AVAILABLE"],
  AVAILABLE: ["ON_TRIP", "OFFLINE"],
  ON_TRIP:   ["AVAILABLE"],
};

// POST /api/drivers — Register a new driver
router.post("/", async (req, res) => {
  try {
    const { name, phone, vehicleType, licensePlate } = req.body;
    if (!name || !phone || !vehicleType || !licensePlate) {
      return res.status(400).json({ error: "All fields are required: name, phone, vehicleType, licensePlate" });
    }
    const driver = await Driver.create({ name, phone, vehicleType, licensePlate });
    res.status(201).json({ message: "Driver registered", driver });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: "Phone or license plate already exists" });
    }
    res.status(500).json({ error: err.message });
  }
});

// GET /api/drivers — List all drivers
router.get("/", async (_req, res) => {
  try {
    const drivers = await Driver.find().select("-__v").lean();
    res.json(drivers);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/drivers/:id — Get single driver
router.get("/:id", async (req, res) => {
  try {
    const driver = await Driver.findById(req.params.id).select("-__v").lean();
    if (!driver) return res.status(404).json({ error: "Driver not found" });
    res.json(driver);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/drivers/:id/status — Update driver status
router.patch("/:id/status", async (req, res) => {
  try {
    const { status } = req.body;
    const driver = await Driver.findById(req.params.id);
    if (!driver) return res.status(404).json({ error: "Driver not found" });

    const allowed = TRANSITIONS[driver.status] || [];
    if (!allowed.includes(status)) {
      return res.status(409).json({
        error: "INVALID_STATUS_TRANSITION",
        message: `Cannot go from ${driver.status} → ${status}`,
        currentStatus: driver.status,
        requestedStatus: status,
      });
    }

    driver.status = status;
    await driver.save();

    // Emit status change via Socket.IO (attached to app)
    req.app.get("io").emit("driver:status", { driverId: driver._id, status });

    res.json({ driverId: driver._id, previousStatus: allowed[0], currentStatus: status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
