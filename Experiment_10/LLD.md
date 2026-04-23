# Low-Level Design (LLD) — Real-Time Location Tracking System

## 1. Class Design (OOP with SOLID Principles)

### Core Domain Classes

```typescript
// --- Value Object ---
class Coordinate {
  constructor(
    public readonly lat: number,
    public readonly lng: number,
    public readonly timestamp: Date
  ) {
    if (lat < -90 || lat > 90) throw new Error("Invalid latitude");
    if (lng < -180 || lng > 180) throw new Error("Invalid longitude");
  }
}

// --- Entity ---
class Driver {
  private status: DriverStatus;
  private lastLocation: Coordinate | null = null;

  constructor(
    public readonly driverId: string,
    public readonly vehicleType: VehicleType
  ) {
    this.status = DriverStatus.OFFLINE;
  }

  goOnline(): void {
    if (this.status !== DriverStatus.OFFLINE)
      throw new Error("Driver is already online");
    this.status = DriverStatus.AVAILABLE;
  }

  updateLocation(coord: Coordinate): void {
    if (this.status === DriverStatus.OFFLINE)
      throw new Error("Cannot update location while offline");
    // Reject stale updates (out-of-order GPS packets)
    if (this.lastLocation && coord.timestamp <= this.lastLocation.timestamp)
      return;
    this.lastLocation = coord;
  }

  getStatus(): DriverStatus { return this.status; }
  getLastLocation(): Coordinate | null { return this.lastLocation; }
}

enum DriverStatus { OFFLINE = "OFFLINE", AVAILABLE = "AVAILABLE", ON_TRIP = "ON_TRIP" }
enum VehicleType { BIKE = "BIKE", CAR = "CAR", AUTO = "AUTO" }
```

### SOLID Principles Applied

**Single Responsibility Principle (SRP)**
Each class has one reason to change. `Coordinate` only validates and holds geo data. `Driver` only manages driver state. The `LocationService` only orchestrates the write flow. No class mixes business logic with I/O.

**Open/Closed Principle (OCP)**
The `LocationRepository` is an interface. Adding a new storage backend (e.g., InfluxDB) means creating a new class that implements the interface — no existing code changes.

```typescript
// Interface (abstraction)
interface LocationRepository {
  saveLocation(driverId: string, coord: Coordinate): Promise<void>;
  getLastLocation(driverId: string): Promise<Coordinate | null>;
}

// Concrete implementations
class RedisLocationRepository implements LocationRepository { ... }
class CassandraLocationRepository implements LocationRepository { ... }
```

**Liskov Substitution Principle (LSP)**
Any `LocationRepository` implementation can replace another without breaking the `LocationService`. The service only depends on the interface contract.

**Interface Segregation Principle (ISP)**
Interfaces are kept narrow. A `ReadableLocationRepository` (for queries) is separate from `WritableLocationRepository` (for ingestion). Services that only read do not depend on write methods.

```typescript
interface ReadableLocationRepository {
  getLastLocation(driverId: string): Promise<Coordinate | null>;
  getNearbyDrivers(center: Coordinate, radiusKm: number): Promise<string[]>;
}

interface WritableLocationRepository {
  saveLocation(driverId: string, coord: Coordinate): Promise<void>;
}
```

**Dependency Inversion Principle (DIP)**
High-level modules (LocationService) depend on abstractions (interfaces), not concrete classes (RedisClient). Dependencies are injected via constructor.

```typescript
class LocationService {
  constructor(
    private readonly writeRepo: WritableLocationRepository,
    private readonly eventPublisher: EventPublisher
  ) {}

  async handleLocationUpdate(driverId: string, coord: Coordinate): Promise<void> {
    await this.writeRepo.saveLocation(driverId, coord);
    await this.eventPublisher.publish("location-events", { driverId, coord });
  }
}
```


## 2. Design Patterns Used

### Singleton — Kafka Producer / Redis Client
Database and broker connections are expensive to create. A single shared instance is created at application startup and reused across all requests.

```typescript
class KafkaProducerSingleton {
  private static instance: Producer;

  static getInstance(): Producer {
    if (!KafkaProducerSingleton.instance) {
      const kafka = new Kafka({ brokers: ["kafka1:9092", "kafka2:9092"] });
      KafkaProducerSingleton.instance = kafka.producer();
    }
    return KafkaProducerSingleton.instance;
  }
}
```

### Observer — Location Event Broadcasting
When a driver's location is updated, multiple consumers (Notification Service, Analytics Service) need to react. The Observer pattern decouples the producer from its consumers via Kafka topics.

```typescript
// Publisher (Subject)
class LocationEventPublisher {
  async publish(event: LocationEvent): Promise<void> {
    await KafkaProducerSingleton.getInstance().send({
      topic: "location-events",
      messages: [{ key: event.driverId, value: JSON.stringify(event) }]
    });
  }
}

// Consumers (Observers) — each runs independently
class RedisUpdaterConsumer implements KafkaConsumer { ... }
class RiderNotifierConsumer implements KafkaConsumer { ... }
class AnalyticsConsumer implements KafkaConsumer { ... }
```

### Factory — Repository Creation
Different environments (test, staging, production) use different repository implementations. A factory decides which one to instantiate based on configuration.

```typescript
class LocationRepositoryFactory {
  static create(config: AppConfig): LocationRepository {
    switch (config.storageBackend) {
      case "redis":    return new RedisLocationRepository(config.redisUrl);
      case "cassandra": return new CassandraLocationRepository(config.cassandraHosts);
      case "memory":   return new InMemoryLocationRepository(); // for unit tests
      default: throw new Error(`Unknown backend: ${config.storageBackend}`);
    }
  }
}
```

