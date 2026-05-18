# Requirements Document

## Introduction

RootPilot Phase 1 delivers the observability core: an OpenTelemetry-native platform that ingests logs, traces, and metrics via OTLP-compatible HTTP endpoints, stores telemetry in ClickHouse, manages tenant metadata in Postgres, and provides a web UI for exploring telemetry data. This phase proves the foundational data pipeline and query experience for cloud-native teams. AI investigation, incident management, RUM, synthetics, profiling, SIEM, and third-party integrations are explicitly out of scope.

## Glossary

- **RootPilot**: The observability platform being built
- **Ingestion_API**: The HTTP service that receives telemetry data from instrumented applications and stores it in ClickHouse
- **Query_API**: The HTTP service that retrieves stored telemetry data for display in the Web_UI
- **Web_UI**: The Next.js frontend application for exploring logs, traces, metrics, and services
- **ClickHouse**: The columnar database used for storing high-volume telemetry data (logs, spans, metrics, deployment events)
- **Postgres**: The relational database used for tenant metadata, projects, API keys, and service registry
- **Tenant**: An isolated organizational unit; all data is scoped to a tenant
- **Project**: A logical grouping of services within a Tenant
- **API_Key**: A secret token used to authenticate ingestion and query requests, scoped to a Tenant
- **OTLP**: OpenTelemetry Protocol, the standard wire format for telemetry data
- **Canonical_Model**: The normalized internal representation of telemetry records stored in ClickHouse
- **Span**: A single unit of work within a distributed trace, with timing and relationship data
- **Deployment_Event**: A record of a service deployment including version, git SHA, and deployer information
- **Docker_Compose**: The local infrastructure orchestration tool used to run all services together
- **Seed_Script**: A script that populates the system with demo tenant, project, API key, and sample telemetry data
- **OTel_Collector**: The OpenTelemetry Collector, a vendor-agnostic agent that can export telemetry to RootPilot

## Requirements

### Requirement 1: Tenant and API Key Management

**User Story:** As a platform operator, I want tenant isolation with API key authentication, so that each organization's telemetry data is securely separated.

#### Acceptance Criteria

1. THE Postgres database SHALL store tenants with fields: id (UUID primary key), name (max 100 characters), slug (max 50 characters, unique, lowercase alphanumeric and hyphens only), created_at, updated_at
2. THE Postgres database SHALL store projects with fields: id (UUID primary key), tenant_id (foreign key to tenants), name (max 100 characters), slug (max 50 characters, unique within tenant, lowercase alphanumeric and hyphens only), created_at
3. THE Postgres database SHALL store API keys with fields: id (UUID primary key), tenant_id (foreign key to tenants), key_hash, key_prefix (first 8 characters of the key), name (max 100 characters), created_at, revoked_at (nullable)
4. WHEN the Seed_Script executes, THE Postgres database SHALL contain a demo tenant named "demo" with slug "demo", a project named "default" with slug "default", and an API key with value "rootpilot_demo_key"
5. WHEN a request arrives at the Ingestion_API or Query_API without an X-API-Key header or with an empty X-API-Key header value, THE API SHALL return HTTP 401 with an error message indicating that authentication is required
6. WHEN a request arrives with an X-API-Key header value that does not match any stored API key, THE API SHALL return HTTP 401 with an error message indicating that the key is invalid
7. IF a request arrives with an X-API-Key header value that matches a stored API key where revoked_at is not null, THEN THE API SHALL return HTTP 401 with an error message indicating that the key has been revoked
8. WHEN a request arrives with an X-API-Key header value that matches a stored API key where revoked_at is null, THE API SHALL resolve the associated tenant_id and scope all operations to that tenant

### Requirement 2: Log Ingestion

**User Story:** As a developer, I want to send application logs to RootPilot via an OTLP-compatible endpoint, so that my logs are centrally stored and queryable.

#### Acceptance Criteria

