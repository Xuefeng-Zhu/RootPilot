# RootPilot

RootPilot is an OpenTelemetry-native observability app. It provides a
Fastify API for telemetry ingestion/querying, ClickHouse storage for logs,
spans, metrics, and deployment events, Postgres metadata for tenants/projects/API
keys, and a Next.js UI for exploring service health, service maps, deployments,
error groups, logs, traces, and metrics.

## Quick Start

```bash
npm ci
docker compose -f infra/docker-compose.yml up -d postgres clickhouse
npm run db:init
npm run db:migrate
npm run dev --workspace=apps/api
npm run dev --workspace=apps/web
```

In another terminal, after the API is running:

```bash
npm run seed
npm run simulate -- --once
npm run phase2:refresh -- --from now-2h --to now
```

Open `http://localhost:3000`.

## Useful Commands

```bash
npm test
npm run lint
npm run build --workspace=apps/api
npm run build --workspace=apps/web
npm run build --workspace=apps/simulator
npm run typecheck --workspace=packages/shared
npm run simulate:bad-deploy -- --duration 10m --rate 30
npm run phase2:refresh -- --from now-2h --to now
```

## Documentation

- Agent and maintainer guide: `AGENTS.md`
- Architecture: `docs/architecture.md`
- Development setup: `docs/development.md`
- Local API examples: `docs/local-development.md`
- Telemetry simulator: `docs/simulator.md`
- Phase 2 service graph and correlation ADR: `docs/adr/0002-service-graph-correlation-layer.md`
- Service graph: `docs/service-graph.md`
- Correlation: `docs/correlation.md`
- Testing: `docs/testing.md`
- Security: `docs/security.md`
- Release notes: `docs/release.md`
- Troubleshooting: `docs/troubleshooting.md`
- Contributing: `docs/contributing.md`
- Product overview: `docs/product-overview.md`
- Agent workflow: `docs/agent-workflow.md`
- Phase 1 observability core ADR: `docs/adr/0001-observability-core-scope.md`

## Current Limitations

- `infra/docker-compose.yml` references API and Web Dockerfiles, but those
  Dockerfiles are not present in this checkout.
- No CI or deployment pipeline is present.
- The demo UI uses the local demo key `rootpilot_demo_key`.
