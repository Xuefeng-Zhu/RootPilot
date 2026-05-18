# Implementation Plan: RootPilot Phase 1 — Observability Core

## Overview

This plan implements a greenfield TypeScript monorepo delivering an OpenTelemetry-native observability platform. The implementation proceeds bottom-up: project scaffolding and shared types first, then infrastructure (Docker Compose, DB schemas), followed by the API layer (auth, ingestion, query), the web UI, and finally documentation and seed data. Each task builds incrementally on prior work so there is no orphaned code.

## Tasks

- [x] 1. Scaffold monorepo and shared types package
  - [x] 1.1 Initialize monorepo with npm workspaces and root configuration
    - Create root `package.json` with workspaces: `apps/*`, `packages/*`
    - Create `tsconfig.base.json` with strict TypeScript settings and path aliases
    - Create root `.eslintrc.cjs` and `.prettierrc` for consistent linting
    - Add root npm scripts: `dev`, `test`, `lint`, `db:init`, `seed`
    - Create directory structure: `apps/api/`, `apps/web/`, `packages/shared/`, `infra/`, `docs/`
    - Add `vitest.config.ts` at root with workspace configuration
    - _Requirements: 19.1, 19.2_

  - [x] 1.2 Create shared types package with canonical models
    - Create `packages/shared/package.json` with name `@rootpilot/shared`
    - Create `packages/shared/tsconfig.json` extending base config
    - Implement `packages/shared/src/models.ts` exporting `CanonicalLog`, `CanonicalSpan`, `CanonicalMetric`, `CanonicalDeploymentEvent` interfaces
    - Implement `packages/shared/src/pagination.ts` exporting `PaginationParams`, `PaginatedResponse<T>` types
    - Implement `packages/shared/src/api.ts` exporting request/response shape types, query filter types, and `ErrorResponse` interface
    - Create `packages/shared/src/index.ts` barrel export
    - _Requirements: 19.3, 2.3, 3.3, 4.3, 5.3_

- [x] 2. Set up infrastructure and database schemas
  - [x] 2.1 Create Docker Compose configuration with all services
    - Create `infra/docker-compose.yml` defining services: postgres (port 5432), clickhouse (port 8123, 9000), api (port 4000), web (port 3000)
    - Configure health checks for Postgres (`pg_isready`), ClickHouse (`wget --spider http://localhost:8123/ping`), API (`curl http://localhost:4000/health`), Web (`curl http://localhost:3000`)
    - Define dependency ordering: api depends on postgres (healthy) and clickhouse (healthy); web depends on api (healthy)
    - Mount init SQL files as volumes for database initialization
    - Set environment variables for database connections
    - _Requirements: 16.1, 16.2, 16.3, 16.7_

  - [x] 2.2 Create Postgres initialization SQL
    - Create `infra/init-postgres.sql` with tenants, projects, and api_keys tables matching the design schema
    - Include constraints: slug format regex, unique tenant slug, unique (tenant_id, slug) for projects
    - Include indexes: `idx_api_keys_hash`, `idx_api_keys_tenant`
    - _Requirements: 1.1, 1.2, 1.3, 16.5_

  - [x] 2.3 Create ClickHouse initialization SQL
    - Create `infra/init-clickhouse.sql` with `CREATE DATABASE IF NOT EXISTS rootpilot`
    - Create logs table with MergeTree engine, PARTITION BY toYYYYMM(timestamp), ORDER BY (tenant_id, service_name, timestamp), TTL 90 days
    - Create spans table with ORDER BY (tenant_id, trace_id, timestamp), TTL 90 days
    - Create metrics table with ORDER BY (tenant_id, metric_name, timestamp), TTL 90 days
    - Create deployment_events table with ORDER BY (tenant_id, service_name, timestamp), TTL 90 days
    - Use LowCardinality(String) for tenant_id, service_name, environment; DateTime64(3) for timestamps
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 16.4_

  - [x] 2.4 Create OpenTelemetry Collector configuration
    - Create `infra/otel-collector-config.yaml` with OTLP receivers on gRPC (4317) and HTTP (4318)
    - Configure batch processor
    - Configure otlphttp exporters targeting localhost:4000 with X-API-Key header "rootpilot_demo_key"
    - Define service pipelines for logs, traces, and metrics routing receiver → processor → exporter
    - Add comments explaining each section (receivers, processors, exporters, service pipelines)
    - _Requirements: 17.1, 17.2, 17.3, 17.4_

