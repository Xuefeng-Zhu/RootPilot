# RootPilot Phase 1 — Scope

## Overview

Phase 1 delivers the observability core: an OpenTelemetry-native platform that ingests logs, traces, and metrics, stores telemetry in ClickHouse, manages tenant metadata in Postgres, and provides a web UI for exploring telemetry data. This phase proves the foundational data pipeline and query experience for cloud-native teams.

## In-Scope Features

### Telemetry Ingestion

- **OTLP Log Ingestion** — POST /v1/ingest/logs accepting OpenTelemetry-compatible JSON log payloads
- **OTLP Trace Ingestion** — POST /v1/ingest/traces accepting OpenTelemetry-compatible JSON span payloads
- **OTLP Metric Ingestion** — POST /v1/ingest/metrics accepting OpenTelemetry-compatible JSON metric payloads
- **Deployment Event Ingestion** — POST /v1/events/deployments accepting custom JSON deployment records

### Query APIs

- **Log Query** — GET /v1/logs with time range, service, environment, severity filters, text search, and cursor-based pagination
- **Trace Query** — GET /v1/traces for trace summaries; GET /v1/traces/:traceId for full span detail
- **Metric Query** — GET /v1/metrics with aggregation intervals (1m, 5m, 15m, 1h, 1d) and functions (avg, sum, min, max, count)
- **Service Catalog** — GET /v1/services aggregated from all telemetry sources
- **Deployment Query** — GET /v1/deployments with filtering and pagination

### Web UI

- **Overview Dashboard** — summary cards (services, logs, traces, metrics), recent deployments, recent errors
- **Logs Explorer** — filterable log table with detail drawer, text search, load-more pagination
- **Trace Explorer** — trace list with waterfall visualization showing parent-child span relationships, color-coded by status
- **Metrics Explorer** — metric selector, line chart, values table with auto-aggregation
- **Service Catalog** — all services with health indicators
- **Settings** — masked API key display, copy-pasteable curl command examples

### Platform

- **Multi-Tenant Isolation** — API key authentication scoping all data to tenant; cross-tenant queries return empty/404
- **Docker Compose Local Development** — single-command stack (Postgres, ClickHouse, API, Web UI)
- **Seed Data** — demo tenant with sample logs, traces, metrics, and deployment events
- **OpenTelemetry Collector Config** — sample configuration for connecting instrumented apps
- **Shared TypeScript Types** — canonical model interfaces shared across API and Web workspaces

### Storage

- **ClickHouse** — columnar storage for logs, spans, metrics, deployment events with MergeTree engine, monthly partitioning, 90-day TTL
- **Postgres** — tenant, project, and API key metadata with ACID guarantees

## Out-of-Scope Features

The following are explicitly **not** part of Phase 1:

| Feature | Description |
|---------|-------------|
| **AI/ML Investigation** | Automated root cause analysis, anomaly detection, intelligent correlation |
| **Incident Management** | Alert routing, on-call schedules, incident lifecycle tracking |
| **Real User Monitoring (RUM)** | Browser performance metrics, session replay, user journey tracking |
| **Synthetic Monitoring** | Scheduled probes, uptime checks, multi-step transaction monitoring |
| **Profiling** | Continuous profiling, flame graphs, CPU/memory profiling |
| **SIEM Integration** | Security event correlation, compliance log forwarding |
| **Third-Party Integrations** | Slack, PagerDuty, Jira, Datadog, or other external service connectors |
| **Alerting** | Threshold-based alerts, notification channels, alert rules engine |
| **SSO/OAuth** | Single sign-on, OAuth2 flows, SAML, external identity providers |
