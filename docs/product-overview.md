# Product Overview

RootPilot Phase 1 is a local-first observability core for exploring telemetry
from services. It focuses on ingestion, storage, query APIs, and a developer UI.

## Current User Flows

### Ingest telemetry

Developers can send:

- logs to `POST /v1/ingest/logs`
- traces to `POST /v1/ingest/traces`
- metrics to `POST /v1/ingest/metrics`
- deployment events to `POST /v1/events/deployments`

Requests authenticate with `X-API-Key`.

### View overview

The `/` page shows:

- summary counts from service aggregates
- recent deployments
- recent error logs

### Explore logs

The `/logs` page supports:

- time presets, custom time range, message search, and load-more pagination
- service, environment, severity, trace ID, span ID, error type, fingerprint,
  version, and attribute key/value filters
- a facet sidebar for top services, severities, environments, error types,
  HTTP routes, fingerprints, and versions
- a query summary bar with active filter chips and local saved queries
- structured log detail drawer with trace links, copy actions, nearby logs, and
  same-fingerprint drilldowns
- fingerprint group view and polling-based live tail mode

### Explore traces

The `/traces` page supports:

- time range filter
- service filter
- minimum duration filter
- paginated trace list
- trace detail links to related logs for each span when trace IDs are present

The `/traces/[traceId]` page renders span detail as a waterfall.

### Explore metrics

The `/metrics` page supports:

- metric catalog with type, unit, services, sample count, last seen, and label keys
- query controls for time range, service, environment, aggregation, group-by, labels, and chart type
- Recharts line and bar charts with multi-series legends and hover tooltips
- metric detail panel, deterministic baseline comparison, unusual-change badge, and top-services table
- links into related logs, traces, and service detail pages

### View services

The `/services` page shows services aggregated from logs, spans, and metrics.
The health indicator is derived from recent error logs and error traces in the
current UI code.

### View settings

The `/settings` page displays a masked local demo key and copy-pasteable curl
examples for ingestion.

## Explicitly Out Of Scope For Phase 1

- AI investigation or root cause analysis
- alerts and notification routing
- incident management
- RUM/session replay
- synthetic monitoring
- profiling
- SIEM/compliance workflows
- external integrations such as Slack, PagerDuty, Jira, or Datadog
- SSO/OAuth/SAML

See `docs/adr/0001-observability-core-scope.md` for the original scope document.
