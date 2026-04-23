# High-Level Design (HLD) — Real-Time Location Tracking System

## 1. Functional Requirements

- Drivers must be able to send their GPS location every 3–5 seconds via a mobile app
- The system must update a rider's map view with their assigned driver's position in under 1 second
- The backend must be able to query all active drivers within a given geographic radius (for dispatch)
- Location history for every trip must be stored for at least 90 days
- The system must support driver status transitions: OFFLINE → AVAILABLE → ON_TRIP → OFFLINE
- Riders must receive a final "driver arrived" event when the driver is within 50 meters of the pickup point

## 2. Non-Functional Requirements

| Requirement | Target |
|---|---|
| Location update latency (driver → rider) | < 1 second (P99) |
| System availability | 99.99% uptime (~52 min downtime/year) |
| Concurrent active drivers | Up to 1,000,000 |
| Location write throughput | ~300,000 writes/second (1M drivers ÷ 3.5s avg interval) |
| Location read latency (nearby drivers) | < 50ms (P95) |
| Data durability | No location event loss after acknowledgment |
| Geo query accuracy | Within 5 meters |


## 3. System Architecture Diagram

```
                        ┌─────────────────────────────────────────────────────┐
                        │                   DRIVER MOBILE APP                 │
                        │         (GPS polling every 3–5 seconds)             │
                        └──────────────────────┬──────────────────────────────┘
                                               │ WebSocket (persistent)
                                               ▼
                        ┌─────────────────────────────────────────────────────┐
                        │                   API GATEWAY                       │
                        │     (Kong — Auth, Rate Limiting, Routing)           │
                        └──────┬──────────────────────────────┬───────────────┘
                               │                              │
                    WebSocket  │                              │ REST
                               ▼                              ▼
              ┌────────────────────────┐       ┌─────────────────────────┐
              │  Location Ingestion    │       │   Trip / Dispatch       │
              │  Service               │       │   Service               │
              │  (Node.js + Socket.io) │       │   (Node.js)             │
              └────────────┬───────────┘       └────────────┬────────────┘
                           │                                │
                           │ Publish location event         │ Query nearby drivers
                           ▼                                ▼
              ┌────────────────────────┐       ┌─────────────────────────┐
              │      Apache Kafka      │       │         Redis           │
              │  Topic: location-events│       │  (GEOADD / GEORADIUS)   │
              └────────────┬───────────┘       └─────────────────────────┘
                           │
              ┌────────────┴────────────┐
              │                         │
              ▼                         ▼
 ┌────────────────────────┐  ┌──────────────────────────┐
 │  Location Processor    │  │  Notification Service    │
 │  (Kafka Consumer)      │  │  (Kafka Consumer)        │
 │  - Updates Redis       │  │  - Pushes to Rider app   │
 │  - Writes to Cassandra │  │    via WebSocket         │
 └────────────────────────┘  └──────────────────────────┘
              │
              ▼
 ┌────────────────────────┐
 │  Cassandra             │
 │  (Location History)    │
 └────────────────────────┘

              ┌────────────────────────┐
              │  PostgreSQL + PostGIS  │
              │  (Users, Trips,        │
              │   Geo-fencing zones)   │
              └────────────────────────┘
```


## 4. High-Level Components

### API Gateway (Kong)
The single entry point for all client traffic. Handles JWT validation, rate limiting (prevents a buggy driver app from flooding the system), and routes requests to the correct downstream service. Choosing Kong over a custom gateway saves engineering time and provides battle-tested plugins.

### Location Ingestion Service
A stateful Node.js service that maintains WebSocket connections with driver apps. Its only job is to receive location pings and publish them to Kafka. It does not write to any database directly — this keeps it lightweight and horizontally scalable. Each instance can hold ~50,000 concurrent WebSocket connections.

### Apache Kafka (Topic: `location-events`)
Acts as the central nervous system for location data. Producers (Ingestion Service) write to it; multiple consumers (Processor, Notification Service) read from it independently. This decoupling means we can add new consumers (e.g., an analytics service) without touching the ingestion layer. Partitioned by `driver_id` to guarantee ordering per driver.

