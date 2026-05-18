# Correlation

RootPilot provides deterministic correlation without AI-generated root cause
analysis.

## Error Grouping

Errors are grouped from:

- `ERROR` and `FATAL` logs.
- Spans with `status_code = ERROR`.

The fingerprint strategy:

- Lowercases stable text.
- Removes timestamps.
- Normalizes UUIDs, hex IDs, request IDs, user IDs, session IDs, trace IDs, and
  numbers.
- Hashes service name, route, operation, error type, and normalized message.

Run:

```bash
npm run error-groups:build -- --from now-1h --to now
```

APIs:

```text
GET /v1/error-groups
GET /v1/error-groups/:id
GET /v1/services/:serviceName/error-groups
```

## Deployment Impact

Deployment impact compares service telemetry before and after a deployment.
The default comparison window is 30 minutes before and 30 minutes after.

It calculates:

- Error count before and after.
- p95 latency before and after.
- New error groups after the deployment.
- Risk level.
- Human-readable deterministic signals.
- Example traces after the deployment.

Run:

```bash
npm run deployments:analyze -- --from now-2h --to now
```

APIs:

```text
GET /v1/deployments
GET /v1/deployments/:deploymentId
GET /v1/deployments/:deploymentId/impact
GET /v1/services/:serviceName/deployments
GET /v1/services/:serviceName/recent-changes
```

## Service Timeline

`GET /v1/services/:serviceName/timeline` returns mixed deterministic events:

- Deployment events.
- Service first seen.
- New error groups.
- Error spikes.
- Latency spikes.

The timeline is intended to explain why a service's health changed and provide
drilldowns into traces, logs, deployments, and error groups.
