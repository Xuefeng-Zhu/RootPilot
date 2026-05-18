-- RootPilot Postgres Initialization
-- Creates tenant metadata and correlation tables.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Tenants
CREATE TABLE tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(50) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT slug_format CHECK (slug ~ '^[a-z0-9][a-z0-9-]*[a-z0-9]$')
);

-- Projects
CREATE TABLE projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(50) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT project_slug_format CHECK (slug ~ '^[a-z0-9][a-z0-9-]*[a-z0-9]$'),
    UNIQUE (tenant_id, slug)
);

-- API Keys
CREATE TABLE api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    key_hash VARCHAR(128) NOT NULL,
    key_prefix VARCHAR(8) NOT NULL,
    name VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMPTZ
);

CREATE INDEX idx_api_keys_hash ON api_keys(key_hash);
CREATE INDEX idx_api_keys_tenant ON api_keys(tenant_id);

-- Schema migrations
CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(255) PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Correlation service summaries
CREATE TABLE IF NOT EXISTS service_summaries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    service_name VARCHAR(255) NOT NULL,
    environment VARCHAR(100) NOT NULL,
    first_seen_at TIMESTAMPTZ NOT NULL,
    last_seen_at TIMESTAMPTZ NOT NULL,
    source_signals JSONB NOT NULL DEFAULT '{}'::jsonb,
    latest_version VARCHAR(100),
    latest_deployment_id VARCHAR(100),
    request_count BIGINT NOT NULL DEFAULT 0,
    error_count BIGINT NOT NULL DEFAULT 0,
    log_count BIGINT NOT NULL DEFAULT 0,
    span_count BIGINT NOT NULL DEFAULT 0,
    metric_count BIGINT NOT NULL DEFAULT 0,
    deployment_count BIGINT NOT NULL DEFAULT 0,
    dependency_count BIGINT NOT NULL DEFAULT 0,
    avg_latency_ms DOUBLE PRECISION NOT NULL DEFAULT 0,
    p95_latency_ms DOUBLE PRECISION NOT NULL DEFAULT 0,
    health_status VARCHAR(20) NOT NULL DEFAULT 'unknown',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT service_summaries_health_status CHECK (
        health_status IN ('healthy', 'warning', 'degraded', 'unknown')
    ),
    UNIQUE (tenant_id, project_id, service_name, environment)
);

CREATE INDEX IF NOT EXISTS idx_service_summaries_tenant_project_env
    ON service_summaries (tenant_id, project_id, environment);
CREATE INDEX IF NOT EXISTS idx_service_summaries_service
    ON service_summaries (tenant_id, project_id, service_name);
CREATE INDEX IF NOT EXISTS idx_service_summaries_last_seen
    ON service_summaries (tenant_id, project_id, last_seen_at DESC);

-- Correlation service dependency edges
CREATE TABLE IF NOT EXISTS service_dependencies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    environment VARCHAR(100) NOT NULL,
    source_service VARCHAR(255) NOT NULL,
    target_service VARCHAR(255) NOT NULL,
    operation_name VARCHAR(500) NOT NULL,
    call_count BIGINT NOT NULL DEFAULT 0,
    error_count BIGINT NOT NULL DEFAULT 0,
    avg_duration_ms DOUBLE PRECISION NOT NULL DEFAULT 0,
    p95_duration_ms DOUBLE PRECISION NOT NULL DEFAULT 0,
    last_seen_at TIMESTAMPTZ NOT NULL,
    example_trace_id VARCHAR(255),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (
        tenant_id,
        project_id,
        environment,
        source_service,
        target_service,
        operation_name
    )
);

CREATE INDEX IF NOT EXISTS idx_service_dependencies_tenant_project_env
    ON service_dependencies (tenant_id, project_id, environment);
CREATE INDEX IF NOT EXISTS idx_service_dependencies_source
    ON service_dependencies (tenant_id, project_id, source_service);
CREATE INDEX IF NOT EXISTS idx_service_dependencies_target
    ON service_dependencies (tenant_id, project_id, target_service);
CREATE INDEX IF NOT EXISTS idx_service_dependencies_last_seen
    ON service_dependencies (tenant_id, project_id, last_seen_at DESC);

-- Correlation deterministic error groups
CREATE TABLE IF NOT EXISTS error_groups (
    id VARCHAR(80) PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    service_name VARCHAR(255) NOT NULL,
    environment VARCHAR(100) NOT NULL,
    fingerprint VARCHAR(128) NOT NULL,
    error_type VARCHAR(255),
    normalized_message TEXT NOT NULL,
    example_message TEXT NOT NULL,
    first_seen_at TIMESTAMPTZ NOT NULL,
    last_seen_at TIMESTAMPTZ NOT NULL,
    count BIGINT NOT NULL DEFAULT 0,
    affected_traces_count BIGINT NOT NULL DEFAULT 0,
    example_trace_id VARCHAR(255),
    severity VARCHAR(20) NOT NULL DEFAULT 'error',
    is_new BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, project_id, service_name, environment, fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_error_groups_tenant_project_env
    ON error_groups (tenant_id, project_id, environment);
CREATE INDEX IF NOT EXISTS idx_error_groups_service
    ON error_groups (tenant_id, project_id, service_name);
CREATE INDEX IF NOT EXISTS idx_error_groups_fingerprint
    ON error_groups (tenant_id, project_id, fingerprint);
CREATE INDEX IF NOT EXISTS idx_error_groups_last_seen
    ON error_groups (tenant_id, project_id, last_seen_at DESC);

-- Correlation deployment impact summaries
CREATE TABLE IF NOT EXISTS deployment_impacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    deployment_id VARCHAR(100) NOT NULL,
    service_name VARCHAR(255) NOT NULL,
    environment VARCHAR(100) NOT NULL,
    before_window_minutes INTEGER NOT NULL DEFAULT 30,
    after_window_minutes INTEGER NOT NULL DEFAULT 30,
    error_count_before BIGINT NOT NULL DEFAULT 0,
    error_count_after BIGINT NOT NULL DEFAULT 0,
    p95_latency_before_ms DOUBLE PRECISION NOT NULL DEFAULT 0,
    p95_latency_after_ms DOUBLE PRECISION NOT NULL DEFAULT 0,
    new_error_groups_count BIGINT NOT NULL DEFAULT 0,
    risk_level VARCHAR(20) NOT NULL DEFAULT 'low',
    summary_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, project_id, deployment_id)
);

CREATE INDEX IF NOT EXISTS idx_deployment_impacts_tenant_project
    ON deployment_impacts (tenant_id, project_id);
CREATE INDEX IF NOT EXISTS idx_deployment_impacts_deployment
    ON deployment_impacts (tenant_id, project_id, deployment_id);
CREATE INDEX IF NOT EXISTS idx_deployment_impacts_service
    ON deployment_impacts (tenant_id, project_id, service_name);
CREATE INDEX IF NOT EXISTS idx_deployment_impacts_calculated
    ON deployment_impacts (tenant_id, project_id, calculated_at DESC);