- [x] 3. Implement API application foundation
  - [x] 3.1 Scaffold Fastify API application
    - Create `apps/api/package.json` with dependencies: fastify, @clickhouse/client, pg, uuid, crypto
    - Create `apps/api/tsconfig.json` extending base config
    - Create `apps/api/vitest.config.ts` for API test configuration
    - Implement `apps/api/src/server.ts` — Fastify app factory with body limit (5 MB), JSON schema validation, and route registration
    - Implement `apps/api/src/index.ts` — entry point that starts the server on port 4000
    - Add `/health` endpoint returning 200 for Docker health checks
    - _Requirements: 19.1, 16.1_

  - [x] 3.2 Implement database clients (ClickHouse and Postgres)
    - Implement `apps/api/src/db/clickhouse.ts` — ClickHouse client using @clickhouse/client with connection pooling, batch insert helper (JSONEachRow format), parameterized query helper, and health check (`SELECT 1`)
    - Implement `apps/api/src/db/postgres.ts` — Postgres client using pg with connection pool (max 10), parameterized query helper, and health check (`SELECT 1`)
    - Export typed client interfaces for dependency injection in tests
    - _Requirements: 6.1, 19.4_

  - [x] 3.3 Implement auth middleware
    - Implement `apps/api/src/middleware/auth.ts` as a Fastify preHandler hook
    - Extract X-API-Key header; return 401 AUTH_REQUIRED if missing/empty
    - Hash the key and query Postgres for matching record
    - Return 401 AUTH_INVALID if no match found
    - Return 401 AUTH_REVOKED if revoked_at is not null
    - Attach TenantContext (tenantId, projectId, keyId) to request
    - _Requirements: 1.5, 1.6, 1.7, 1.8, 18.5_

  - [x] 3.4 Write unit tests for auth middleware
    - Test valid key returns 200/202 with tenant context attached
    - Test missing X-API-Key header returns 401 with AUTH_REQUIRED code
    - Test invalid key returns 401 with AUTH_INVALID code
    - Test revoked key returns 401 with AUTH_REVOKED code
    - Use Fastify inject() with dedicated test tenant
    - _Requirements: 21.1, 21.8_

- [x] 4. Implement normalization layer
  - [x] 4.1 Implement log normalizer
    - Implement `apps/api/src/normalizers/logs.ts` with `normalizeLogRecords()` function
    - Parse OTLP resourceLogs → scopeLogs → logRecords structure
    - Map severityNumber to severity string using defined ranges (1-4→TRACE, 5-8→DEBUG, etc.)
    - Default to INFO when severityNumber is absent or outside 1-24
    - Assign server receive time when timestamp is absent
    - Generate UUID for id, attach tenant_id and project_id
    - Extract service_name and environment from resource attributes
    - _Requirements: 2.1, 2.3, 2.5, 2.6_

  - [x] 4.2 Implement span normalizer
    - Implement `apps/api/src/normalizers/traces.ts` with `normalizeSpans()` function
    - Parse OTLP resourceSpans → scopeSpans → spans structure
    - Compute duration_ms = (endTimeUnixNano - startTimeUnixNano) / 1,000,000
    - Map span kind integer (0-5) to string enum (INTERNAL, SERVER, CLIENT, PRODUCER, CONSUMER)
    - Map status code integer (0-2) to string enum (UNSET, OK, ERROR)
    - Set parent_span_id to null for root spans
    - _Requirements: 3.1, 3.3, 3.4_

  - [x] 4.3 Implement metric normalizer
    - Implement `apps/api/src/normalizers/metrics.ts` with `normalizeMetrics()` function
    - Parse OTLP resourceMetrics → scopeMetrics → metrics structure
    - Validate metric_type is one of: gauge, sum, histogram
    - Validate value is numeric
    - Extract labels from metric attributes
    - _Requirements: 4.1, 4.3, 4.4_

  - [x] 4.4 Write property tests for normalizers
    - **Property 2: Severity Number Mapping Correctness** — generate arbitrary integers, verify mapping matches defined ranges
    - **Property 3: Span Duration Computation** — generate arbitrary nanosecond pairs, verify duration_ms = (end - start) / 1,000,000
    - **Property 5: Missing Field Defaults** — generate payloads with absent timestamps/IDs, verify server-generated values are valid
    - Use fast-check with minimum 100 iterations
    - **Validates: Requirements 2.5, 2.6, 3.1, 5.4, 5.5**

