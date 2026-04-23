import { useState } from "react";
import LiveMap        from "./components/LiveMap";
import DriverList     from "./components/DriverList";
import RegisterDriver from "./components/RegisterDriver";
import { useDrivers } from "./hooks/useDrivers";

export default function App() {
  const { drivers, liveLocations, connected, registerDriver } = useDrivers();
  const [tab, setTab]         = useState("drivers");
  const [selected, setSelected] = useState(null);

  const activeCount    = Object.keys(liveLocations).length;
  const availableCount = drivers.filter((d) => d.status === "AVAILABLE").length;
  const onTripCount    = drivers.filter((d) => d.status === "ON_TRIP").length;

  const handleRegister = async (data) => {
    const driver = await registerDriver(data);
    setTab("drivers");
    return driver;
  };

  return (
    <>
      {/* Header */}
      <header className="header">
        <div className="header-left">
          <div className="header-logo">🚗</div>
          <div>
            <div className="header-title">Live Driver Tracker</div>
            <div className="header-sub">Real-time location tracking · MERN + Socket.IO</div>
          </div>
        </div>

        <div className="header-right">
          <div className="stat-chips">
            <div className="stat-chip">Active <span>{activeCount}</span></div>
            <div className="stat-chip">Available <span>{availableCount}</span></div>
            <div className="stat-chip">On Trip <span>{onTripCount}</span></div>
          </div>
          <div className={`conn-pill ${connected ? "on" : "off"}`}>
            <span className="conn-dot" />
            {connected ? "Connected" : "Disconnected"}
          </div>
        </div>
      </header>

      <div className="layout">
        {/* Sidebar */}
        <aside className="sidebar">
          <div className="sidebar-tabs">
            <button
              className={`tab ${tab === "drivers" ? "active" : ""}`}
              onClick={() => setTab("drivers")}
            >
              Drivers ({drivers.length})
            </button>
            <button
              className={`tab ${tab === "register" ? "active" : ""}`}
              onClick={() => setTab("register")}
            >
              + Register
            </button>
          </div>

          <div className="sidebar-body">
            {tab === "drivers" ? (
              <DriverList
                drivers={drivers}
                liveLocations={liveLocations}
                onSelect={setSelected}
                selectedId={selected?._id}
              />
            ) : (
              <RegisterDriver onRegister={handleRegister} />
            )}
          </div>
        </aside>

        {/* Map */}
        <LiveMap
          drivers={drivers}
          liveLocations={liveLocations}
          selectedDriver={selected}
        />
      </div>
    </>
  );
}
