# RootPilot UI Design

RootPilot uses a dark, dense, developer-focused interface for observability workflows. The product should feel like a serious enterprise SaaS tool for SREs and platform engineers: fast to scan, compact, precise, and original to RootPilot rather than a copy of another observability vendor.

## UI Principles

- Lead with telemetry context: service health, deployment impact, error groups, logs, traces, metrics, and dependency relationships should always be close together.
- Prefer dense but readable dashboards over marketing-style layouts.
- Use dark slate surfaces, subtle borders, compact spacing, and clear hover or selected states.
- Make drilldowns obvious: service names, trace IDs, deployment IDs, and error groups should link to their investigation pages.
- Empty states should explain the next useful local command, especially simulator and correlation refresh commands.

## Color And Status System

- Background: near-black slate (`surface.DEFAULT`).
- Panels: dark slate (`surface.card`, `surface.raised`, `surface.subtle`).
- Borders: muted slate (`surface.border`).
- Primary accent: teal/cyan for product actions and graph traffic.
- Secondary accents: blue for logs/volume, purple for traces/infra, amber for warning/latency, red for critical/errors, green for healthy/success.
- Status mapping:
  - Healthy: green
  - Warning: amber
  - Critical/degraded/error: red
  - Unknown/disabled: gray

## Pages And Components

Primary pages:

- Overview
- Service Map
- Logs
- Traces and trace detail
- Metrics
- Services and service detail
- Deployments and deployment impact
- Error Groups and error group detail
- Settings

Reusable components live under `apps/web/src/components`:

- App shell, sidebar, and header
- Page title, panels, stat cards, status/health badges
- Search/time/environment controls
- Empty/loading/error states
- Copy button, sparkline, service health bar
- Lightweight data table, drawer, metric line chart, trace waterfall, service map container, and facet sidebar

## Data Dependencies

The UI uses real backend APIs first:

- `/v1/services`
- `/v1/service-map`
- `/v1/logs`
- `/v1/traces`
- `/v1/metrics/catalog`
- `/v1/metrics/:metricName/series`
- `/v1/deployments`
- `/v1/error-groups`

Small deterministic mock utilities are allowed only for UI-only chart scaffolding or empty-demo polish when a backend endpoint does not expose the exact visual shape yet. Keep those utilities isolated in `apps/web/src/lib/mock-data` so they can be removed later.

## Demo Flow

1. Start Postgres and ClickHouse.
2. Run `npm run db:init` and `npm run db:migrate` if needed.
3. Start API and Web in separate terminals.
4. Run `npm run seed`.
5. Run `npm run simulate:bad-deploy -- --duration 10m --rate 30`.
6. Run `npm run correlations:refresh -- --from now-2h --to now`.
7. Open Overview, then Service Map.
8. Click `checkout-service`.
9. Open Logs and filter `severity=ERROR`.
10. Open a related trace.
11. Open Metrics for checkout latency or error metrics.
12. Open Deployment Impact.

## Known Limitations

- RootPilot currently prioritizes desktop and tablet-width observability workflows.
- Some overview chart series use deterministic UI scaffolding until dedicated dashboard summary endpoints exist.
- There is no shared query persistence for metrics yet.
- Deployment and error group pages use deterministic correlation, not root-cause analysis.

## Future UI Ideas

- AI investigator side panel tied to logs, traces, deployments, and error groups.
- Saved investigation workspaces.
- Incident timeline and notebook views.
- Compare windows and deployment overlays across all charts.
- Service ownership and runbook metadata.