- [x] 5. Implement ingestion endpoints
  - [x] 5.1 Implement log ingestion endpoint
    - Implement `apps/api/src/routes/ingest/logs.ts` — POST /v1/ingest/logs
    - Validate payload structure (resourceLogs array present, logRecords exist)
    - Enforce max 1000 logRecords per request, max 5 MB body
    - Call normalizeLogRecords(), batch insert into ClickHouse logs table
    - Return 202 on success, 400 on validation failure with descriptive error
    - Register route with auth preHandler hook
    - _Requirements: 2.1, 2.2, 2.4, 2.7, 18.2_

  - [x] 5.2 Implement trace ingestion endpoint
    - Implement `apps/api/src/routes/ingest/traces.ts` — POST /v1/ingest/traces
    - Validate payload structure (resourceSpans with scopeSpans and spans)
    - Validate span kind and status_code values; reject entire request on invalid values
    - Call normalizeSpans(), batch insert into ClickHouse spans table
    - Return 202 on success, 400 on validation failure
    - _Requirements: 3.1, 3.2, 3.4, 3.5, 18.2_

  - [x] 5.3 Implement metric ingestion endpoint
    - Implement `apps/api/src/routes/ingest/metrics.ts` — POST /v1/ingest/metrics
    - Validate payload structure, metric_type enum, numeric value
    - Enforce max 5 MB body
    - Call normalizeMetrics(), batch insert into ClickHouse metrics table
    - Return 202 on success, 400 on validation failure, 401 on auth failure
    - _Requirements: 4.1, 4.2, 4.4, 4.5, 4.6, 18.2_

  - [x] 5.4 Implement deployment event ingestion endpoint
    - Implement `apps/api/src/routes/ingest/deployments.ts` — POST /v1/events/deployments
    - Validate required fields: service_name, environment, version
    - Auto-generate deployment_id if absent, assign server time if timestamp absent
    - Insert into ClickHouse deployment_events table
    - Return 202 on success, 400 on validation failure
    - Accept RootPilot custom JSON format (not OTLP)
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 18.2_

  - [x] 5.5 Write property tests for ingestion validation
    - **Property 4: Payload Validation Rejection** — generate structurally invalid payloads (missing fields, wrong types, invalid enums), verify 400 with ≥10 char error message and no data persisted
    - **Property 1: Ingestion Round-Trip Preservation** — generate valid payloads, ingest and query back, verify canonical fields match after normalization
    - Use fast-check custom arbitraries for OTLP payload generation
    - **Validates: Requirements 2.1, 2.2, 3.1, 3.2, 3.5, 4.1, 4.2, 5.1, 5.2, 21.7**

  - [x] 5.6 Write unit tests for ingestion endpoints
    - Test valid log payload returns 202 and record is queryable
    - Test valid trace payload returns 202 and span is queryable
    - Test valid metric payload returns 202 and metric is queryable
    - Test payload exceeding 5 MB returns 400
    - Test payload with >1000 logRecords returns 400
    - Use Fastify inject() with dedicated test tenant
    - _Requirements: 21.2, 21.3, 21.4, 21.7, 21.8_

