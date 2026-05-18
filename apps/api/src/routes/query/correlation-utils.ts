import type {
  DeploymentImpactResponse,
  ErrorGroup,
  HealthStatus,
  ServiceDependency,
  ServiceMapEdge,
  ServiceMapNode,
  ServiceSummary,
  SourceSignals,
  TimelineEvent,
} from '@rootpilot/shared';
import type { CanonicalDeploymentEvent } from '@rootpilot/shared';

export interface ServiceSummaryRow {
  id: string;
  service_name: string;
  environment: string;
  first_seen_at: string;
  last_seen_at: string;
  source_signals: SourceSignals | string;
  latest_version: string | null;
  latest_deployment_id: string | null;
  request_count: string | number;
  error_count: string | number;
  log_count: string | number;
  span_count: string | number;
  metric_count: string | number;
  deployment_count: string | number;
  dependency_count: string | number;
  avg_latency_ms: string | number;
  p95_latency_ms: string | number;
  health_status: HealthStatus;
  updated_at: string;
}

export interface ServiceDependencyRow {
  id: string;
  environment: string;
  source_service: string;
  target_service: string;
  operation_name: string;
  call_count: string | number;
  error_count: string | number;
  avg_duration_ms: string | number;
  p95_duration_ms: string | number;
  last_seen_at: string;
  example_trace_id: string | null;
}

export interface ErrorGroupRow {
  id: string;
  service_name: string;
  environment: string;
  fingerprint: string;
  error_type: string | null;
  normalized_message: string;
  example_message: string;
  first_seen_at: string;
  last_seen_at: string;
  count: string | number;
  affected_traces_count: string | number;
  example_trace_id: string | null;
  severity: string;
  is_new: boolean;
  updated_at: string;
}

export interface DeploymentImpactRow {
  deployment_id: string;
  service_name: string;
  environment: string;
  before_window_minutes: string | number;
  after_window_minutes: string | number;
  error_count_before: string | number;
  error_count_after: string | number;
  p95_latency_before_ms: string | number;
  p95_latency_after_ms: string | number;
  new_error_groups_count: string | number;
  risk_level: 'low' | 'medium' | 'high' | 'unknown';
  summary_json: string | Record<string, unknown>;
  calculated_at: string;
}