1. WHEN a POST request is sent to /v1/ingest/logs with a valid API key and a payload containing one or more logRecords within the OTLP JSON structure (resourceLogs > scopeLogs > logRecords), THE Ingestion_API SHALL normalize each logRecord to the Canonical_Model, insert all records into the ClickHouse logs table, and return HTTP 202
2. IF a POST request is sent to /v1/ingest/logs with a payload that is not valid JSON, lacks the required resourceLogs array, or contains zero logRecords, THEN THE Ingestion_API SHALL return HTTP 400 with an error message indicating which structural validation failed
3. THE Canonical_Model for logs SHALL include fields: id, tenant_id, project_id, timestamp, received_at, service_name, environment, source, resource_attributes, attributes, severity, message, trace_id, span_id, fingerprint
4. THE Ingestion_API SHALL accept OTLP-style JSON payloads following the OpenTelemetry log data model structure (resourceLogs containing scopeLogs containing logRecords) with a maximum request body size of 5 MB and a maximum of 1000 logRecords per request
5. WHEN a log record lacks a timestamp, THE Ingestion_API SHALL assign the server receive time as the timestamp
6. THE Ingestion_API SHALL normalize OTLP severityNumber values to severity strings using the OpenTelemetry severity mapping (1-4: TRACE, 5-8: DEBUG, 9-12: INFO, 13-16: WARN, 17-20: ERROR, 21-24: FATAL), and SHALL default to INFO when severityNumber is absent or outside the valid range of 1-24
7. IF a POST request is sent to /v1/ingest/logs with a payload that exceeds 5 MB or contains more than 1000 logRecords, THEN THE Ingestion_API SHALL return HTTP 400 with an error message indicating the limit that was exceeded

### Requirement 3: Trace Ingestion

**User Story:** As a developer, I want to send distributed traces to RootPilot, so that I can visualize request flows across services.

#### Acceptance Criteria

1. WHEN a POST request is sent to /v1/ingest/traces with a valid API key and a payload containing resourceSpans with scopeSpans and spans, THE Ingestion_API SHALL normalize each span to the Canonical_Model, compute duration_ms as (endTimeUnixNano - startTimeUnixNano) / 1,000,000, insert all spans into the ClickHouse spans table, and return HTTP 202
2. IF a POST request is sent to /v1/ingest/traces with a payload that fails structural validation, THEN THE Ingestion_API SHALL return HTTP 400 with an error message indicating which validation rule failed
3. THE Canonical_Model for spans SHALL include fields: id, tenant_id, project_id, timestamp (derived from startTimeUnixNano), received_at, service_name, environment, source, resource_attributes, attributes, trace_id, span_id, parent_span_id (null for root spans), operation_name, duration_ms, status_code (one of UNSET, OK, ERROR), status_message, kind (one of INTERNAL, SERVER, CLIENT, PRODUCER, CONSUMER)
4. THE Ingestion_API SHALL accept OTLP-style JSON payloads structured as resourceSpans containing scopeSpans with individual spans for trace ingestion
5. IF a span in the payload contains an invalid kind value or an invalid status_code value, THEN THE Ingestion_API SHALL reject the entire request with HTTP 400 and an error message indicating the invalid field value

### Requirement 4: Metric Ingestion

**User Story:** As a developer, I want to send application metrics to RootPilot, so that I can monitor system health over time.

#### Acceptance Criteria

1. WHEN a POST request is sent to /v1/ingest/metrics with a valid X-API-Key header and a valid OTLP-style JSON payload of 5 MB or less, THE Ingestion_API SHALL normalize the payload to the Canonical_Model and insert each metric data point into the ClickHouse metrics table, then return HTTP 202
2. IF a POST request is sent to /v1/ingest/metrics with a payload that fails validation (missing required fields, non-numeric metric value, or metric_type not in [gauge, sum, histogram]), THEN THE Ingestion_API SHALL return HTTP 400 with an error message indicating which field(s) failed validation, without persisting any data points from the request
3. THE Canonical_Model for metrics SHALL include fields: id, tenant_id, project_id, timestamp, received_at, service_name, environment, source, resource_attributes, attributes, metric_name, metric_type (one of: gauge, sum, histogram), value (numeric), unit, labels (key-value pairs)
4. THE Ingestion_API SHALL accept OTLP-style JSON payloads structured as resourceMetrics containing scopeMetrics with individual metrics, where each metric data point is stored as a separate row in the metrics table
5. IF a POST request is sent to /v1/ingest/metrics with a missing or invalid X-API-Key header, THEN THE Ingestion_API SHALL return HTTP 401 without processing the payload
6. IF a POST request is sent to /v1/ingest/metrics with a body exceeding 5 MB, THEN THE Ingestion_API SHALL return HTTP 400 with an error message indicating the maximum allowed request size