- [x] 6. Checkpoint — Verify ingestion pipeline
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Implement query endpoints
  - [x] 7.1 Implement log query endpoint
    - Implement `apps/api/src/routes/query/logs.ts` — GET /v1/logs
    - Always include `WHERE tenant_id = :tenantId` in ClickHouse query
    - Support filters: time range (from/to ISO 8601), service_name, environment, severity
    - Support case-insensitive text search on message field
    - Default time range to last 1 hour when not specified
    - Implement cursor-based pagination (default 50, max 1000) using (timestamp, id) composite cursor
    - Return empty data array with hasMore: false when no results match
    - Validate parameters: reject malformed timestamps, invalid severity, limit > 1000
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 18.1, 18.3_

  - [x] 7.2 Implement trace query endpoints
    - Implement `apps/api/src/routes/query/traces.ts` — GET /v1/traces and GET /v1/traces/:traceId
    - GET /v1/traces: return paginated trace summaries (trace_id, root_service, root_operation, duration_ms, span_count, status, timestamp)
    - Support filters: from, to, service, environment, minDuration
    - Default limit 50, max 200, cursor-based pagination
    - GET /v1/traces/:traceId: return all spans for trace sorted by start time, max 10,000 spans
    - Return 404 if traceId not found within tenant's data (also for cross-tenant lookups)
    - Validate parameters: reject non-ISO-8601 times, negative minDuration, limit > 200
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 18.1, 18.3, 18.4_

  - [x] 7.3 Implement metrics query endpoint
    - Implement `apps/api/src/routes/query/metrics.ts` — GET /v1/metrics
    - Return metric_name, aggregation, interval, and data array of {timestamp, value}
    - Support filters: metric_name, service, environment, time range
    - Default time range to last 1 hour
    - Support interval parameter (1m, 5m, 15m, 1h, 1d) with aggregation functions (avg, sum, min, max, count; default avg)
    - Without interval: return raw data points up to 1000, ordered by timestamp ascending
    - Validate parameters: reject unsupported interval/aggregation values
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 18.1_

  - [x] 7.4 Implement services and deployments query endpoints
    - Implement `apps/api/src/routes/query/services.ts` — GET /v1/services
    - Aggregate across logs, spans, metrics tables for unique (service_name, environment) pairs
    - Return: service_name, environment, last_seen, log_count, span_count, metric_count
    - Implement `apps/api/src/routes/query/deployments.ts` — GET /v1/deployments
    - Support filters: from, to, service, environment; default limit 50, max 200, cursor-based pagination
    - Return empty result set with 200 when no records match
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 18.1_

  - [x] 7.5 Write property tests for query endpoints
    - **Property 6: Tenant Data Isolation** — ingest under tenant A, query with tenant B's key, verify zero records returned
    - **Property 7: Cross-Tenant Resource Not-Found** — lookup existing resource with wrong tenant key, verify 404
    - **Property 8: Query Filtering Correctness** — insert records with varied attributes, apply filter combinations, verify exact match set returned
    - **Property 9: Cursor-Based Pagination Consistency** — insert N records, paginate through all pages, verify every record appears exactly once in order with no gaps
    - **Property 10: Query Parameter Validation** — generate invalid parameter values, verify 400 with descriptive error
    - **Property 11: Metric Aggregation Correctness** — insert known data points, query with aggregation, verify mathematical correctness
    - **Property 12: Service Catalog Aggregation** — insert telemetry across services, verify correct counts and last_seen
    - Use fast-check with minimum 100 iterations per property
    - **Validates: Requirements 7.1, 7.3, 7.4, 7.7, 8.4, 8.6, 8.7, 9.3, 9.4, 9.6, 10.1, 10.2, 18.1, 18.3, 18.4, 21.5, 21.6**

  - [x] 7.6 Write unit tests for query endpoints
    - Test log query with filters returns only matching records
    - Test trace query returns correct summaries and detail view
    - Test metrics query with aggregation returns correct values
    - Test services endpoint returns aggregated service list
    - Test empty results return 200 with empty array
    - Test tenant isolation: query with wrong tenant returns zero records
    - Use Fastify inject() with dedicated test tenant
    - _Requirements: 21.5, 21.6, 21.8_

