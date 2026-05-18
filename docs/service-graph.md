# Service Graph

RootPilot's service graph is built from spans. When a child span belongs to a
different service than its parent span in the same trace, RootPilot infers a
dependency edge.

Example:

```text
checkout-service span
  payment-service child span
```

becomes:

```text
checkout-service -> payment-service
```

## Refresh

```bash
npm run graph:build -- --from now-1h --to now
```

The graph builder:

- Scans recent ClickHouse spans.
- Infers cross-service parent/child relationships.
- Aggregates call count, error count, average duration, p95 duration, and last
  seen time.
- Updates `service_dependencies`.
- Updates `service_summaries.dependency_count`.

## API

```text
GET /v1/service-map
GET /v1/services
GET /v1/services/:serviceName
GET /v1/services/:serviceName/dependencies
GET /v1/services/:serviceName/upstream
GET /v1/services/:serviceName/downstream
GET /v1/services/:serviceName/health
GET /v1/services/:serviceName/timeline
```

Every route requires `X-API-Key` and filters by the resolved `tenant_id` and
`project_id`.

## UI

Open `/service-map` after running:

```bash
npm run simulate:graph
npm run phase2:refresh -- --from now-2h --to now
```

Click a node to open service detail. Click an edge to inspect call volume,
errors, latency, and an example trace.
