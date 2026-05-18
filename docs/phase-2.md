# Phase 2: Service Graph And Correlation

Phase 2 adds a deterministic correlation layer on top of RootPilot's Phase 1
telemetry ingest and query pipeline.

It supports:

- Discovered service summaries from logs, traces, metrics, and deployments.
- Dependency edges inferred from parent and child spans.
- Deterministic error grouping.
- Deployment before/after impact analysis.
- Service timelines for deployments, new errors, and spikes.
- UI drilldowns for service map, services, deployments, and error groups.

It intentionally does not include AI investigation, alerting, incidents, RUM,
synthetics, profiling, SIEM, or broad third-party integrations.

## Local Workflow

```bash
docker compose -f infra/docker-compose.yml up -d postgres clickhouse
npm run db:init
npm run db:migrate
npm run seed
npm run dev --workspace=apps/api
npm run dev --workspace=apps/web
```

Generate graph-friendly data and refresh Phase 2 aggregates:

```bash
npm run simulate:bad-deploy -- --duration 10m --rate 30
npm run phase2:refresh -- --from now-2h --to now
```

Open:

- `/service-map`
- `/services`
- `/error-groups`
- `/deployments`

## Commands

```bash
npm run graph:build -- --from now-1h --to now
npm run error-groups:build -- --from now-1h --to now
npm run deployments:analyze -- --from now-2h --to now
npm run correlations:refresh -- --from now-2h --to now
npm run phase2:refresh -- --from now-2h --to now
```

All refresh commands can also accept `--environment production`. Internal
builder queries preserve tenant and project scope.

## Data Model

Raw telemetry remains in ClickHouse:

- `logs`
- `spans`
- `metrics`
- `deployment_events`

Phase 2 aggregates are stored in Postgres:

- `service_summaries`
- `service_dependencies`
- `error_groups`
- `deployment_impacts`

The migration runner records applied files in `schema_migrations`.

## Health And Impact

Service health is deterministic:

- `degraded` when recent error rate or p95 latency is high.
- `warning` when there are recent warnings/errors or elevated latency.
- `healthy` when recent telemetry exists and error rate is low.
- `unknown` when telemetry is stale or missing.

Deployment impact compares a 30 minute before window against a 30 minute after
window. It records error count changes, p95 latency changes, new error group
count, risk level, signals, and example trace IDs.

## Limitations

- Aggregates are refreshed by local scripts, not a daemon.
- Dependency inference requires parent/child spans across services.
- Error grouping is deterministic and text-based, not semantic AI clustering.
- The service map uses a lightweight SVG layout tuned for local 8-12 service
  simulator scenarios.

## Phase 3 Direction

The Phase 2 outputs are designed to become stable inputs for a future AI
investigator: service graph edges, health summaries, error groups, deployment
impact summaries, and explainable timeline events.
