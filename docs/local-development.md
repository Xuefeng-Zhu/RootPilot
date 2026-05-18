# Local Development Guide

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Docker | 24+ | Container runtime for infrastructure services |
| Docker Compose | v2+ | Multi-container orchestration |
| Node.js | 20+ | JavaScript runtime for API and Web apps |
| npm | 9+ | Package manager (ships with Node.js) |

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
npm install
```

This installs all workspace dependencies including `apps/api`, `apps/web`, and `packages/shared`.

### 3. Start infrastructure services

```bash
docker compose -f infra/docker-compose.yml up -d
```

This starts:

| Service | Port | Description |
|---------|------|-------------|
| Postgres | 5432 | Tenant metadata, projects, API keys |
| ClickHouse | 8123 (HTTP), 9000 (native) | Telemetry storage |
| API | 4000 | Ingestion and Query API (Fastify) |
| Web UI | 3000 | Frontend application (Next.js) |

Services start in dependency order — Postgres and ClickHouse must be healthy before the API starts, and the API must be healthy before the Web UI starts.

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

For active development without Docker for the app services, run Postgres and ClickHouse in Docker and the apps locally:

```bash
# Start only databases
docker compose -f infra/docker-compose.yml up -d postgres clickhouse

# Run API and Web in dev mode
npm run dev
```

## Running Tests

```bash
npm run test
```

Tests use Fastify `inject()` for HTTP assertions and run against the local database instances.

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
