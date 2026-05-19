# Local Development Guide

For the broader contributor workflow, see `docs/development.md`. This file keeps
the local stack notes and API curl examples together.

## Prerequisites

| Tool           | Version | Purpose                                       |
| -------------- | ------- | --------------------------------------------- |
| Docker         | 24+     | Container runtime for infrastructure services |
| Docker Compose | v2+     | Multi-container orchestration                 |
| Node.js        | 20+     | JavaScript runtime for API and Web apps       |
| npm            | 9+      | Package manager (ships with Node.js)          |

Verify your environment:

```bash
docker --version
docker compose version
node --version
npm --version
```

## Setup Steps

### 1. Clone the repository

```bash
git clone <repository-url>
cd RootPilot
```

### 2. Install dependencies

```bash
npm ci
```

This installs all workspace dependencies from `package-lock.json`, including
`apps/api`, `apps/web`, and `packages/shared`.

### 3. Start database services

```bash
docker compose -f infra/docker-compose.yml up -d postgres clickhouse
```

This starts:

| Service    | Port                       | Description                         |
| ---------- | -------------------------- | ----------------------------------- |
| Postgres   | 5432                       | Tenant metadata, projects, API keys |
| ClickHouse | 8123 (HTTP), 9000 (native) | Telemetry storage                   |

`infra/docker-compose.yml` also defines API and Web services, but this checkout
does not include `apps/api/Dockerfile` or `apps/web/Dockerfile`. Run the app
servers locally unless adding those Dockerfiles is part of your task.

### 4. Initialize databases (alternative to Docker init)

If running the API outside Docker (e.g., during development), initialize the databases manually:

```bash
npm run db:init
```

This creates the required tables in both Postgres and ClickHouse.

### 5. Seed sample data

```bash
npm run seed
```

This populates the system with:

- A demo tenant (name: "demo", slug: "demo")
- A default project (name: "default", slug: "default")
- A demo API key: `rootpilot_demo_key`
- 50+ sample log entries across multiple services and severities
- 10+ distributed traces with multiple spans each
- 20+ metric data points
- 3+ deployment events

### 6. Verify the setup

Confirm each service is responding:

```bash
# API health check
curl http://localhost:4000/health

# Web UI (should return HTML)
curl -s http://localhost:3000 | head -20

# Verify authentication works
curl -s http://localhost:4000/v1/logs \
  -H "X-API-Key: rootpilot_demo_key" | head -100
```

## Stopping Services

```bash
docker compose -f infra/docker-compose.yml down
```

To also remove stored data volumes:

```bash
docker compose -f infra/docker-compose.yml down -v
```

## Development Workflow

Run Postgres and ClickHouse in Docker and the apps locally:

```bash
# Start only databases
docker compose -f infra/docker-compose.yml up -d postgres clickhouse

# Terminal 1: API
npm run dev --workspace=apps/api

# Terminal 2: Web UI
npm run dev --workspace=apps/web
```

The web dev server proxies `/api/*` requests to `http://localhost:4000` by default. If
you run the API on another port for local testing, set `API_PROXY_TARGET`, for example:

```bash
API_PROXY_TARGET=http://localhost:4010 npm run dev --workspace=apps/web -- --port 3001
```

## Running Tests

```bash
npm run test
```

API tests use Fastify `inject()` for HTTP assertions. Most route tests mock the
Postgres and ClickHouse clients, so the unit suite does not require live local
database instances.

## Linting

```bash
npm run lint
```

---

## API Endpoint Reference

All endpoints require the `X-API-Key` header for authentication. Use the demo key `rootpilot_demo_key` for local development.

### Ingestion Endpoints

#### Ingest Logs

```bash
curl -X POST http://localhost:4000/v1/ingest/logs \
  -H "Content-Type: application/json" \
  -H "X-API-Key: rootpilot_demo_key" \
  -d '{
    "resourceLogs": [{
      "resource": {
        "attributes": [
          { "key": "service.name", "value": { "stringValue": "checkout-service" } },
          { "key": "deployment.environment", "value": { "stringValue": "production" } }
        ]
      },
      "scopeLogs": [{
        "logRecords": [{
          "timeUnixNano": "1700000000000000000",
          "severityNumber": 9,
          "body": { "stringValue": "Order processed successfully" },
          "attributes": [
            { "key": "order.id", "value": { "stringValue": "ord-12345" } }
          ]
        }]
      }]
    }]
  }'
```

#### Ingest Traces

```bash
curl -X POST http://localhost:4000/v1/ingest/traces \
  -H "Content-Type: application/json" \
  -H "X-API-Key: rootpilot_demo_key" \
  -d '{
    "resourceSpans": [{
      "resource": {
        "attributes": [
          { "key": "service.name", "value": { "stringValue": "api-gateway" } },
          { "key": "deployment.environment", "value": { "stringValue": "production" } }
        ]
      },
      "scopeSpans": [{
        "spans": [{
          "traceId": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
          "spanId": "1234567890abcdef",
          "parentSpanId": "",
          "name": "GET /api/orders",
          "kind": 2,
          "startTimeUnixNano": "1700000000000000000",
          "endTimeUnixNano": "1700000000150000000",
          "status": { "code": 1 },
          "attributes": [
            { "key": "http.method", "value": { "stringValue": "GET" } },
            { "key": "http.status_code", "value": { "intValue": "200" } }
          ]
        }]
      }]
    }]
  }'
```

