const mongoose = require("mongoose");

// Stores every location ping — used for trip replay and history
const locationHistorySchema = new mongoose.Schema(
  {
    driverId:   { type: mongoose.Schema.Types.ObjectId, ref: "Driver", required: true, index: true },
    tripId:     { type: String, default: null },
    lat:        { type: Number, required: true },
    lng:        { type: Number, required: true },
    speedKmh:   { type: Number, default: 0 },
    headingDeg: { type: Number, default: 0 },
    recordedAt: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

// Compound index for the most common query: driver + time range
locationHistorySchema.index({ driverId: 1, recordedAt: -1 });

// Auto-delete records older than 90 days
locationHistorySchema.index({ recordedAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });

module.exports = mongoose.model("LocationHistory", locationHistorySchema);
