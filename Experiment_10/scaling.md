# Scalability & Reliability — Real-Time Location Tracking System

## 1. Load Balancing Strategy

### Layer 1 — DNS Load Balancing (Global)
At the outermost layer, AWS Route 53 (or Cloudflare) uses latency-based routing to direct users to the nearest regional deployment (e.g., a driver in Mumbai hits the Asia-Pacific region, not US-East). This reduces baseline latency by 100–200ms before a single line of application code runs.

### Layer 2 — API Gateway (L7 Load Balancing)
Kong API Gateway distributes HTTP and WebSocket traffic across Ingestion Service instances using a **least-connections** algorithm rather than round-robin. This is critical for WebSocket servers because connections are long-lived — a round-robin approach would unevenly distribute load as connections accumulate on older instances.

### Layer 3 — Internal Service Mesh (L4)
Internal service-to-service calls (e.g., Dispatch Service → Redis) use a service mesh (AWS App Mesh or Istio) with round-robin load balancing. Since these are short-lived RPC calls, round-robin is appropriate and simpler.

### WebSocket Sticky Sessions
WebSocket connections require that a client always reconnects to the same server instance (or any instance, since state is in Redis). We use Redis Pub/Sub as a shared backplane — when a rider's location update arrives at Ingestion Instance A, it publishes to a Redis channel. Ingestion Instance B (which holds the rider's WebSocket) subscribes to that channel and forwards the message. This means there is no sticky session requirement, and any instance can serve any client.

---

## 2. Horizontal vs Vertical Scaling

### Horizontal Scaling (Chosen for most services)

| Service | Scaling Trigger | Max Instances |
|---|---|---|
| Location Ingestion Service | WebSocket connection count > 40,000 per pod | Unlimited |
| Location Processor (Kafka Consumer) | Consumer lag > 10,000 messages | = Number of Kafka partitions (100) |
| Notification Service | Message processing latency > 200ms | = Number of Kafka partitions (100) |
| Dispatch Service | CPU > 70% | 50 |

Horizontal scaling is preferred because:
- It provides fault isolation (one crashed pod does not affect others)
- It is cheaper at scale (many small machines vs one giant machine)
- Kubernetes handles it automatically via Horizontal Pod Autoscaler (HPA)

### Vertical Scaling (Used selectively)

| Component | Why Vertical |
|---|---|
| Redis primary node | Redis is single-threaded; more CPU cores do not help. A larger instance with more RAM holds more geo data in memory |
| PostgreSQL primary | Write throughput on a single primary benefits from faster CPU and NVMe SSDs before resorting to sharding |
| Kafka brokers | Higher memory allows larger page cache, reducing disk I/O for consumers reading recent messages |

Vertical scaling has a ceiling and a single point of failure risk. It is used only where horizontal scaling is architecturally complex (e.g., Redis single-threaded model) or where the workload is inherently single-node (PostgreSQL primary writes).

---

## 3. Caching Strategy

### Redis — Live Location Cache (Primary Cache)
Every driver's current position is stored in Redis. Reads for "find nearby drivers" never touch PostgreSQL or Cassandra. This is the most critical cache in the system.

- Cache population: Location Processor writes to Redis on every Kafka event consumed
- Cache invalidation: Driver status key has a 300-second TTL. If a driver goes silent (app crash, no network), their status auto-expires and they are removed from the available pool
- Cache miss behavior: If a driver's location is not in Redis (e.g., after a Redis restart), the system returns a 404 for that driver's live location. The driver's next GPS ping will repopulate the cache within 3–5 seconds

### Application-Level Cache — Dispatch Service
The Dispatch Service caches the result of `GEORADIUS` queries for 2 seconds using an in-memory LRU cache. This prevents Redis from being hammered when multiple riders in the same area request rides simultaneously. A 2-second stale driver list is acceptable for dispatch purposes.

### What We Do NOT Cache
Trip status and payment data are never cached at the application layer. These must always be read from PostgreSQL to ensure consistency. Serving a stale "trip completed" status to a rider would be a serious UX and billing error.

---

## 4. Database Scaling

### Redis — Cluster Mode with Geo Sharding
Redis Cluster splits the keyspace into 16,384 hash slots distributed across multiple master nodes. For the `driver_locations` geo sorted set, we shard by geographic region:

```
Shard 1 (Asia-Pacific):  driver_locations:apac
Shard 2 (North America): driver_locations:na
Shard 3 (Europe):        driver_locations:eu
```

Each shard has 2 replicas for read scaling and failover. A driver is assigned to a shard based on their registered region, not their current location (to avoid cross-shard moves during trips).

### Cassandra — Consistent Hashing + Replication
Cassandra natively distributes data across nodes using consistent hashing on the partition key (`driver_id`). No manual sharding is needed. Configuration:

- Replication factor: 3 (data exists on 3 nodes)
- Write consistency: `QUORUM` (2 of 3 nodes must acknowledge)
- Read consistency: `ONE` (fastest read; acceptable for historical data)
- Compaction strategy: `TimeWindowCompactionStrategy` — optimized for time-series data, groups SSTables by time window for efficient TTL expiry

