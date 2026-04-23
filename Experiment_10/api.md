# API Design — Real-Time Location Tracking System

## API Versioning Strategy

All APIs are versioned via the URL path prefix: `/api/v1/`. When a breaking change is introduced, a new version (`/api/v2/`) is deployed alongside the old one. Both versions run simultaneously for a deprecation window of 6 months. Clients receive a `Deprecation` response header on v1 endpoints once v2 is live, giving them time to migrate.

Non-breaking changes (adding optional fields, new endpoints) are made in-place without a version bump.

---

## Rate Limiting Strategy

Rate limits are enforced at the API Gateway (Kong) layer using a sliding window algorithm.

| Client Type | Limit |
|---|---|
| Driver app (location updates) | 60 requests/minute per driver_id |
| Rider app (trip queries) | 120 requests/minute per rider_id |
| Internal services | No limit (bypass via internal network) |
| Unauthenticated requests | 10 requests/minute per IP |

When a limit is exceeded, the gateway returns `429 Too Many Requests` with a `Retry-After` header indicating when the client may retry.

---

## Idempotency Handling

For state-mutating operations (POST, PATCH), clients must include an `Idempotency-Key` header (a UUID generated client-side). The server stores the response for each key for 24 hours. If the same key is received again (e.g., due to a network retry), the cached response is returned without re-executing the operation. This prevents duplicate trip creation or double status updates.

---

## Authentication

All endpoints require a valid JWT Bearer token in the `Authorization` header. Tokens are issued by the Auth Service (out of scope) and validated at the API Gateway before the request reaches any downstream service.

---

## Endpoints

### 1. Update Driver Location

Used by the driver mobile app. In practice this happens over WebSocket, but a REST fallback exists for environments where WebSockets are unavailable.

```
POST /api/v1/drivers/{driver_id}/location
```

Request Headers:
```
Authorization: Bearer <jwt_token>
Content-Type: application/json
Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000
```

Request Body:
```json
{
  "lat": 28.6139,
  "lng": 77.2090,
  "timestamp": "2024-11-15T10:30:00.000Z",
  "speed_kmh": 32.5,
  "heading_deg": 270,
  "accuracy_meters": 4.2
}
```

Response `200 OK`:
```json
{
  "status": "accepted",
  "server_timestamp": "2024-11-15T10:30:00.051Z"
}
```

Response `400 Bad Request` (invalid coordinates):
```json
{
  "error": "INVALID_COORDINATES",
  "message": "lat must be between -90 and 90",
  "field": "lat"
}
```

Response `429 Too Many Requests`:
```json
{
  "error": "RATE_LIMIT_EXCEEDED",
  "message": "Location update limit reached. Max 60 updates per minute.",
  "retry_after_seconds": 12
}
```

---

### 2. Get Driver's Current Location

Used by the Dispatch Service and rider app to fetch the latest known position of a specific driver.

```
GET /api/v1/drivers/{driver_id}/location
```

Request Headers:
```
Authorization: Bearer <jwt_token>
```

Response `200 OK`:
```json
{
  "driver_id": "d7f3a1b2-...",
  "lat": 28.6139,
  "lng": 77.2090,
  "heading_deg": 270,
  "speed_kmh": 32.5,
  "status": "ON_TRIP",
  "last_updated": "2024-11-15T10:30:00.000Z",
  "staleness_seconds": 2
}
```

Response `404 Not Found` (driver offline or unknown):
```json
{
  "error": "DRIVER_NOT_FOUND",
  "message": "No active location data found for this driver"
}
```

---

### 3. Get Nearby Available Drivers

Used by the Dispatch Service when a rider requests a ride. Returns drivers sorted by distance ascending.

```
GET /api/v1/drivers/nearby?lat=28.6139&lng=77.2090&radius_km=5&limit=10&vehicle_type=CAR
```

Request Headers:
```
Authorization: Bearer <jwt_token>
```