#### Ingest Metrics

```bash
curl -X POST http://localhost:4000/v1/ingest/metrics \
  -H "Content-Type: application/json" \
  -H "X-API-Key: rootpilot_demo_key" \
  -d '{
    "resourceMetrics": [{
      "resource": {
        "attributes": [
          { "key": "service.name", "value": { "stringValue": "payment-service" } },
          { "key": "deployment.environment", "value": { "stringValue": "production" } }
        ]
      },
      "scopeMetrics": [{
        "metrics": [{
          "name": "http.request.duration",
          "unit": "ms",
          "gauge": {
            "dataPoints": [{
              "timeUnixNano": "1700000000000000000",
              "asDouble": 42.5,
              "attributes": [
                { "key": "http.method", "value": { "stringValue": "POST" } }
              ]
            }]
          }
        }]
      }]
    }]
  }'
```

#### Ingest Deployment Events

```bash
curl -X POST http://localhost:4000/v1/events/deployments \
  -H "Content-Type: application/json" \
  -H "X-API-Key: rootpilot_demo_key" \
  -d '{
    "service_name": "checkout-service",
    "environment": "production",
    "version": "1.4.2",
    "git_sha": "abc123def456",
    "deployed_by": "ci-pipeline",
    "provider": "github-actions",
    "metadata": {
      "pr_number": 142,
      "branch": "main"
    }
  }'
```

### Query Endpoints

#### Query Logs

```bash
curl -s "http://localhost:4000/v1/logs?limit=10&severity=ERROR" \
  -H "X-API-Key: rootpilot_demo_key"
```

With time range and service filter:

```bash
curl -s "http://localhost:4000/v1/logs?from=2024-01-01T00:00:00Z&to=2024-12-31T23:59:59Z&service_name=checkout-service&limit=20" \
  -H "X-API-Key: rootpilot_demo_key"
```

With trace, message, and attribute filters:

```bash
curl -s "http://localhost:4000/v1/logs?trace_id=trace_123&search=timeout&attribute_filters=%5B%7B%22key%22%3A%22http.route%22%2C%22value%22%3A%22%2Fapi%2Fcheckout%22%7D%5D" \
  -H "X-API-Key: rootpilot_demo_key"
```

Fetch logs around a known event:

```bash
curl -s "http://localhost:4000/v1/logs/around?timestamp=2024-01-15T10:00:00Z&service=checkout-service&environment=production&before_seconds=300&after_seconds=300" \
  -H "X-API-Key: rootpilot_demo_key"
```

Group logs by fingerprint. The grouping endpoint accepts the same filters as
`/v1/logs`; `service` is also accepted as a backward-compatible alias for
`service_name`:

```bash
curl -s "http://localhost:4000/v1/logs/groups?service_name=checkout-service&severity=ERROR&trace_id=trace_123&search=timeout" \
  -H "X-API-Key: rootpilot_demo_key"
```

#### Query Traces

List trace summaries:

```bash
curl -s "http://localhost:4000/v1/traces?limit=10" \
  -H "X-API-Key: rootpilot_demo_key"
```

Get all spans for a specific trace:

```bash
curl -s "http://localhost:4000/v1/traces/a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4" \
  -H "X-API-Key: rootpilot_demo_key"
```

Filter by minimum duration:

```bash
curl -s "http://localhost:4000/v1/traces?minDuration=100&service=api-gateway" \
  -H "X-API-Key: rootpilot_demo_key"
```

#### Query Metrics

List metric names:

```bash
curl -s "http://localhost:4000/v1/metrics/names" \
  -H "X-API-Key: rootpilot_demo_key"
```

Raw data points:

```bash
curl -s "http://localhost:4000/v1/metrics?metric_name=http.request.duration" \
  -H "X-API-Key: rootpilot_demo_key"
```

With aggregation:

```bash
curl -s "http://localhost:4000/v1/metrics?metric_name=http.request.duration&interval=5m&aggregation=avg&service=payment-service" \
  -H "X-API-Key: rootpilot_demo_key"
```

Metric catalog:

```bash
curl -s "http://localhost:4000/v1/metrics/catalog" \
  -H "X-API-Key: rootpilot_demo_key"
```

Multi-series metric query:

```bash
curl -s "http://localhost:4000/v1/metrics/http.server.request.duration/series?from=2026-05-18T11:00:00Z&to=2026-05-18T12:00:00Z&interval=1m&aggregation=p95&group_by=service_name" \
  -H "X-API-Key: rootpilot_demo_key"
```

Top services for a metric:

```bash
curl -s "http://localhost:4000/v1/metrics/http.server.request.duration/top-services?from=2026-05-18T11:00:00Z&to=2026-05-18T12:00:00Z" \
  -H "X-API-Key: rootpilot_demo_key"
```

#### Query Services

```bash
curl -s "http://localhost:4000/v1/services" \
  -H "X-API-Key: rootpilot_demo_key"
```

#### Query Deployments

```bash
curl -s "http://localhost:4000/v1/deployments?limit=10" \
  -H "X-API-Key: rootpilot_demo_key"
```

With filters:

```bash
curl -s "http://localhost:4000/v1/deployments?service=checkout-service&environment=production&limit=5" \
  -H "X-API-Key: rootpilot_demo_key"
```