export function toNumber(value: string | number | null | undefined): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export function parseJsonObject(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'object') return value as Record<string, unknown>;
  if (typeof value !== 'string') return {};

  try {
    const parsed = JSON.parse(value);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

export function mapServiceSummary(row: ServiceSummaryRow): ServiceSummary {
  const sourceSignals = parseJsonObject(row.source_signals) as unknown as SourceSignals;
  return {
    id: row.id,
    service_name: row.service_name,
    environment: row.environment,
    first_seen_at: row.first_seen_at,
    last_seen_at: row.last_seen_at,
    last_seen: row.last_seen_at,
    source_signals: {
      logs: Boolean(sourceSignals.logs),
      traces: Boolean(sourceSignals.traces),
      metrics: Boolean(sourceSignals.metrics),
      deployments: Boolean(sourceSignals.deployments),
      log_count: toNumber(sourceSignals.log_count),
      span_count: toNumber(sourceSignals.span_count),
      metric_count: toNumber(sourceSignals.metric_count),
      deployment_count: toNumber(sourceSignals.deployment_count),
    },
    latest_version: row.latest_version,
    latest_deployment_id: row.latest_deployment_id,
    request_count: toNumber(row.request_count),
    error_count: toNumber(row.error_count),
    log_count: toNumber(row.log_count),
    span_count: toNumber(row.span_count),
    metric_count: toNumber(row.metric_count),
    deployment_count: toNumber(row.deployment_count),
    dependency_count: toNumber(row.dependency_count),
    avg_latency_ms: toNumber(row.avg_latency_ms),
    p95_latency_ms: toNumber(row.p95_latency_ms),
    health_status: row.health_status,
    updated_at: row.updated_at,
  };
}

export function mapServiceDependency(row: ServiceDependencyRow): ServiceDependency {
  return {
    id: row.id,
    environment: row.environment,
    source_service: row.source_service,
    target_service: row.target_service,
    operation_name: row.operation_name,
    call_count: toNumber(row.call_count),
    error_count: toNumber(row.error_count),
    avg_duration_ms: toNumber(row.avg_duration_ms),
    p95_duration_ms: toNumber(row.p95_duration_ms),
    last_seen_at: row.last_seen_at,
    example_trace_id: row.example_trace_id,
  };
}

export function mapServiceMapNode(row: ServiceSummaryRow): ServiceMapNode {
  const summary = mapServiceSummary(row);
  return {
    id: summary.service_name,
    name: summary.service_name,
    environment: summary.environment,
    health_status: summary.health_status,
    request_count: summary.request_count,
    error_count: summary.error_count,
    avg_latency_ms: summary.avg_latency_ms,
    p95_latency_ms: summary.p95_latency_ms,
    last_seen_at: summary.last_seen_at,
    latest_version: summary.latest_version,
    latest_deployment_id: summary.latest_deployment_id,
  };
}

export function mapServiceMapEdge(row: ServiceDependencyRow): ServiceMapEdge {
  return {
    id: `${row.source_service}->${row.target_service}:${row.operation_name}`,
    source: row.source_service,
    target: row.target_service,
    operation_name: row.operation_name,
    call_count: toNumber(row.call_count),
    error_count: toNumber(row.error_count),
    avg_duration_ms: toNumber(row.avg_duration_ms),
    p95_duration_ms: toNumber(row.p95_duration_ms),
    last_seen_at: row.last_seen_at,
    example_trace_id: row.example_trace_id,
  };
}

export function mapErrorGroup(row: ErrorGroupRow): ErrorGroup {
  return {
    id: row.id,
    service_name: row.service_name,
    environment: row.environment,
    fingerprint: row.fingerprint,
    error_type: row.error_type,
    normalized_message: row.normalized_message,
    example_message: row.example_message,
    first_seen_at: row.first_seen_at,
    last_seen_at: row.last_seen_at,
    count: toNumber(row.count),
    affected_traces_count: toNumber(row.affected_traces_count),
    example_trace_id: row.example_trace_id,
    severity: row.severity,
    is_new: row.is_new,
    updated_at: row.updated_at,
  };
}

export function buildDeploymentImpactResponse(
  deployment: CanonicalDeploymentEvent,
  impact: DeploymentImpactRow | null,
): DeploymentImpactResponse {
  const summaryJson = parseJsonObject(impact?.summary_json);
  const signals = Array.isArray(summaryJson.signals) ? summaryJson.signals : [];
  const exampleTraceIds = Array.isArray(summaryJson.example_trace_ids)
    ? summaryJson.example_trace_ids.filter((value): value is string => typeof value === 'string')
    : [];

  return {
    deployment,
    window: {
      before: `${toNumber(impact?.before_window_minutes ?? 30)}m`,
      after: `${toNumber(impact?.after_window_minutes ?? 30)}m`,
    },
    summary: {
      risk_level: impact?.risk_level ?? 'unknown',
      error_count_before: toNumber(impact?.error_count_before),
      error_count_after: toNumber(impact?.error_count_after),
      p95_latency_before_ms: toNumber(impact?.p95_latency_before_ms),
      p95_latency_after_ms: toNumber(impact?.p95_latency_after_ms),
      new_error_groups: toNumber(impact?.new_error_groups_count),
    },
    signals: signals
      .filter((signal): signal is { type: string; message: string; error_group_id?: string } => {
        return (
          typeof signal === 'object' &&
          signal !== null &&
          typeof signal.type === 'string' &&
          typeof signal.message === 'string'
        );
      })
      .map((signal) => ({
        type:
          signal.type === 'latency' || signal.type === 'error_rate' || signal.type === 'deployment'
            ? signal.type
            : 'error_group',
        message: signal.message,
        error_group_id: signal.error_group_id,
      })),
    example_trace_ids: exampleTraceIds,
  };
}

export function timelineSort(a: TimelineEvent, b: TimelineEvent): number {
  return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
}