Query Parameters:
| Parameter | Type | Required | Description |
|---|---|---|---|
| lat | float | yes | Pickup latitude |
| lng | float | yes | Pickup longitude |
| radius_km | float | no | Search radius, default 5, max 20 |
| limit | int | no | Max results, default 10, max 50 |
| vehicle_type | string | no | Filter by BIKE, CAR, or AUTO |

Response `200 OK`:
```json
{
  "drivers": [
    {
      "driver_id": "d7f3a1b2-...",
      "lat": 28.6145,
      "lng": 77.2085,
      "distance_km": 0.82,
      "vehicle_type": "CAR",
      "estimated_arrival_minutes": 3
    },
    {
      "driver_id": "a1c9e3f0-...",
      "lat": 28.6201,
      "lng": 77.2110,
      "distance_km": 1.43,
      "vehicle_type": "CAR",
      "estimated_arrival_minutes": 5
    }
  ],
  "total": 2,
  "search_radius_km": 5
}
```

Response `200 OK` (no drivers found):
```json
{
  "drivers": [],
  "total": 0,
  "search_radius_km": 5,
  "message": "No available drivers in this area"
}
```

---

### 4. Update Driver Status

Allows a driver to go online, go offline, or transition to on-trip state.

```
PATCH /api/v1/drivers/{driver_id}/status
```

Request Headers:
```
Authorization: Bearer <jwt_token>
Content-Type: application/json
Idempotency-Key: 7c9e6679-7425-40de-944b-e07fc1f90ae7
```

Request Body:
```json
{
  "status": "AVAILABLE"
}
```

Valid status transitions:
- `OFFLINE` → `AVAILABLE` (driver goes online)
- `AVAILABLE` → `ON_TRIP` (trip assigned)
- `ON_TRIP` → `AVAILABLE` (trip completed)
- `AVAILABLE` → `OFFLINE` (driver goes offline)

Response `200 OK`:
```json
{
  "driver_id": "d7f3a1b2-...",
  "previous_status": "OFFLINE",
  "current_status": "AVAILABLE",
  "updated_at": "2024-11-15T10:25:00.000Z"
}
```

Response `409 Conflict` (invalid transition):
```json
{
  "error": "INVALID_STATUS_TRANSITION",
  "message": "Cannot transition from ON_TRIP to OFFLINE directly. Complete the trip first.",
  "current_status": "ON_TRIP",
  "requested_status": "OFFLINE"
}
```

---

### 5. Get Driver Location History (Trip Replay)

Returns the full location trail for a driver during a specific trip. Used for dispute resolution and route auditing.

```
GET /api/v1/trips/{trip_id}/location-history?from=2024-11-15T10:00:00Z&to=2024-11-15T10:45:00Z
```

Request Headers:
```
Authorization: Bearer <jwt_token>
```

Response `200 OK`:
```json
{
  "trip_id": "t9b2c4d1-...",
  "driver_id": "d7f3a1b2-...",
  "total_points": 312,
  "from": "2024-11-15T10:00:00.000Z",
  "to": "2024-11-15T10:45:00.000Z",
  "locations": [
    {
      "lat": 28.6139,
      "lng": 77.2090,
      "speed_kmh": 0,
      "recorded_at": "2024-11-15T10:00:00.000Z"
    },
    {
      "lat": 28.6142,
      "lng": 77.2093,
      "speed_kmh": 12.3,
      "recorded_at": "2024-11-15T10:00:04.000Z"
    }
  ]
}
```

---

## HTTP Status Code Reference

| Code | Meaning | When Used |
|---|---|---|
| 200 | OK | Successful GET or PATCH |
| 201 | Created | Successful resource creation (trips) |
| 400 | Bad Request | Invalid input, missing fields, bad coordinates |
| 401 | Unauthorized | Missing or invalid JWT token |
| 403 | Forbidden | Valid token but insufficient permissions |
| 404 | Not Found | Driver/trip does not exist or is offline |
| 409 | Conflict | Invalid state transition, duplicate resource |
| 429 | Too Many Requests | Rate limit exceeded |
| 500 | Internal Server Error | Unexpected server-side failure |
| 503 | Service Unavailable | Downstream dependency (Redis/Kafka) is down |
