import { useRef, useState } from "react";
import socket from "../socket";

export function useSimulator() {
  const [simulating, setSimulating] = useState(null);
  const intervalRef = useRef(null);
  const posRef      = useRef({});

  const start = (driver) => {
    if (intervalRef.current) stop();

    // Seed starting position near New Delhi
    posRef.current = {
      lat: 28.6139 + (Math.random() - 0.5) * 0.06,
      lng: 77.2090 + (Math.random() - 0.5) * 0.06,
    };

    socket.emit("driver:identify", { driverId: driver._id });
    setSimulating(driver._id);

    intervalRef.current = setInterval(() => {
      posRef.current.lat += (Math.random() - 0.5) * 0.0025;
      posRef.current.lng += (Math.random() - 0.5) * 0.0025;

      socket.emit("driver:location", {
        driverId:   driver._id,
        lat:        posRef.current.lat,
        lng:        posRef.current.lng,
        speedKmh:   Math.round(15 + Math.random() * 45),
        headingDeg: Math.round(Math.random() * 360),
      });
    }, 2000);
  };

  const stop = () => {
    clearInterval(intervalRef.current);
    intervalRef.current = null;
    setSimulating(null);
  };

  const toggle = (driver) => {
    simulating === driver._id ? stop() : start(driver);
  };

  return { simulating, toggle };
}
