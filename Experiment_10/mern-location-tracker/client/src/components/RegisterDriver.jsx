import { useState } from "react";

const VEHICLES = [
  { value: "CAR",  icon: "🚗", label: "Car"  },
  { value: "BIKE", icon: "🏍️", label: "Bike" },
  { value: "AUTO", icon: "🛺", label: "Auto" },
];

const INITIAL = { name: "", phone: "", vehicleType: "CAR", licensePlate: "" };

export default function RegisterDriver({ onRegister }) {
  const [form, setForm]       = useState(INITIAL);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg]         = useState(null);

  const set = (key, val) => setForm((p) => ({ ...p, [key]: val }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim() || !form.phone.trim() || !form.licensePlate.trim()) {
      setMsg({ type: "error", text: "All fields are required." });
      return;
    }
    setLoading(true);
    setMsg(null);
    try {
      await onRegister({ ...form });
      setMsg({ type: "success", text: `✓ "${form.name}" registered successfully!` });
      setForm(INITIAL);
    } catch (err) {
      setMsg({ type: "error", text: err.response?.data?.error || "Registration failed. Try again." });
    } finally {
      setLoading(false);
    }
  };

  return (
    <form className="form-section" onSubmit={handleSubmit}>
      <div>
        <div className="form-title">Register Driver</div>
        <div className="form-subtitle">Add a new driver to the tracking system</div>
      </div>

      <div className="form-group">
        <label className="form-label">Full Name</label>
        <input
          className="form-input"
          placeholder="e.g. Rahul Sharma"
          value={form.name}
          onChange={(e) => set("name", e.target.value)}
          required
        />
      </div>

      <div className="form-group">
        <label className="form-label">Phone Number</label>
        <input
          className="form-input"
          placeholder="e.g. +91 98765 43210"
          value={form.phone}
          onChange={(e) => set("phone", e.target.value)}
          required
        />
      </div>

      <div className="form-group">
        <label className="form-label">Vehicle Type</label>
        <div className="vehicle-grid">
          {VEHICLES.map((v) => (
            <button
              key={v.value}
              type="button"
              className={`vehicle-opt ${form.vehicleType === v.value ? "active" : ""}`}
              onClick={() => set("vehicleType", v.value)}
            >
              <span className="v-icon">{v.icon}</span>
              {v.label}
            </button>
          ))}
        </div>
      </div>

      <div className="form-group">
        <label className="form-label">License Plate</label>
        <input
          className="form-input"
          placeholder="e.g. DL01AB1234"
          value={form.licensePlate}
          onChange={(e) => set("licensePlate", e.target.value.toUpperCase())}
          required
        />
      </div>

      <button className="submit-btn" type="submit" disabled={loading}>
        {loading ? "Registering..." : "Register Driver"}
      </button>

      {msg && (
        <div className={`alert ${msg.type}`}>{msg.text}</div>
      )}
    </form>
  );
}