### PostgreSQL — Read Replicas + Future Sharding
Current setup: 1 primary + 2 read replicas. All writes go to primary; all reads (trip history, driver profile lookups) go to replicas via PgBouncer connection pooling.

Future sharding plan (when single primary becomes a bottleneck):
- Shard `trips` table by `rider_id % N` using Citus extension
- `drivers` table remains unsharded (relatively small, ~10M rows)

### Kafka — Partition Strategy
The `location-events` topic has 100 partitions. Messages are keyed by `driver_id`, so all events for a given driver always go to the same partition in order. This guarantees that the Location Processor processes a driver's updates sequentially, preventing out-of-order writes to Redis.

100 partitions supports 100 parallel consumer instances, giving a theoretical max throughput of ~1M events/second (10,000 events/partition/second × 100 partitions).

---

## 5. Failure Handling

### Retry Strategy
All Kafka consumers use exponential backoff with jitter for retries:

```
Attempt 1: immediate
Attempt 2: 1 second
Attempt 3: 2 seconds
Attempt 4: 4 seconds
Attempt 5: dead-letter queue (DLQ)
```

After 5 failures, the message is moved to a `location-events-dlq` topic. An alert fires and an on-call engineer investigates. This prevents a single bad message from blocking the entire partition.

### Circuit Breaker — Ingestion Service → Kafka
If Kafka becomes unavailable, the Ingestion Service must not crash or block indefinitely. A circuit breaker (implemented via `opossum` library in Node.js) monitors Kafka write failures:

- **Closed state** (normal): All writes go to Kafka
- **Open state** (Kafka down): Writes are rejected immediately with a 503 response. Driver app retries after 5 seconds
- **Half-open state** (recovery probe): One request is allowed through. If it succeeds, circuit closes

This prevents the Ingestion Service from accumulating a backlog of in-flight requests that would exhaust memory.

### WebSocket Reconnection
Driver apps implement exponential backoff reconnection:
- Disconnect detected → wait 1s → reconnect attempt
- If failed → wait 2s → retry
- Cap at 30 seconds between attempts
- On reconnect, the app immediately sends the latest GPS coordinate to resync state

### Redis Failover
Redis Sentinel monitors the primary node. If the primary fails to respond within 5 seconds, Sentinel promotes a replica to primary automatically. During the ~10-second failover window, location writes fail gracefully (Kafka buffers them) and are replayed once Redis is back.

---

## 6. Identified Bottleneck + Solution

### Bottleneck: WebSocket Connection Limits per Server

A single Node.js process can handle approximately 50,000–65,000 concurrent WebSocket connections before file descriptor limits and memory pressure cause degradation. With 1 million active drivers, this requires at least 20 server instances at all times — and during peak hours (Friday evening, rain surge), this can spike to 30–40 instances.

The bottleneck is not CPU but memory: each WebSocket connection consumes ~50KB of memory for buffers and state. 50,000 connections × 50KB = ~2.5GB RAM per instance.

**Solution:**
1. Use Kubernetes HPA to scale Ingestion Service pods based on active connection count (custom metric exposed via Prometheus)
2. Pre-warm instances 15 minutes before predicted peak hours using scheduled scaling rules
3. Implement connection draining: before terminating a pod, send a `reconnect` signal to all connected clients so they gracefully migrate to other instances
4. Use `cluster` module in Node.js to utilize all CPU cores per pod, reducing the number of pods needed

### Bottleneck: Redis GEORADIUS Under Surge

During a surge event (e.g., concert ending, heavy rain), thousands of riders request rides simultaneously. Each request triggers a `GEORADIUS` query. Redis is single-threaded — 10,000 simultaneous `GEORADIUS` calls will queue up and latency spikes.

**Solution:**
1. Dispatch Service caches `GEORADIUS` results for 2 seconds in local LRU cache
2. Batch nearby-driver queries: instead of one query per rider, aggregate requests within a 500ms window and execute a single `GEORADIUS` for each unique pickup zone
3. Pre-compute available driver counts per geo-cell (H3 hexagonal grid) every 5 seconds and cache in Redis as a simple key — riders see approximate counts instantly without triggering a full geo query

---

## 7. Performance Optimizations

- **Binary protocol for WebSocket messages**: Use MessagePack instead of JSON for location payloads. A typical location update is ~120 bytes in JSON and ~60 bytes in MessagePack. At 300,000 updates/second, this saves ~18MB/s of network bandwidth
- **GPS coordinate precision**: Store lat/lng as 6 decimal places (1.1cm accuracy) instead of 8 (1.1mm). Saves ~20% storage in Cassandra with no practical accuracy loss for ride-hailing
- **Kafka batch compression**: Enable `lz4` compression on the `location-events` topic. Location data is highly repetitive (same driver, slightly different coordinates) and compresses at ~4:1 ratio, reducing broker disk usage by 75%
- **Connection pooling**: PgBouncer sits in front of PostgreSQL in transaction pooling mode, allowing 10,000 application connections to share 100 actual database connections
- **Async Cassandra writes**: The Location Processor writes to Cassandra asynchronously (fire-and-forget with error logging). It does not wait for Cassandra acknowledgment before processing the next Kafka message. This keeps consumer throughput high; Cassandra durability is ensured by its replication factor