### Requirement 5: Deployment Event Ingestion

**User Story:** As a DevOps engineer, I want to record deployment events in RootPilot, so that I can correlate deployments with changes in system behavior.

#### Acceptance Criteria

1. WHEN a POST request is sent to /v1/events/deployments with a valid API key and a JSON payload containing the required fields (service_name, environment, version), THE Ingestion_API SHALL insert the deployment event into the ClickHouse deployment_events table, then return HTTP 202
2. IF a POST request is sent to /v1/events/deployments with a payload missing any required field (service_name, environment, version) or containing malformed JSON, THEN THE Ingestion_API SHALL return HTTP 400 with an error message indicating which fields are missing or invalid
3. THE Canonical_Model for deployment events SHALL include fields: deployment_id, tenant_id, project_id, timestamp, service_name, environment, version, git_sha, deployed_by, provider, metadata — where service_name, environment, and version are required, and git_sha, deployed_by, provider, and metadata are optional
4. WHEN a deployment event payload does not include a deployment_id, THE Ingestion_API SHALL auto-generate a unique deployment_id for the record
5. WHEN a deployment event payload does not include a timestamp, THE Ingestion_API SHALL assign the server receive time as the timestamp
6. THE Ingestion_API SHALL accept deployment event payloads in RootPilot custom JSON format (not OTLP)

### Requirement 6: ClickHouse Storage Schema

**User Story:** As a platform engineer, I want telemetry stored in ClickHouse with optimized schemas, so that queries over large volumes of data are performant.

#### Acceptance Criteria

1. THE ClickHouse database named "rootpilot" SHALL contain tables: logs, spans, metrics, deployment_events, where each table's columns match the corresponding Canonical_Model fields defined in Requirements 2 through 5
2. THE ClickHouse tables SHALL use the MergeTree engine with PARTITION BY toYYYYMM(timestamp) and a TTL of 90 days on the timestamp column for automatic data expiration
3. THE ClickHouse logs table SHALL use ORDER BY (tenant_id, service_name, timestamp) for optimized query performance
4. THE ClickHouse spans table SHALL use ORDER BY (tenant_id, trace_id, timestamp) for optimized trace retrieval
5. THE ClickHouse metrics table SHALL use ORDER BY (tenant_id, metric_name, timestamp) for optimized metric queries
6. THE ClickHouse deployment_events table SHALL use ORDER BY (tenant_id, service_name, timestamp) for optimized deployment queries
7. THE ClickHouse tables SHALL use LowCardinality(String) type for tenant_id, service_name, and environment columns, and shall use DateTime64(3) for timestamp columns to provide millisecond precision

### Requirement 7: Log Query API

**User Story:** As a developer, I want to query stored logs with filters, so that I can investigate application issues.

#### Acceptance Criteria

1. WHEN a GET request is sent to /v1/logs with a valid API key, THE Query_API SHALL return paginated log records scoped to the authenticated tenant, sorted by timestamp in descending order (newest first), using cursor-based pagination with a default page size of 50 and a maximum page size of 1000
2. WHEN a GET request is sent to /v1/logs without a time range, THE Query_API SHALL default to returning logs from the last 1 hour
3. THE Query_API SHALL support filtering logs by time range (start and end as ISO 8601 timestamps), service_name, environment, and severity
4. THE Query_API SHALL support case-insensitive text search within the message field, where an empty or omitted search parameter returns all matching logs without text filtering
5. WHEN no logs match the query, THE Query_API SHALL return an empty result set with HTTP 200, including an empty data array and pagination indicating hasMore is false
6. IF the request contains an invalid or expired API key, THEN THE Query_API SHALL return HTTP 401 with an error message indicating authentication failure
7. IF the request contains invalid filter parameters (malformed ISO 8601 timestamps, unrecognized severity values, or limit exceeding 1000), THEN THE Query_API SHALL return HTTP 400 with an error message indicating which parameter is invalid

### Requirement 8: Trace Query API

