/**
 * API request/response shape types, query filter types, and error response interface.
 */

import type { CanonicalDeploymentEvent, CanonicalLog, CanonicalSpan, LogSeverity } from './models';
import type { PaginatedResponse } from './pagination';

// ─── Error Response ──────────────────────────────────────────────────────────

export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

// ─── Query Filter Types ──────────────────────────────────────────────────────

export interface LogQueryFilters {
  from?: string; // ISO 8601
  to?: string; // ISO 8601
  service_name?: string;
  environment?: string;
  severity?: LogSeverity;
  trace_id?: string;
  span_id?: string;
  error_type?: string;
  fingerprint?: string;
  version?: string;
  search?: string; // case-insensitive text search on message
  attribute_filters?: LogAttributeFilter[];
  limit?: number;
  cursor?: string;
}

export interface LogGroupQueryFilters extends Omit<LogQueryFilters, 'cursor'> {
  service?: string; // Backward-compatible alias for service_name
}

export interface LogAttributeFilter {
  key: string;
  value: string;
}

export interface TraceQueryFilters {
  from?: string; // ISO 8601
  to?: string; // ISO 8601
  service?: string;
  environment?: string;
  minDuration?: number; // milliseconds
  limit?: number;
  cursor?: string;
}

export interface MetricQueryFilters {
  metric_name?: string;
  service?: string;
  environment?: string;
  from?: string; // ISO 8601
  to?: string; // ISO 8601
  interval?: '1m' | '5m' | '15m' | '1h' | '1d';
  aggregation?: MetricAggregation;
  group_by?: string;
  labels?: Record<string, string>;
}

export type MetricAggregation = 'avg' | 'sum' | 'min' | 'max' | 'count' | 'p50' | 'p95' | 'p99';

export interface ServiceQueryFilters {
  environment?: string;
  from?: string;
  to?: string;
}

export interface DeploymentQueryFilters {
  from?: string; // ISO 8601
  to?: string; // ISO 8601
  service?: string;
  environment?: string;
  limit?: number;
  cursor?: string;
}

// ─── Response Shape Types ────────────────────────────────────────────────────

export interface LogSummary {
  total: number;
  error_count: number;
  warning_count: number;
  from: string;
  to: string;
}

export type LogFacetName =
  | 'services'
  | 'severities'
  | 'environments'
  | 'error_types'
  | 'http_routes'
  | 'fingerprints'
  | 'versions';

export interface LogFacetValue {
  value: string;
  count: number;
}

export type LogFacetCollection = Record<LogFacetName, LogFacetValue[]>;

export interface LogQueryResponse extends PaginatedResponse<CanonicalLog> {
  summary?: LogSummary;
  facets?: LogFacetCollection;
}

export interface LogAroundResponse {
  data: CanonicalLog[];
}

export interface LogGroup {
  fingerprint: string;
  normalized_message: string;
  example_message: string;
  count: number;
  first_seen_at: string;
  last_seen_at: string;
  service_name: string;
  severity: string;
  example_trace_id: string | null;
}

export interface LogGroupsResponse {
  data: LogGroup[];
}

export interface TraceSummary {
  trace_id: string;
  root_service: string;
  root_operation: string;
  duration_ms: number;
  span_count: number;
  status: string;
  timestamp: string; // ISO 8601
}

export type TraceListResponse = PaginatedResponse<TraceSummary>;

export interface TraceDetailResponse {
  data: CanonicalSpan[];
}

export interface MetricDataPoint {
  timestamp: string; // ISO 8601
  value: number;
}

export interface MetricQueryResponse {
  metric_name: string | null;
  aggregation: string;
  interval: string | null;
  data: MetricDataPoint[];
}

export interface MetricCatalogEntry {
  metric_name: string;
  metric_type: string;
  unit: string;
  services: string[];
  last_seen: string;
  sample_count: number;
  label_keys: string[];
}

export interface MetricCatalogResponse {
  data: MetricCatalogEntry[];
}

export interface MetricDetailResponse {
  metric_name: string;
  description: string;
  metric_type: string;
  unit: string;
  services: string[];
  label_keys: string[];
  latest_value: number | null;
  last_seen: string | null;
  sample_count: number;
  example_labels: Record<string, string>;
}

export interface MetricSeriesPoint {
  timestamp: string;
  value: number;
}

export interface MetricSeries {
  name: string;
  labels: Record<string, string>;
  points: MetricSeriesPoint[];
}

export interface MetricComparisonValue {
  current: number;
  previous: number;
  delta: number;
  delta_percent: number | null;
}

export type MetricChangeStatus = 'Large increase' | 'Large decrease' | 'Stable';

export interface MetricBaselineComparison {
  from: string;
  to: string;
  previous_from: string;
  previous_to: string;
  avg: MetricComparisonValue;
  max: MetricComparisonValue;
  p95: MetricComparisonValue;
  count: MetricComparisonValue;
  status: MetricChangeStatus;
  summary: string;
}

export interface MetricSeriesResponse {
  metric_name: string;
  unit: string;
  aggregation: MetricAggregation;
  interval: string;
  group_by: string | null;
  series: MetricSeries[];
  comparison?: MetricBaselineComparison;
}