### Location Processor (Kafka Consumer)
Consumes location events and does two things:
1. Updates the driver's live position in Redis using `GEOADD`
2. Appends the location record to Cassandra for historical storage

### Redis (Live State Store)
Stores only the most recent location of every active driver. Uses Redis Geo commands which internally use a sorted set with geohash encoding. This allows sub-millisecond "find all drivers within X km of point Y" queries. Also stores driver status (AVAILABLE, ON_TRIP) as a simple key-value.

### Notification Service (Kafka Consumer)
Reads location events for drivers who are currently ON_TRIP and pushes the update to the assigned rider's WebSocket connection. Also evaluates geo-fence rules (e.g., driver within 50m of pickup = send "driver arrived" push notification).

### Cassandra (Location History)
Stores every location event ever recorded, partitioned by `driver_id` and clustered by `timestamp`. Optimized for the query pattern: "give me all locations for driver X between time A and time B." Handles millions of writes per second without performance degradation.

### PostgreSQL + PostGIS (Relational Store)
Stores structured relational data: users, drivers, trips, and geo-fence zone polygons. PostGIS enables complex spatial queries like "is this point inside this polygon?" which Redis cannot do natively.

---

## 5. Data Flow — Step by Step

### Flow A: Driver Sends Location Update

```
1. Driver app collects GPS coordinate (lat, lng) every 3–5 seconds
2. App sends location payload over existing WebSocket connection to API Gateway
3. API Gateway validates JWT token, forwards to Location Ingestion Service
4. Ingestion Service publishes event to Kafka topic `location-events`
   Payload: { driver_id, lat, lng, timestamp, trip_id (if on trip) }
5. Kafka acknowledges write — Ingestion Service confirms receipt to driver app
6. Location Processor consumes the event:
   a. Executes GEOADD driver_locations <lng> <lat> <driver_id> in Redis
   b. Writes record to Cassandra table `driver_location_history`
7. If driver is ON_TRIP:
   Notification Service consumes same event and pushes to rider's WebSocket
```

### Flow B: Dispatch Service Finds Nearby Available Drivers

```
1. Rider requests a ride — Dispatch Service receives the pickup coordinates
2. Dispatch Service calls Redis: GEORADIUS driver_locations <lng> <lat> 5 km ASC COUNT 10
3. Redis returns list of driver_ids within 5km, sorted by distance
4. Dispatch Service filters by driver status = AVAILABLE (also stored in Redis)
5. Top candidate is selected and trip is created in PostgreSQL
6. Driver and rider are notified via Notification Service
```


## 6. CAP Theorem Analysis

In a distributed system, the CAP theorem states you can only guarantee two of three properties: Consistency, Availability, and Partition Tolerance. Network partitions are unavoidable in any distributed system, so the real choice is between Consistency and Availability.

**This system chooses: Availability + Partition Tolerance (AP)**

### Justification

Location tracking is a use case where **stale data is far better than no data**. Consider the alternatives:

- If we choose CP (Consistency + Partition Tolerance): During a network partition, the system would refuse to serve location reads until consistency is restored. A rider's map would freeze entirely. This is a terrible user experience.
- If we choose AP (Availability + Partition Tolerance): During a partition, the system continues serving the last known location, which may be a few seconds old. The rider's map keeps moving (with slightly stale data). This is acceptable.

### Per-Component CAP Choices

| Component | Choice | Reason |
|---|---|---|
| Redis (live location) | AP | Eventual consistency is fine; a 2-second-old position is still useful |
| Kafka | AP | Designed for high availability; may deliver duplicates (handled via idempotent consumers) |
| Cassandra | AP | Tunable consistency; we use `QUORUM` for writes, `ONE` for reads on history |
| PostgreSQL | CP | Trip and payment data must be strongly consistent — we cannot double-charge a rider |

### Eventual Consistency Strategy
For Redis, we accept that during a partition, two replicas may briefly show different driver positions. The Location Processor uses a `timestamp` check before writing to Redis — it will not overwrite a newer position with an older one, preventing out-of-order updates from causing regression.