**User Story:** As a developer, I want to query traces and view individual trace details, so that I can understand request flows.

#### Acceptance Criteria

1. WHEN a GET request is sent to /v1/traces with a valid API key, THE Query_API SHALL return paginated trace summaries scoped to the authenticated tenant, where each summary includes trace_id, root_service, root_operation, duration_ms, span_count, status, and timestamp
2. WHEN a GET request is sent to /v1/traces with a valid API key and a `limit` query parameter, THE Query_API SHALL return at most the specified number of trace summaries, with a default of 50 and a maximum of 200, and include a cursor value for retrieving the next page
3. WHEN a GET request is sent to /v1/traces/:traceId with a valid API key, THE Query_API SHALL return all spans belonging to that trace sorted by start time with parent-child relationships preserved, up to a maximum of 10,000 spans
4. WHEN a GET request is sent to /v1/traces with filter parameters (from, to, service, environment, minDuration), THE Query_API SHALL return only trace summaries matching all specified filters, where time range values are ISO-8601 timestamps and minDuration is specified in milliseconds
5. IF a GET request to /v1/traces or /v1/traces/:traceId is sent with a missing or invalid API key, THEN THE Query_API SHALL return HTTP 401 without revealing trace data
6. IF a GET request to /v1/traces/:traceId references a trace ID that does not exist within the authenticated tenant's data, THEN THE Query_API SHALL return HTTP 404
7. IF a GET request to /v1/traces includes filter parameters with invalid values (non-ISO-8601 time range, negative minDuration, or `limit` exceeding 200), THEN THE Query_API SHALL return HTTP 400 with an error message indicating which parameter is invalid

### Requirement 9: Metrics Query API

**User Story:** As a developer, I want to query metric time series, so that I can visualize system health trends.

#### Acceptance Criteria

1. WHEN a GET request is sent to /v1/metrics with a valid API key, THE Query_API SHALL return a response containing: metric_name, aggregation, interval, and a data array of objects each with a timestamp and numeric value, scoped to the authenticated tenant
2. WHEN a query does not include `from` and `to` parameters, THE Query_API SHALL default the time range to the last 1 hour
3. WHEN a query includes filter parameters (metric_name, service, environment), THE Query_API SHALL return only data points matching all specified filter values within the requested time range
4. IF the `interval` parameter is specified with a valid value (1m, 5m, 15m, 1h, or 1d), THEN THE Query_API SHALL return metric values aggregated over the specified interval using the requested aggregation function (avg, sum, min, max, or count, defaulting to avg)
5. IF the `interval` parameter is not specified, THEN THE Query_API SHALL return raw unaggregated data points up to a maximum of 1000 points, ordered by timestamp ascending
6. IF the request contains an invalid filter value, an unsupported interval, or an unsupported aggregation function, THEN THE Query_API SHALL return an error response indicating which parameter is invalid without processing the query

### Requirement 10: Services and Deployments Query API

**User Story:** As a developer, I want to see a catalog of services and their deployments, so that I can understand what is running in my environment.

#### Acceptance Criteria

1. WHEN a GET request is sent to /v1/services with a valid API key, THE Query_API SHALL return a list of services scoped to the authenticated tenant, where each service is uniquely identified by the combination of service_name and environment, aggregated across logs, spans, and metrics tables, and each entry includes: service_name, environment, last_seen (most recent telemetry timestamp), log_count, span_count, metric_count
2. WHEN a GET request is sent to /v1/deployments with a valid API key, THE Query_API SHALL return paginated deployment events scoped to the authenticated tenant, supporting query parameters: from (start time), to (end time), service (service_name filter), environment, limit (default 50, maximum 200), and cursor for cursor-based pagination
3. THE Query_API SHALL support filtering deployments by service_name, environment, and time range (from, to), returning only deployment events matching all specified filter parameters
4. WHEN a GET request is sent to /v1/services or /v1/deployments and no records match the query, THE Query_API SHALL return an empty result set with HTTP 200

### Requirement 11: Web UI Overview Page

**User Story:** As a developer, I want a dashboard overview when I open RootPilot, so that I can quickly assess system health.

#### Acceptance Criteria

