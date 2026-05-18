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

- time presets and custom time range
- service and environment filters
- severity filters
- message search
- load-more pagination
- log detail drawer

### Explore traces

The `/traces` page supports:

- time range filter
- service filter
- minimum duration filter
- paginated trace list

The `/traces/[traceId]` page renders span detail as a waterfall.

### Explore metrics

The `/metrics` page supports:

- searchable metric name selector
- time range filter
- service and environment filters
- automatic interval selection
- line chart and values table

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

See `docs/phase-1.md` for the original scope document.
