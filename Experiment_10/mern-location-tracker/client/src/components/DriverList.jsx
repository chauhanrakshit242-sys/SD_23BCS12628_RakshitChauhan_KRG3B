import { useSimulator } from "../hooks/useSimulator";

const AVATAR = { CAR: "🚗", BIKE: "🏍️", AUTO: "🛺" };

export default function DriverList({ drivers, liveLocations, onSelect, selectedId }) {
  const { simulating, toggle } = useSimulator();

  if (drivers.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-icon">🚗</div>
        No drivers registered yet.
        <br />Switch to Register tab to add one.
      </div>
    );
  }

  return (
    <>
      {drivers.map((driver) => {
        const live = liveLocations[driver._id];
        const isSim = simulating === driver._id;

        return (
          <div
            key={driver._id}
            className={`driver-card ${driver.status} ${selectedId === driver._id ? "selected" : ""}`}
            onClick={() => onSelect(driver)}
          >
            <div className="card-top">
              <div className={`driver-avatar avatar-${driver.vehicleType}`}>
                {AVATAR[driver.vehicleType]}
              </div>
              <div className="driver-info">
                <div className="driver-name">{driver.name}</div>
                <div className="driver-plate">{driver.licensePlate}</div>
              </div>
              <span className={`status-badge ${driver.status}`}>
                {driver.status}
              </span>
            </div>

            <div className="card-meta">
              <span className="meta-chip">{driver.vehicleType}</span>
              <span className="meta-chip">{driver.phone}</span>
              {isSim && <span className="meta-chip" style={{ color: "var(--green)", borderColor: "rgba(16,185,129,0.3)" }}>LIVE</span>}
            </div>

            {live && (
              <div className="card-coords">
                <span className="live-dot" />
                {live.lat.toFixed(5)}, {live.lng.toFixed(5)}
                {live.speedKmh > 0 && (
                  <span style={{ marginLeft: "auto", color: "var(--accent)" }}>{live.speedKmh} km/h</span>
                )}
              </div>
            )}

            <button
              className={`sim-btn ${isSim ? "stop" : "start"}`}
              onClick={(e) => { e.stopPropagation(); toggle(driver); }}
            >
              {isSim ? (
                <><span>⏹</span> Stop Simulation</>
              ) : (
                <><span>▶</span> Simulate Movement</>
              )}
            </button>
          </div>
        );
      })}
    </>
  );
}