1. WHEN a user navigates to the overview page, THE Web_UI SHALL display summary cards showing the count of distinct services, ingested logs, traces, and metrics for the selected time range, defaulting to the last 24 hours
2. WHEN a user navigates to the overview page, THE Web_UI SHALL display the 5 most recent deployment events
3. WHEN a user navigates to the overview page, THE Web_UI SHALL display the 10 most recent error-severity log entries
4. IF the Query_API returns no data for a section, THEN THE Web_UI SHALL display that section with a zero count or an empty-state message indicating no records exist for the selected time range

### Requirement 12: Web UI Logs Explorer

**User Story:** As a developer, I want to search and filter logs in a web interface, so that I can investigate issues without writing raw queries.

#### Acceptance Criteria

1. THE Web_UI SHALL provide a logs explorer page at route "/logs" with filter controls for: time range (preset options: 15m, 1h, 6h, 24h, 7d, and custom date range), service (populated from available services), environment, and severity (multi-select with values: trace, debug, info, warn, error, fatal), with a default time range of 1h
2. THE Web_UI SHALL display matching logs in a table with columns: timestamp, service, severity, message, sorted by timestamp descending (most recent first), and SHALL support load-more pagination to retrieve additional results
3. WHEN a user clicks a log entry, THE Web_UI SHALL display a detail drawer showing all Canonical_Model log fields (including resource_attributes and attributes) in a formatted JSON view
4. THE Web_UI SHALL provide a text search input that filters log results by matching within log messages
5. IF the Query_API returns an error or is unreachable, THEN THE Web_UI SHALL display an error message indicating the failure and retain any previously entered filter selections
6. IF no logs match the current filters, THEN THE Web_UI SHALL display an empty state message indicating no results were found

### Requirement 13: Web UI Trace Explorer

**User Story:** As a developer, I want to browse traces and view span waterfalls, so that I can diagnose latency issues.

#### Acceptance Criteria

1. THE Web_UI SHALL provide a trace explorer page at route "/traces" with filter controls for time range (defaulting to the last 1 hour), service, and minimum duration (accepting values from 0 to 999,999 ms)
2. THE Web_UI SHALL display matching traces in a paginated list (50 traces per page) sorted by start time descending, with columns: trace_id, root service, root operation, duration (in milliseconds), and span count
3. WHEN a user clicks a trace, THE Web_UI SHALL navigate to "/traces/:traceId" and display a detail view with a span waterfall visualization where each span is rendered as a horizontal bar positioned by start time and sized by duration, indented to show parent-child relationships, and labeled with operation_name, service_name, and duration_ms, with the bar color-coded by status (green for OK, red for ERROR, gray for UNSET)
4. WHEN the trace list query returns zero matching traces, THE Web_UI SHALL display an empty-state message indicating no traces match the current filters
5. IF the trace detail API returns a 404 response, THEN THE Web_UI SHALL display a not-found message indicating the requested trace does not exist

### Requirement 14: Web UI Metrics Explorer

**User Story:** As a developer, I want to visualize metrics as time-series charts, so that I can monitor trends and detect anomalies.

#### Acceptance Criteria

1. THE Web_UI SHALL provide a metrics explorer page with a searchable metric name dropdown selector populated from available metrics via GET /v1/metrics, and filter controls for time range, service, and environment
2. WHEN a metric is selected, THE Web_UI SHALL display a line chart of metric values over the selected time range, using an aggregation interval auto-selected based on the time range
3. WHEN a metric is selected, THE Web_UI SHALL display a values table below the chart showing columns: timestamp, value, and labels, limited to the most recent 100 data points within the selected time range
4. IF the Query_API returns an error or no data points exist for the selected metric and filters, THEN THE Web_UI SHALL display an empty state message indicating no data is available for the current selection
5. WHEN a filter control value is changed, THE Web_UI SHALL refresh the chart and values table to reflect the updated filters within 2 seconds of the filter change

### Requirement 15: Web UI Service Catalog and Settings

**User Story:** As a developer, I want to see all services sending telemetry and manage API keys, so that I can onboard new services.

#### Acceptance Criteria