### Strategy — Distance Calculation
Different algorithms can be used for distance calculation (Haversine for accuracy, Euclidean for speed in small areas). The strategy pattern lets us swap them without changing the calling code.

```typescript
interface DistanceStrategy {
  calculate(a: Coordinate, b: Coordinate): number; // returns km
}

class HaversineStrategy implements DistanceStrategy { ... }
class EuclideanStrategy implements DistanceStrategy { ... }

class GeoService {
  constructor(private strategy: DistanceStrategy) {}
  getDistance(a: Coordinate, b: Coordinate): number {
    return this.strategy.calculate(a, b);
  }
}
```

---

## 3. Database Schema

### PostgreSQL Tables

```sql
-- Drivers table
CREATE TABLE drivers (
  driver_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(100) NOT NULL,
  phone         VARCHAR(20) UNIQUE NOT NULL,
  vehicle_type  VARCHAR(20) NOT NULL CHECK (vehicle_type IN ('BIKE','CAR','AUTO')),
  license_plate VARCHAR(20) UNIQUE NOT NULL,
  status        VARCHAR(20) NOT NULL DEFAULT 'OFFLINE',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Riders table
CREATE TABLE riders (
  rider_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(100) NOT NULL,
  phone       VARCHAR(20) UNIQUE NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Trips table
CREATE TABLE trips (
  trip_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id       UUID NOT NULL REFERENCES drivers(driver_id),
  rider_id        UUID NOT NULL REFERENCES riders(rider_id),
  status          VARCHAR(20) NOT NULL DEFAULT 'REQUESTED',
  pickup_lat      DECIMAL(10,8) NOT NULL,
  pickup_lng      DECIMAL(11,8) NOT NULL,
  dropoff_lat     DECIMAL(10,8),
  dropoff_lng     DECIMAL(11,8),
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_trips_driver_id ON trips(driver_id);
CREATE INDEX idx_trips_rider_id ON trips(rider_id);
CREATE INDEX idx_trips_status ON trips(status);
CREATE INDEX idx_drivers_status ON drivers(status);
```

### Cassandra Table (Location History)

```sql
CREATE KEYSPACE location_tracking
  WITH replication = {'class': 'NetworkTopologyStrategy', 'datacenter1': 3};

CREATE TABLE location_tracking.driver_location_history (
  driver_id   UUID,
  trip_id     UUID,
  recorded_at TIMESTAMP,
  lat         DOUBLE,
  lng         DOUBLE,
  speed_kmh   FLOAT,
  heading_deg SMALLINT,
  PRIMARY KEY ((driver_id), recorded_at)
) WITH CLUSTERING ORDER BY (recorded_at DESC)
  AND default_time_to_live = 7776000; -- 90 days TTL
```

Partition key is `driver_id` so all location records for a driver live on the same node — range queries by time are fast. TTL of 90 days handles automatic cleanup without a cron job.

### Redis Key Structure

```
# Live driver position (Geo sorted set)
Key:   driver_locations
Type:  Sorted Set (Geo)
Cmd:   GEOADD driver_locations <lng> <lat> <driver_id>

# Driver status
Key:   driver:status:<driver_id>
Type:  String
Value: "AVAILABLE" | "ON_TRIP" | "OFFLINE"
TTL:   300 seconds (auto-expire if driver goes silent)

# Active trip mapping
Key:   driver:trip:<driver_id>
Type:  String
Value: <trip_id>
TTL:   No expiry (cleared on trip completion)
```


## 4. Sequence Diagrams

### Sequence 1: Driver Sends Location Update

```
Driver App          API Gateway       Ingestion Svc      Kafka         Location Processor     Redis         Cassandra
    |                    |                  |               |                  |                  |               |
    |--WS: {lat,lng}---->|                  |               |                  |                  |               |
    |                    |--validate JWT--->|               |                  |                  |               |
    |                    |                  |--publish()---->|                  |                  |               |
    |                    |                  |<--ack---------|                  |                  |               |
    |<---WS: ack---------|                  |               |                  |                  |               |
    |                    |                  |               |--consume event-->|                  |               |
    |                    |                  |               |                  |--GEOADD---------->|               |
    |                    |                  |               |                  |<--OK--------------|               |
    |                    |                  |               |                  |--INSERT---------->|               |
    |                    |                  |               |                  |<--OK--------------|               |
```

### Sequence 2: Rider Receives Driver Location (On-Trip)

```
Driver App     Ingestion Svc    Kafka     Notification Svc    Rider App
    |                |             |              |                |
    |--{lat,lng}---->|             |              |                |
    |                |--publish--->|              |                |
    |                |             |--consume---->|                |
    |                |             |              |--lookup rider  |
    |                |             |              |  WebSocket     |
    |                |             |              |--WS push------>|
    |                |             |              |                |--update map pin
```

### Sequence 3: Dispatch — Find Nearest Driver

```
Rider App      API Gateway    Dispatch Svc       Redis              PostgreSQL
    |               |               |               |                    |
    |--POST /rides->|               |               |                    |
    |               |--route------->|               |                    |
    |               |               |--GEORADIUS--->|                    |
    |               |               |<--[d1,d2,d3]--|                    |
    |               |               |--GET status:d1,d2,d3-->|           |
    |               |               |<--[AVAILABLE,ON_TRIP,AVAILABLE]----|
    |               |               |--INSERT trip----------------->|    |
    |               |               |<--trip_id--------------------|    |
    |<--201 trip----|               |                                    |
```