- [x] 8. Checkpoint — Verify full API layer
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Implement Web UI application
  - [x] 9.1 Scaffold Next.js application with App Router
    - Create `apps/web/package.json` with Next.js, React, Tailwind CSS dependencies
    - Create `apps/web/tsconfig.json` extending base config
    - Create `apps/web/next.config.js` with API proxy configuration
    - Create `apps/web/tailwind.config.ts` and global styles
    - Create root layout (`apps/web/src/app/layout.tsx`) with navigation sidebar (Overview, Logs, Traces, Metrics, Services, Settings)
    - Create shared API client utility (`apps/web/src/lib/api.ts`) that fetches from localhost:4000 with hardcoded demo API key
    - _Requirements: 19.1, 15.2_

  - [x] 9.2 Implement Overview dashboard page
    - Create `apps/web/src/app/page.tsx` — overview dashboard
    - Display summary cards: distinct services count, log count, trace count, metric count for selected time range (default 24h)
    - Display 5 most recent deployment events
    - Display 10 most recent error-severity log entries
    - Show zero counts or empty-state messages when no data exists
    - _Requirements: 11.1, 11.2, 11.3, 11.4_

  - [x] 9.3 Implement Logs Explorer page
    - Create `apps/web/src/app/logs/page.tsx` — logs explorer
    - Filter controls: time range (15m, 1h, 6h, 24h, 7d, custom), service dropdown, environment, severity multi-select (trace, debug, info, warn, error, fatal); default 1h
    - Display logs table: timestamp, service, severity, message; sorted by timestamp descending
    - Implement load-more pagination
    - Text search input filtering by message content
    - Click log entry → detail drawer showing all canonical fields as formatted JSON
    - Error state: display error message, retain filter selections
    - Empty state: display "no results found" message
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6_

  - [x] 9.4 Implement Trace Explorer pages
    - Create `apps/web/src/app/traces/page.tsx` — trace list
    - Filter controls: time range (default 1h), service, minimum duration (0-999,999 ms)
    - Display paginated trace list (50 per page): trace_id, root service, root operation, duration, span count; sorted by start time descending
    - Empty state message when no traces match
    - Create `apps/web/src/app/traces/[traceId]/page.tsx` — trace detail
    - Span waterfall visualization: horizontal bars positioned by start time, sized by duration, indented for parent-child relationships
    - Labels: operation_name, service_name, duration_ms; color-coded by status (green=OK, red=ERROR, gray=UNSET)
    - 404 state: display "trace not found" message
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5_

  - [x] 9.5 Implement Metrics Explorer page
    - Create `apps/web/src/app/metrics/page.tsx` — metrics explorer
    - Searchable metric name dropdown populated from GET /v1/metrics
    - Filter controls: time range, service, environment
    - Line chart of metric values over time with auto-selected aggregation interval
    - Values table below chart: timestamp, value, labels (most recent 100 points)
    - Empty state when no data available
    - Refresh chart and table within 2 seconds of filter change
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5_

  - [x] 9.6 Implement Service Catalog and Settings pages
    - Create `apps/web/src/app/services/page.tsx` — service catalog
    - List all services: service_name, environment, last_seen, health indicator (error rate from recent logs/spans)
    - Empty state when no services found
    - Create `apps/web/src/app/settings/page.tsx` — settings page
    - Display masked API key (prefix only) with copy-to-clipboard button for full key
    - Pre-formatted curl commands for logs, traces, metrics, deployment events targeting localhost:4000
    - Each curl command is complete and copy-pasteable with method, endpoint, API key header, content-type, and sample JSON body
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5_

  - [x] 9.7 Write frontend component tests
    - Test overview page renders summary cards and recent events
    - Test logs explorer filter interactions trigger correct API calls
    - Test trace waterfall renders spans with correct positioning and colors
    - Test metrics chart renders with mock data
    - Test empty and error states render appropriate messages
    - Test settings page displays masked key and curl commands
    - Use React Testing Library with mock API responses
    - _Requirements: 21.8_