1. THE Web_UI SHALL provide a service catalog page listing all services that have sent telemetry data, displaying for each service: service_name, environment, last_seen timestamp, and a health indicator derived from the error rate in recent logs and spans
2. THE Web_UI SHALL provide a settings page displaying the tenant's API key in masked form (showing only a prefix) with a copy-to-clipboard button that copies the full unmasked key
3. THE settings page SHALL show pre-formatted curl commands for sending logs, traces, metrics, and deployment events, where each command targets the corresponding Ingestion_API endpoint using the tenant's actual API key and the base URL localhost:4000
4. WHEN a user navigates to the service catalog page, THE Web_UI SHALL retrieve service data by calling GET /v1/services and display a message indicating no services are found if the response contains an empty list
5. THE settings page curl examples SHALL each constitute a complete, copy-pasteable command that includes the HTTP method, endpoint path, API key header, content-type header, and a sample JSON request body matching the expected payload format for that telemetry type

### Requirement 16: Local Development Infrastructure

**User Story:** As a developer, I want to run the entire RootPilot stack locally with a single command, so that I can develop and test without external dependencies.

#### Acceptance Criteria

1. THE Docker_Compose configuration SHALL define services for Postgres (host port 5432), ClickHouse (host ports 8123 for HTTP and 9000 for native protocol), the API application (host port 4000), and the Web_UI application (host port 3000)
2. WHEN a developer runs docker compose up, THE system SHALL start all services with health checks passing and databases initialized with required schemas within 120 seconds
3. THE Docker_Compose configuration SHALL define service dependencies such that Postgres and ClickHouse pass their health checks before the API application starts, and the API application passes its health check before the Web_UI application starts
4. THE infrastructure SHALL include ClickHouse initialization SQL mounted as a volume that creates all tables required for storing logs, traces, and metrics
5. THE infrastructure SHALL include Postgres initialization SQL mounted as a volume that creates all tables required for storing deployment events and tenant configuration
6. THE Seed_Script (invoked via npm run seed) SHALL populate the system through the API endpoints with at least 50 sample logs, 10 traces with multiple spans each, 20 metric data points, and 3 deployment events for the demo tenant
7. IF a service fails its health check within 120 seconds of container start, THEN THE Docker_Compose configuration SHALL prevent dependent services from starting

### Requirement 17: OpenTelemetry Collector Configuration

**User Story:** As a developer, I want a sample OpenTelemetry Collector configuration, so that I can quickly connect instrumented applications to RootPilot.

#### Acceptance Criteria

1. THE infrastructure SHALL include an otel-collector-config.yaml file at infra/otel-collector-config.yaml that configures the OTel_Collector with OTLP receivers accepting data on both gRPC (port 4317) and HTTP (port 4318) protocols, a batch processor, and otlphttp exporters targeting the RootPilot Ingestion_API at localhost:4000
2. THE configuration SHALL include the X-API-Key header set to the demo tenant API key value "rootpilot_demo_key" for authentication in all exporter definitions
3. THE configuration SHALL define service pipelines for logs, traces, and metrics, each wiring the OTLP receiver through the batch processor to the otlphttp exporter targeting the corresponding Ingestion_API endpoint (/v1/ingest/logs, /v1/ingest/traces, /v1/ingest/metrics)
4. THE configuration file SHALL include comments explaining the purpose of each section (receivers, processors, exporters, service pipelines)

### Requirement 18: Tenant Isolation

**User Story:** As a platform operator, I want strict tenant isolation, so that one tenant cannot access another tenant's telemetry data.

#### Acceptance Criteria

1. THE Query_API SHALL include tenant_id in every ClickHouse query WHERE clause
2. THE Ingestion_API SHALL tag every inserted record with the authenticated tenant_id
3. WHEN a query is executed, THE Query_API SHALL return only records belonging to the authenticated tenant, ignoring any client-supplied tenant identifier in query parameters or request body
4. IF a query references a resource identifier that exists but belongs to a different tenant, THEN THE Query_API SHALL respond as if the resource does not exist, returning a not-found response
5. IF the tenant_id cannot be resolved from the authenticated API key, THEN THE Ingestion_API and Query_API SHALL reject the request before executing any database operation and return an authentication error response

### Requirement 19: Project Structure and Developer Experience

**User Story:** As a developer contributing to RootPilot, I want a well-organized monorepo with clear conventions, so that I can navigate and extend the codebase efficiently.

