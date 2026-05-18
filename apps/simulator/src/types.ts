import type {
  DeploymentEventRequest,
  LogSeverity,
  MetricType,
  SpanKind,
  SpanStatusCode,
} from '@rootpilot/shared';

export type ScenarioName =
  | 'normal'
  | 'checkout-error'
  | 'bad-deploy'
  | 'database-degradation'
  | 'cache-miss-storm'
  | 'high-cardinality'
  | 'multi-service'
  | 'multi-tenant';

export interface SimulatorConfig {
  baseUrl: string;
  apiKey: string;
  secondaryApiKey?: string;
  tenant: string;
  project: string;
  environment: string;
  scenario: ScenarioName;
  durationMs: number;
  rate: number;
  services?: string[];
  seed?: number;
  verbose: boolean;
  dryRun: boolean;
  once: boolean;
}

export interface SimulationSummary {
  logsSent: number;
  spansSent: number;
  metricsSent: number;
  deploymentEventsSent: number;
  servicesGenerated: Set<string>;
  errorsGenerated: number;
  failedHttpRequests: number;
  scenario: ScenarioName;
  durationMs: number;
}

export interface LogTelemetry {
  timestamp: string;
  serviceName: string;
  environment: string;
  severity: LogSeverity;
  message: string;
  traceId: string;
  spanId: string;
  attributes: Record<string, string | number | boolean>;
  resourceAttributes: Record<string, string>;
}

export interface SpanTelemetry {
  traceId: string;
  spanId: string;
  parentSpanId: string;
  timestamp: string;
  serviceName: string;
  environment: string;
  operationName: string;
  durationMs: number;
  statusCode: SpanStatusCode;
  statusMessage: string;
  kind: SpanKind;
  attributes: Record<string, string | number | boolean>;
  resourceAttributes: Record<string, string>;
}

export interface MetricTelemetry {
  timestamp: string;
  serviceName: string;
  environment: string;
  metricName: string;
  metricType: MetricType;
  value: number;
  unit: string;
  labels: Record<string, string | number | boolean>;
  resourceAttributes: Record<string, string>;
}

export interface TelemetryBatch {
  logs: LogTelemetry[];
  spans: SpanTelemetry[];
  metrics: MetricTelemetry[];
  deploymentEvents: DeploymentEventRequest[];
}

export interface GenerateBatchOptions {
  timestamp: Date;
  requestCount: number;
}

export interface SendResult {
  logsSent: number;
  spansSent: number;
  metricsSent: number;
  deploymentEventsSent: number;
  failedHttpRequests: number;
}

export interface HttpFetch {
  (input: string, init: RequestInit): Promise<Response>;
}
