# MERN Real-Time Location Tracker

Uber-like driver tracking built with MongoDB, Express, React, Node.js, and Socket.IO.

## Prerequisites

- Node.js 18+
- MongoDB running locally on port 27017
  - Install: https://www.mongodb.com/try/download/community
  - Or use MongoDB Atlas (free cloud) — paste the connection string in server/.env

## Run the project

### 1. Start the backend
```bash
cd server
npm run dev
# Server: http://localhost:5000
```

### 2. Start the frontend (new terminal)
```bash
cd client
npm run dev
# App: http://localhost:5173
```

## What you can do

1. Open http://localhost:5173
2. Click "+ Register" tab → add a driver (name, phone, vehicle type, plate)
3. Switch to "Drivers" tab → click "Simulate Movement" on any driver
4. Watch the pin appear and move on the live map in real time
5. Open multiple browser tabs to see multi-driver tracking simultaneously

## API Endpoints

| Method | URL | Description |
|--------|-----|-------------|
| POST | /api/drivers | Register driver |
| GET  | /api/drivers | List all drivers |
| PATCH | /api/drivers/:id/status | Update status |
| POST | /api/location/:driverId | Update location (REST) |
| GET  | /api/location/:driverId | Get last location |
| GET  | /api/location/:driverId/history | Location history |
| GET  | /api/location/nearby?lat=&lng= | Nearby drivers |

## Socket.IO Events

| Event | Direction | Payload |
|-------|-----------|---------|
| driver:identify | client → server | { driverId } |
| driver:location | client → server | { driverId, lat, lng, speedKmh } |
| driver:location | server → all clients | { driverId, name, lat, lng, ... } |
| driver:status   | server → all clients | { driverId, status } |
| location:ack    | server → driver | { receivedAt } |

## Tech Stack

- MongoDB + Mongoose — stores drivers and location history
- Express — REST API
- React + Vite — frontend
- Leaflet + react-leaflet — interactive map (OpenStreetMap tiles, no API key needed)
- Socket.IO — real-time bidirectional location streaming