export interface MetricTopService {
  service_name: string;
  latest_value: number;
  average: number;
  p95: number;
  max: number;
  last_seen: string;
}

export interface MetricTopServicesResponse {
  metric_name: string;
  unit: string;
  aggregation: MetricAggregation;
  data: MetricTopService[];
}

export interface ServiceEntry {
  service_name: string;
  environment: string;
  last_seen: string; // ISO 8601
  log_count: number;
  span_count: number;
  metric_count: number;
  first_seen_at?: string;
  last_seen_at?: string;
  source_signals?: SourceSignals;
  latest_version?: string | null;
  latest_deployment_id?: string | null;
  request_count?: number;
  error_count?: number;
  deployment_count?: number;
  dependency_count?: number;
  avg_latency_ms?: number;
  p95_latency_ms?: number;
  health_status?: HealthStatus;
  updated_at?: string;
}

export interface ServiceListResponse {
  data: ServiceEntry[];
}

export type DeploymentListResponse = PaginatedResponse<CanonicalDeploymentEvent>;

// ─── Service Graph And Correlation Types ────────────────────────────────────

export type HealthStatus = 'healthy' | 'warning' | 'degraded' | 'unknown';

export type DeploymentRiskLevel = 'low' | 'medium' | 'high' | 'unknown';

export interface SourceSignals {
  logs: boolean;
  traces: boolean;
  metrics: boolean;
  deployments: boolean;
  log_count?: number;
  span_count?: number;
  metric_count?: number;
  deployment_count?: number;
}

export interface ServiceSummary {
  id: string;
  service_name: string;
  environment: string;
  first_seen_at: string;
  last_seen_at: string;
  last_seen: string;
  source_signals: SourceSignals;
  latest_version: string | null;
  latest_deployment_id: string | null;
  request_count: number;
  error_count: number;
  log_count: number;
  span_count: number;
  metric_count: number;
  deployment_count: number;
  dependency_count: number;
  avg_latency_ms: number;
  p95_latency_ms: number;
  health_status: HealthStatus;
  updated_at: string;
}

export interface ServiceListResponseV2 {
  data: ServiceSummary[];
}

export interface ServiceMapNode {
  id: string;
  name: string;
  environment: string;
  health_status: HealthStatus;
  request_count: number;
  error_count: number;
  avg_latency_ms: number;
  p95_latency_ms: number;
  last_seen_at: string;
  latest_version: string | null;
  latest_deployment_id: string | null;
}

export interface ServiceDependency {
  id: string;
  environment: string;
  source_service: string;
  target_service: string;
  operation_name: string;
  call_count: number;
  error_count: number;
  avg_duration_ms: number;
  p95_duration_ms: number;
  last_seen_at: string;
  example_trace_id: string | null;
}

export interface ServiceMapEdge {
  id: string;
  environment: string;
  source: string;
  target: string;
  operation_name: string;
  call_count: number;
  error_count: number;
  avg_duration_ms: number;
  p95_duration_ms: number;
  last_seen_at: string;
  example_trace_id: string | null;
}

export interface ServiceMapResponse {
  nodes: ServiceMapNode[];
  edges: ServiceMapEdge[];
}

export interface ErrorGroup {
  id: string;
  service_name: string;
  environment: string;
  fingerprint: string;
  error_type: string | null;
  normalized_message: string;
  example_message: string;
  first_seen_at: string;
  last_seen_at: string;
  count: number;
  affected_traces_count: number;
  example_trace_id: string | null;
  severity: string;
  is_new: boolean;
  updated_at: string;
}

export interface ErrorGroupListResponse {
  data: ErrorGroup[];
}

export interface ErrorGroupDetailResponse {
  data: ErrorGroup;
}

export interface DeploymentImpactSummary {
  risk_level: DeploymentRiskLevel;
  error_count_before: number;
  error_count_after: number;
  p95_latency_before_ms: number;
  p95_latency_after_ms: number;
  new_error_groups: number;
}

export interface DeploymentImpactSignal {
  type: 'error_group' | 'latency' | 'error_rate' | 'deployment';
  message: string;
  error_group_id?: string;
}

export interface DeploymentImpactResponse {
  deployment: CanonicalDeploymentEvent;
  window: {
    before: string;
    after: string;
  };
  summary: DeploymentImpactSummary;
  signals: DeploymentImpactSignal[];
  example_trace_ids: string[];
}

export interface TimelineEvent {
  type:
    | 'deployment'
    | 'new_error_group'
    | 'error_spike'
    | 'latency_spike'
    | 'dependency_degradation'
    | 'service_first_seen';
  timestamp: string;
  title: string;
  severity: 'info' | 'warning' | 'error';
  metadata?: Record<string, unknown>;
}

export interface TimelineResponse {
  data: TimelineEvent[];
}

// ─── Ingestion Request Types ─────────────────────────────────────────────────

export interface DeploymentEventRequest {
  deployment_id?: string;
  service_name: string;
  environment: string;
  version: string;
  timestamp?: string; // ISO 8601
  git_sha?: string;
  deployed_by?: string;
  provider?: string;
  metadata?: Record<string, unknown>;
}
