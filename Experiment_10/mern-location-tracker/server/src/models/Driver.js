const mongoose = require("mongoose");

const driverSchema = new mongoose.Schema(
  {
    name:         { type: String, required: true, trim: true },
    phone:        { type: String, required: true, unique: true, trim: true },
    vehicleType:  { type: String, enum: ["BIKE", "CAR", "AUTO"], required: true },
    licensePlate: { type: String, required: true, unique: true, trim: true },
    status:       { type: String, enum: ["OFFLINE", "AVAILABLE", "ON_TRIP"], default: "OFFLINE" },
    // Last known location stored directly on the driver document for fast reads
    lastLocation: {
      lat:       { type: Number },
      lng:       { type: Number },
      updatedAt: { type: Date },
    },
  },
  { timestamps: true }
);

// 2dsphere index enables MongoDB geospatial queries
driverSchema.index({ "lastLocation.lat": 1, "lastLocation.lng": 1 });

module.exports = mongoose.model("Driver", driverSchema);
