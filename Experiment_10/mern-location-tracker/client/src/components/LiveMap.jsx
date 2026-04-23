import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import { useEffect, useRef } from "react";

// Fix Leaflet default icon paths broken by Vite
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl:       "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl:     "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

const COLORS = { CAR: "#3b82f6", BIKE: "#10b981", AUTO: "#f59e0b" };

function makeCarIcon(color, isSelected) {
  const size = isSelected ? 44 : 36;
  const glow = isSelected ? `box-shadow:0 0 0 3px white, 0 0 16px ${color};` : `box-shadow:0 2px 10px rgba(0,0,0,0.5);`;
  return L.divIcon({
    className: "",
    html: `
      <div style="
        width:${size}px; height:${size}px;
        background:${color};
        border-radius:50% 50% 50% 0;
        transform:rotate(-45deg);
        border:3px solid white;
        ${glow}
        transition:all 0.3s;
      ">
        <div style="
          transform:rotate(45deg);
          display:flex; align-items:center; justify-content:center;
          width:100%; height:100%;
          font-size:${isSelected ? 18 : 14}px;
          margin-top:-2px;
        ">🚗</div>
      </div>`,
    iconSize:   [size, size],
    iconAnchor: [size / 2, size],
    popupAnchor:[0, -(size + 4)],
  });
}

// Smoothly pan map to a driver when selected
function MapController({ selectedDriver, liveLocations }) {
  const map = useMap();
  const prevId = useRef(null);

  useEffect(() => {
    if (!selectedDriver) return;
    const live = liveLocations[selectedDriver._id];
    if (!live) return;
    if (prevId.current !== selectedDriver._id) {
      map.flyTo([live.lat, live.lng], 15, { duration: 1.2 });
      prevId.current = selectedDriver._id;
    }
  }, [selectedDriver, liveLocations, map]);

  return null;
}

// Auto-fit bounds when first drivers appear
function AutoFit({ positions, fitted }) {
  const map = useMap();
  useEffect(() => {
    if (positions.length === 0 || fitted.current) return;
    const bounds = L.latLngBounds(positions.map((p) => [p.lat, p.lng]));
    map.fitBounds(bounds, { padding: [80, 80], maxZoom: 14 });
    fitted.current = true;
  }, [positions.length]); // eslint-disable-line
  return null;
}

export default function LiveMap({ drivers, liveLocations, selectedDriver }) {
  const fittedRef = useRef(false);

  const active = drivers
    .map((d) => ({ ...d, live: liveLocations[d._id] }))
    .filter((d) => d.live);

  const onTrip     = drivers.filter((d) => d.status === "ON_TRIP").length;
  const available  = drivers.filter((d) => d.status === "AVAILABLE").length;

  return (
    <div className="map-wrap">
      <MapContainer
        center={[28.6139, 77.209]}
        zoom={11}
        style={{ width: "100%", height: "100%" }}
        zoomControl={true}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {active.map((driver) => {
          const isSelected = selectedDriver?._id === driver._id;
          const color = COLORS[driver.vehicleType] || COLORS.CAR;
          return (
            <Marker
              key={driver._id}
              position={[driver.live.lat, driver.live.lng]}
              icon={makeCarIcon(color, isSelected)}
            >
              <Popup>
                <div style={{ minWidth: 180 }}>
                  <div className="popup-name">{driver.name}</div>
                  <div className="popup-row">
                    <span className="popup-label">Status</span>
                    <span className={`popup-val ${driver.status === "ON_TRIP" ? "yellow" : "green"}`}>
                      {driver.status}
                    </span>
                  </div>
                  <div className="popup-row">
                    <span className="popup-label">Vehicle</span>
                    <span className="popup-val">{driver.vehicleType}</span>
                  </div>
                  <div className="popup-row">
                    <span className="popup-label">Speed</span>
                    <span className="popup-val green">{driver.live.speedKmh || 0} km/h</span>
                  </div>
                  <div className="popup-row">
                    <span className="popup-label">Lat</span>
                    <span className="popup-val">{driver.live.lat.toFixed(5)}</span>
                  </div>
                  <div className="popup-row">
                    <span className="popup-label">Lng</span>
                    <span className="popup-val">{driver.live.lng.toFixed(5)}</span>
                  </div>
                  <div className="popup-row">
                    <span className="popup-label">Updated</span>
                    <span className="popup-val">{new Date(driver.live.timestamp).toLocaleTimeString()}</span>
                  </div>
                </div>
              </Popup>
            </Marker>
          );
        })}

        <MapController selectedDriver={selectedDriver} liveLocations={liveLocations} />
        {active.length > 0 && (
          <AutoFit positions={active.map((d) => d.live)} fitted={fittedRef} />
        )}
      </MapContainer>

      {/* Stats overlay */}
      <div className="map-overlay">
        <div className="overlay-card">
          <div className="overlay-title">Live Stats</div>
          <div className="stat-row">
            <span className="stat-row-label">Active on map</span>
            <span className="stat-row-val">{active.length}</span>
          </div>
          <div className="stat-row">
            <span className="stat-row-label">Available</span>
            <span className="stat-row-val green">{available}</span>
          </div>
          <div className="stat-row">
            <span className="stat-row-label">On Trip</span>
            <span className="stat-row-val yellow">{onTrip}</span>
          </div>
          <div className="stat-row">
            <span className="stat-row-label">Total Drivers</span>
            <span className="stat-row-val">{drivers.length}</span>
          </div>
        </div>

        {/* Legend */}
        <div className="overlay-card">
          <div className="overlay-title">Legend</div>
          {Object.entries(COLORS).map(([type, color]) => (
            <div className="stat-row" key={type}>
              <span className="stat-row-label">{type}</span>
              <span style={{ width: 12, height: 12, borderRadius: "50%", background: color, display: "inline-block", boxShadow: `0 0 6px ${color}` }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