#### Acceptance Criteria

1. THE repository SHALL follow the structure: /apps/web (Next.js frontend), /apps/api (ingestion and query API), /packages/shared (shared TypeScript types), /infra (Docker Compose, init SQL, OTel Collector config), /docs (documentation)
2. THE project SHALL provide root-level npm scripts that delegate to workspace packages: "dev" (starts the Next.js frontend, Fastify API, and infrastructure services concurrently), "test" (runs test suites across all workspaces and exits with a non-zero code if any test fails), "lint" (runs ESLint and Prettier checks across all workspaces and exits with a non-zero code if any violation is found), "db:init" (creates required database schemas using the init SQL in /infra and exits with a non-zero code if connection or migration fails), "seed" (populates sample observability data into initialized databases)
3. THE shared package SHALL export TypeScript type definitions for the Canonical_Model, and both /apps/web and /apps/api SHALL compile successfully when importing types from the shared package via the workspace protocol
4. IF the "db:init" script is run when the database service is unreachable, THEN THE system SHALL exit with a non-zero code and output an error message indicating the connection failure within 30 seconds

### Requirement 20: Documentation

**User Story:** As a developer, I want clear documentation explaining the architecture and how to run the system, so that I can onboard quickly.

#### Acceptance Criteria

1. THE documentation SHALL include a docs/architecture.md file with Mermaid diagrams covering: a high-level system diagram showing all components (Ingestion_API, Query_API, Web_UI, ClickHouse, Postgres, OTel_Collector), the data flow from ingestion through storage to query, the storage design across ClickHouse and Postgres, and the multi-tenant isolation strategy
2. THE documentation SHALL include a docs/phase-1.md file that explicitly lists features in scope for Phase 1 and features out of scope (including AI investigation, incident management, RUM, synthetics, profiling, SIEM, and third-party integrations)
3. THE documentation SHALL include a docs/local-development.md file containing sections for: prerequisites with required tool versions (Docker, Node.js), setup steps, starting services via Docker Compose, running the Seed_Script to populate sample data, and verifying the setup by confirming each service responds
4. THE documentation SHALL include copy-pasteable curl commands authenticated with the demo API key for each of the following endpoints: /v1/ingest/logs, /v1/ingest/traces, /v1/ingest/metrics, /v1/events/deployments, /v1/logs, /v1/traces, /v1/metrics, /v1/services, and /v1/deployments

### Requirement 21: Automated Tests

**User Story:** As a developer, I want automated tests covering critical paths, so that I can refactor with confidence.

#### Acceptance Criteria

1. THE test suite SHALL include tests verifying API key authentication accepts a valid key (returns HTTP 202 for ingestion or HTTP 200 for query), rejects a missing API key header (returns HTTP 401), and rejects a malformed API key (returns HTTP 401)
2. THE test suite SHALL include tests verifying log ingestion stores records by sending a valid payload to /v1/ingest/logs, confirming HTTP 202, and querying back the inserted log to confirm it exists with the expected tenant_id, service_name, and message
3. THE test suite SHALL include tests verifying trace ingestion stores spans by sending a valid payload to /v1/ingest/traces, confirming HTTP 202, and querying back the inserted span to confirm it exists with the expected tenant_id, trace_id, and operation_name
4. THE test suite SHALL include tests verifying metric ingestion stores data points by sending a valid payload to /v1/ingest/metrics, confirming HTTP 202, and querying back the inserted metric to confirm it exists with the expected tenant_id, metric_name, and value
5. THE test suite SHALL include tests verifying tenant isolation by ingesting data under one test tenant and querying with a different test tenant's API key, confirming the query returns zero records
6. THE test suite SHALL include tests verifying query filtering by inserting records with distinct time ranges, service names, and environments, then querying with each filter and confirming only matching records are returned
7. THE test suite SHALL include tests verifying that each ingestion endpoint (/v1/ingest/logs, /v1/ingest/traces, /v1/ingest/metrics, /v1/events/deployments) returns HTTP 400 with a response body containing an error message of at least 10 characters when sent a payload missing required fields
8. THE test suite SHALL be executable via "npm run test" using Vitest, with all tests using Fastify inject() for HTTP assertions and a dedicated test tenant isolated from seed data