- [x] 10. Checkpoint — Verify Web UI renders correctly
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. Implement seed script and db:init
  - [x] 11.1 Implement db:init script
    - Create `apps/api/src/scripts/db-init.ts` (or root-level script)
    - Connect to Postgres and execute init SQL to create tables
    - Connect to ClickHouse and execute init SQL to create database and tables
    - Exit with non-zero code and descriptive error within 30 seconds if databases are unreachable
    - Wire to `npm run db:init` root script
    - _Requirements: 19.2, 19.4_

  - [x] 11.2 Implement seed script
    - Create `apps/api/src/scripts/seed.ts`
    - Create demo tenant (name: "demo", slug: "demo"), project (name: "default", slug: "default"), and API key (value: "rootpilot_demo_key")
    - Populate via API endpoints: at least 50 sample logs, 10 traces with multiple spans each, 20 metric data points, 3 deployment events
    - Use realistic service names, varied severities, multiple environments
    - Wire to `npm run seed` root script
    - _Requirements: 1.4, 16.6_

- [x] 12. Create documentation
  - [x] 12.1 Create architecture documentation
    - Create `docs/architecture.md` with Mermaid diagrams: high-level system diagram (all components), data flow (ingestion → storage → query), storage design (ClickHouse + Postgres), multi-tenant isolation strategy
    - _Requirements: 20.1_

  - [x] 12.2 Create phase-1 scope and local development docs
    - Create `docs/phase-1.md` listing in-scope features and explicitly out-of-scope features (AI investigation, incident management, RUM, synthetics, profiling, SIEM, third-party integrations)
    - Create `docs/local-development.md` with: prerequisites (Docker, Node.js versions), setup steps, starting services via Docker Compose, running seed script, verifying setup
    - Include copy-pasteable curl commands for all endpoints authenticated with demo API key
    - _Requirements: 20.2, 20.3, 20.4_

- [x] 13. Final checkpoint — Verify complete system
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document (12 properties)
- Unit tests validate specific examples and edge cases
- All API tests use Fastify inject() — no real HTTP server needed
- Docker Compose must be running for integration/property tests that hit real databases
- The shared types package must be built before apps can import from it

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "2.1", "2.4"] },
    { "id": 2, "tasks": ["2.2", "2.3", "3.1"] },
    { "id": 3, "tasks": ["3.2", "3.3"] },
    { "id": 4, "tasks": ["3.4", "4.1", "4.2", "4.3"] },
    { "id": 5, "tasks": ["4.4", "5.1", "5.2", "5.3", "5.4"] },
    { "id": 6, "tasks": ["5.5", "5.6"] },
    { "id": 7, "tasks": ["7.1", "7.2", "7.3", "7.4"] },
    { "id": 8, "tasks": ["7.5", "7.6"] },
    { "id": 9, "tasks": ["9.1"] },
    { "id": 10, "tasks": ["9.2", "9.3", "9.4", "9.5", "9.6"] },
    { "id": 11, "tasks": ["9.7", "11.1"] },
    { "id": 12, "tasks": ["11.2", "12.1", "12.2"] }
  ]
}
```
