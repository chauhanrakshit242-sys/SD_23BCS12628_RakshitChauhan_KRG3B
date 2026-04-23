import { useState, useEffect } from "react";
import axios from "axios";
import socket from "../socket";

export function useDrivers() {
  const [drivers, setDrivers]     = useState([]);
  const [liveLocations, setLive]  = useState({});
  const [connected, setConnected] = useState(socket.connected);

  // Load all drivers on mount
  useEffect(() => {
    axios.get("/api/drivers")
      .then((r) => setDrivers(r.data))
      .catch((e) => console.error("Failed to load drivers:", e));
  }, []);

  useEffect(() => {
    const onConnect    = () => setConnected(true);
    const onDisconnect = () => setConnected(false);

    const onLocation = (payload) => {
      setLive((prev) => ({ ...prev, [payload.driverId]: payload }));
    };

    const onStatus = ({ driverId, status }) => {
      setDrivers((prev) =>
        prev.map((d) => (d._id === driverId ? { ...d, status } : d))
      );
    };

    socket.on("connect",         onConnect);
    socket.on("disconnect",      onDisconnect);
    socket.on("driver:location", onLocation);
    socket.on("driver:status",   onStatus);

    return () => {
      socket.off("connect",         onConnect);
      socket.off("disconnect",      onDisconnect);
      socket.off("driver:location", onLocation);
      socket.off("driver:status",   onStatus);
    };
  }, []);

  const registerDriver = async (formData) => {
    const { data } = await axios.post("/api/drivers", formData);
    setDrivers((prev) => [...prev, data.driver]);
    return data.driver;
  };

  return { drivers, liveLocations, connected, registerDriver };
}
