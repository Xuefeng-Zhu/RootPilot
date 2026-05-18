CREATE DATABASE IF NOT EXISTS rootpilot;

-- Logs table
CREATE TABLE rootpilot.logs (
    id UUID DEFAULT generateUUIDv4(),
    tenant_id LowCardinality(String),
    project_id String,
    timestamp DateTime64(3),
    received_at DateTime64(3) DEFAULT now64(3),
    service_name LowCardinality(String),
    environment LowCardinality(String),
    source String DEFAULT '',
    resource_attributes String DEFAULT '{}',
    attributes String DEFAULT '{}',
    severity LowCardinality(String),
    message String,
    trace_id String DEFAULT '',
    span_id String DEFAULT '',
    fingerprint String DEFAULT ''
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(timestamp)
ORDER BY (tenant_id, service_name, timestamp)
TTL toDateTime(timestamp) + INTERVAL 90 DAY;

-- Spans table
CREATE TABLE rootpilot.spans (
    id UUID DEFAULT generateUUIDv4(),
    tenant_id LowCardinality(String),
    project_id String,
    timestamp DateTime64(3),
    received_at DateTime64(3) DEFAULT now64(3),
    service_name LowCardinality(String),
    environment LowCardinality(String),
    source String DEFAULT '',
    resource_attributes String DEFAULT '{}',
    attributes String DEFAULT '{}',
    trace_id String,
    span_id String,
    parent_span_id String DEFAULT '',
    operation_name String,
    duration_ms Float64,
    status_code LowCardinality(String),
    status_message String DEFAULT '',
    kind LowCardinality(String)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(timestamp)
ORDER BY (tenant_id, trace_id, timestamp)
TTL toDateTime(timestamp) + INTERVAL 90 DAY;

-- Metrics table
CREATE TABLE rootpilot.metrics (
    id UUID DEFAULT generateUUIDv4(),
    tenant_id LowCardinality(String),
    project_id String,
    timestamp DateTime64(3),
    received_at DateTime64(3) DEFAULT now64(3),
    service_name LowCardinality(String),
    environment LowCardinality(String),
    source String DEFAULT '',
    resource_attributes String DEFAULT '{}',
    attributes String DEFAULT '{}',
    metric_name LowCardinality(String),
    metric_type LowCardinality(String),
    value Float64,
    unit String DEFAULT '',
    labels String DEFAULT '{}'
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(timestamp)
ORDER BY (tenant_id, metric_name, timestamp)
TTL toDateTime(timestamp) + INTERVAL 90 DAY;

-- Deployment Events table
CREATE TABLE rootpilot.deployment_events (
    deployment_id UUID DEFAULT generateUUIDv4(),
    tenant_id LowCardinality(String),
    project_id String,
    timestamp DateTime64(3),
    service_name LowCardinality(String),
    environment LowCardinality(String),
    version String,
    git_sha String DEFAULT '',
    deployed_by String DEFAULT '',
    provider String DEFAULT '',
    metadata String DEFAULT '{}'
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(timestamp)
ORDER BY (tenant_id, service_name, timestamp)
TTL toDateTime(timestamp) + INTERVAL 90 DAY;
