/**
 * Canonical data models for RootPilot telemetry storage.
 * These interfaces represent the normalized internal representation
 * of telemetry records stored in ClickHouse.
 */

export type LogSeverity = 'TRACE' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';

export type SpanStatusCode = 'UNSET' | 'OK' | 'ERROR';

export type SpanKind = 'INTERNAL' | 'SERVER' | 'CLIENT' | 'PRODUCER' | 'CONSUMER';

export type MetricType = 'gauge' | 'sum' | 'histogram';

export interface CanonicalLog {
  id: string;
  tenant_id: string;
  project_id: string;
  timestamp: string; // ISO 8601
  received_at: string; // ISO 8601
  service_name: string;
  environment: string;
  source: string;
  resource_attributes: Record<string, string>;
  attributes: Record<string, string>;
  severity: LogSeverity;
  message: string;
  trace_id: string;
  span_id: string;
  fingerprint: string;
}

export interface CanonicalSpan {
  id: string;
  tenant_id: string;
  project_id: string;
  timestamp: string; // ISO 8601
  received_at: string; // ISO 8601
  service_name: string;
  environment: string;
  source: string;
  resource_attributes: Record<string, string>;
  attributes: Record<string, string>;
  trace_id: string;
  span_id: string;
  parent_span_id: string | null;
  operation_name: string;
  duration_ms: number;
  status_code: SpanStatusCode;
  status_message: string;
  kind: SpanKind;
}

export interface CanonicalMetric {
  id: string;
  tenant_id: string;
  project_id: string;
  timestamp: string; // ISO 8601
  received_at: string; // ISO 8601
  service_name: string;
  environment: string;
  source: string;
  resource_attributes: Record<string, string>;
  attributes: Record<string, string>;
  metric_name: string;
  metric_type: MetricType;
  value: number;
  unit: string;
  labels: Record<string, string>;
}

export interface CanonicalDeploymentEvent {
  deployment_id: string;
  tenant_id: string;
  project_id: string;
  timestamp: string; // ISO 8601
  service_name: string;
  environment: string;
  version: string;
  git_sha: string;
  deployed_by: string;
  provider: string;
  metadata: Record<string, unknown>;
}
