/**
 * API request/response shape types, query filter types, and error response interface.
 */

import type {
  CanonicalDeploymentEvent,
  CanonicalLog,
  CanonicalSpan,
  LogSeverity,
} from './models';
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
  search?: string; // case-insensitive text search on message
  limit?: number;
  cursor?: string;
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
  aggregation?: 'avg' | 'sum' | 'min' | 'max' | 'count';
}

export interface ServiceQueryFilters {
  environment?: string;
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

export type LogQueryResponse = PaginatedResponse<CanonicalLog>;

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
  metric_name: string;
  aggregation: string;
  interval: string | null;
  data: MetricDataPoint[];
}

export interface ServiceEntry {
  service_name: string;
  environment: string;
  last_seen: string; // ISO 8601
  log_count: number;
  span_count: number;
  metric_count: number;
}

export interface ServiceListResponse {
  data: ServiceEntry[];
}

export type DeploymentListResponse = PaginatedResponse<CanonicalDeploymentEvent>;

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
