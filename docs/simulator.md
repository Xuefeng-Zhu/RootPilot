# Telemetry Simulator

The RootPilot telemetry simulator generates local Phase 1 observability data so
the UI feels alive and the ingest/query pipeline can be tested without wiring a
real application.

It sends realistic, correlated telemetry to the existing RootPilot endpoints:

- `POST /v1/ingest/logs`
- `POST /v1/ingest/traces`
- `POST /v1/ingest/metrics`
- `POST /v1/events/deployments`

Logs, traces, and metrics use RootPilot's current OTLP-style Phase 1 JSON
format. Deployment events use RootPilot's custom JSON format. This simulator
does not implement OTLP protobuf ingestion.

## Setup

Start RootPilot locally:

```bash
npm ci
docker compose -f infra/docker-compose.yml up -d postgres clickhouse
npm run db:init
npm run dev --workspace=apps/api
npm run dev --workspace=apps/web
npm run seed
```

Then run the simulator from the repo root:

```bash
npm run simulate
```

Defaults:

- API base URL: `http://localhost:4000`
- API key: `rootpilot_demo_key`
- tenant/project labels: `demo` / `default`
- environment: `production`
- scenario: `normal`
- duration: `5m`
- rate: `20` simulated request units per second

## Commands

```bash
npm run simulate
npm run simulate -- --scenario normal --duration 5m --rate 20
npm run simulate -- --scenario checkout-error --duration 10m --rate 50
npm run simulate -- --scenario bad-deploy --duration 10m --rate 30
npm run simulate -- --scenario database-degradation --duration 10m --rate 30
npm run simulate -- --scenario cache-miss-storm --duration 10m --rate 30
npm run simulate -- --scenario high-cardinality --duration 3m --rate 100
npm run simulate -- --scenario multi-service --duration 15m --rate 40
npm run simulate -- --once
npm run simulate:dry-run
```

Useful flags:

```bash
--base-url http://localhost:4000
--api-key rootpilot_demo_key
--secondary-api-key another_seeded_key
--environment production
--services checkout-service,payment-service
--seed 123
--verbose
--dry-run
--once
```

## Scenarios

| Scenario               | Behavior                                                                                     |
| ---------------------- | -------------------------------------------------------------------------------------------- |
| `normal`               | Healthy traffic, low error rate, all services active.                                        |
| `checkout-error`       | Checkout failures, payment latency, timeout logs, elevated `checkout.error_rate`.            |
| `bad-deploy`           | Emits a checkout deployment event, then creates a clear latency/error spike.                 |
| `database-degradation` | Slow Postgres queries, slower order creation, slow-query warnings.                           |
| `cache-miss-storm`     | Redis miss spike and slower search/recommendation services.                                  |
| `high-cardinality`     | Intentionally noisy `user_id`, `session_id`, and `request_id` labels.                        |
| `multi-service`        | Broad traffic across the full service topology.                                              |
| `multi-tenant`         | Uses `--secondary-api-key` when a second seeded key exists; otherwise prints setup guidance. |

`multi-tenant` does not create tenants or API keys automatically. To test
isolation, seed a second tenant/project/API key in Postgres, then run:

```bash
npm run simulate -- --scenario multi-tenant --api-key rootpilot_demo_key --secondary-api-key <second_key>
```

The simulator models this service topology:

```text
api-gateway -> auth-service
api-gateway -> checkout-service
checkout-service -> inventory-service
checkout-service -> payment-service
checkout-service -> order-service
order-service -> postgres-db
order-service -> kafka-broker
notification-service -> kafka-broker
search-service -> redis-cache
recommendation-service -> redis-cache
```

## Example Output

```text
[simulator] RootPilot telemetry simulator
[simulator] scenario=bad-deploy baseUrl=http://localhost:4000 environment=production
[simulator] rate=30/s duration=10m dryRun=false
[simulator] progress elapsed=5s logs=420 spans=240 metrics=690 deployments=1 failedRequests=0
[simulator] Final summary
  scenario: bad-deploy
  logs sent: 50400
  spans sent: 28800
  metrics sent: 82800
  deployment events sent: 1
  services generated: api-gateway, auth-service, checkout-service, ...
  errors generated: 7200
  failed HTTP requests: 0
```

## What To Inspect

After running a scenario, open the local web app and inspect:

- Overview: service counts, signal counts, recent deployments, and errors.
- Logs: service, environment, severity, search, and time range filters.
- Traces: slow/error traces and trace detail waterfalls.
- Metrics: metric names and time-range aggregation.
- Services: discovered service catalog and health indicators.

For `bad-deploy`, look for version `v1.4.2`, the deployment event, and the log
message `PaymentProviderTimeout: timeout exceeded after 500ms`.

## Troubleshooting

If the API is unreachable:

```text
RootPilot API is not reachable at http://localhost:4000.
```

Start local services and the API:

```bash
docker compose -f infra/docker-compose.yml up -d postgres clickhouse
npm run dev --workspace=apps/api
```

If the API key is rejected, seed local metadata:

```bash
npm run seed
```

If a payload is rejected with `400`, rerun with:

```bash
npm run simulate -- --once --dry-run --verbose
```

That prints the exact generated payloads without sending them.

## Phase 1 And Future Evolution

For Phase 1, the simulator validates ingestion APIs, ClickHouse telemetry
storage, Postgres-backed tenant/API-key auth, service discovery, UI filters, and
tenant-scoped query behavior.

For Phase 2, the same scenario patterns can become deterministic AI
investigation fixtures. The `bad-deploy`, `checkout-error`,
`database-degradation`, and `cache-miss-storm` scenarios already produce
correlated data that can support future root-cause workflows.

RootPilot may later support full OTLP protobuf ingestion. At that point, tools
such as OpenTelemetry `telemetrygen` and the OpenTelemetry Demo can complement
this local simplified simulator for protocol compatibility testing.
