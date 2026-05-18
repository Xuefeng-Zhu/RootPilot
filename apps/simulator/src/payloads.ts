import type {
  DeploymentEventRequest,
  LogSeverity,
  MetricType,
  SpanKind,
  SpanStatusCode,
} from '@rootpilot/shared';
import { offsetDate, toUnixNano } from './time.js';
import type { LogTelemetry, MetricTelemetry, SpanTelemetry, TelemetryBatch } from './types.js';

export interface OTLPAttribute {
  key: string;
  value: {
    stringValue?: string;
    intValue?: string | number;
    doubleValue?: number;
    boolValue?: boolean;
  };
}

export interface LogsPayload {
  resourceLogs: Array<{
    resource: { attributes: OTLPAttribute[] };
    scopeLogs: Array<{
      scope: { name: string; version: string };
      logRecords: Array<{
        timeUnixNano: string;
        severityNumber: number;
        severityText: string;
        body: { stringValue: string };
        attributes: OTLPAttribute[];
        traceId: string;
        spanId: string;
      }>;
    }>;
  }>;
}

export interface TracesPayload {
  resourceSpans: Array<{
    resource: { attributes: OTLPAttribute[] };
    scopeSpans: Array<{
      scope: { name: string; version: string };
      spans: Array<{
        traceId: string;
        spanId: string;
        parentSpanId: string;
        name: string;
        kind: number;
        startTimeUnixNano: string;
        endTimeUnixNano: string;
        status: { code: number; message?: string };
        attributes: OTLPAttribute[];
      }>;
    }>;
  }>;
}

export interface MetricsPayload {
  resourceMetrics: Array<{
    resource: { attributes: OTLPAttribute[] };
    scopeMetrics: Array<{
      scope: { name: string; version: string };
      metrics: Array<{
        name: string;
        unit: string;
        gauge?: { dataPoints: MetricDataPoint[] };
        sum?: {
          dataPoints: MetricDataPoint[];
          isMonotonic: boolean;
          aggregationTemporality: number;
        };
      }>;
    }>;
  }>;
}

interface MetricDataPoint {
  timeUnixNano: string;
  asDouble: number;
  attributes: OTLPAttribute[];
}

const SEVERITY_NUMBERS: Record<LogSeverity, number> = {
  TRACE: 2,
  DEBUG: 6,
  INFO: 10,
  WARN: 14,
  ERROR: 18,
  FATAL: 22,
};

const SPAN_KIND_NUMBERS: Record<SpanKind, number> = {
  INTERNAL: 1,
  SERVER: 2,
  CLIENT: 3,
  PRODUCER: 4,
  CONSUMER: 5,
};

const STATUS_CODE_NUMBERS: Record<SpanStatusCode, number> = {
  UNSET: 0,
  OK: 1,
  ERROR: 2,
};

export function attribute(key: string, value: string | number | boolean): OTLPAttribute {
  if (typeof value === 'boolean') return { key, value: { boolValue: value } };
  if (typeof value === 'number') {
    if (Number.isInteger(value)) return { key, value: { intValue: value } };
    return { key, value: { doubleValue: value } };
  }
  return { key, value: { stringValue: value } };
}

function attributes(values: Record<string, string | number | boolean>): OTLPAttribute[] {
  return Object.entries(values).map(([key, value]) => attribute(key, value));
}

function resourceAttributes(
  serviceName: string,
  environment: string,
  extra: Record<string, string>,
): OTLPAttribute[] {
  return attributes({
    'service.name': serviceName,
    'deployment.environment': environment,
    ...extra,
  });
}

function groupKey(serviceName: string, environment: string): string {
  return `${serviceName}\u0000${environment}`;
}

function splitKey(key: string): [string, string] {
  return key.split('\u0000') as [string, string];
}

export function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export function buildLogPayloads(logs: LogTelemetry[], maxRecords = 1000): LogsPayload[] {
  return chunkArray(logs, maxRecords).map((chunk) => {
    const groups = new Map<string, LogTelemetry[]>();
    for (const log of chunk) {
      const key = groupKey(log.serviceName, log.environment);
      groups.set(key, [...(groups.get(key) ?? []), log]);
    }

    return {
      resourceLogs: [...groups.entries()].map(([key, records]) => {
        const [serviceName, environment] = splitKey(key);
        return {
          resource: {
            attributes: resourceAttributes(
              serviceName,
              environment,
              records[0]?.resourceAttributes ?? {},
            ),
          },
          scopeLogs: [
            {
              scope: { name: 'rootpilot-simulator', version: '0.1.0' },
              logRecords: records.map((log) => ({
                timeUnixNano: toUnixNano(new Date(log.timestamp)),
                severityNumber: SEVERITY_NUMBERS[log.severity],
                severityText: log.severity,
                body: { stringValue: log.message },
                attributes: attributes(log.attributes),
                traceId: log.traceId,
                spanId: log.spanId,
              })),
            },
          ],
        };
      }),
    };
  });
}

export function buildTracePayloads(spans: SpanTelemetry[], maxRecords = 1000): TracesPayload[] {
  return chunkArray(spans, maxRecords).map((chunk) => {
    const groups = new Map<string, SpanTelemetry[]>();
    for (const span of chunk) {
      const key = groupKey(span.serviceName, span.environment);
      groups.set(key, [...(groups.get(key) ?? []), span]);
    }

    return {
      resourceSpans: [...groups.entries()].map(([key, records]) => {
        const [serviceName, environment] = splitKey(key);
        return {
          resource: {
            attributes: resourceAttributes(
              serviceName,
              environment,
              records[0]?.resourceAttributes ?? {},
            ),
          },
          scopeSpans: [
            {
              scope: { name: 'rootpilot-simulator', version: '0.1.0' },
              spans: records.map((span) => {
                const start = new Date(span.timestamp);
                return {
                  traceId: span.traceId,
                  spanId: span.spanId,
                  parentSpanId: span.parentSpanId,
                  name: span.operationName,
                  kind: SPAN_KIND_NUMBERS[span.kind],
                  startTimeUnixNano: toUnixNano(start),
                  endTimeUnixNano: toUnixNano(offsetDate(start, span.durationMs)),
                  status: {
                    code: STATUS_CODE_NUMBERS[span.statusCode],
                    ...(span.statusMessage ? { message: span.statusMessage } : {}),
                  },
                  attributes: attributes(span.attributes),
                };
              }),
            },
          ],
        };
      }),
    };
  });
}

export function buildMetricPayloads(
  metrics: MetricTelemetry[],
  maxRecords = 1000,
): MetricsPayload[] {
  return chunkArray(metrics, maxRecords).map((chunk) => {
    const resourceGroups = new Map<string, MetricTelemetry[]>();
    for (const metric of chunk) {
      const key = groupKey(metric.serviceName, metric.environment);
      resourceGroups.set(key, [...(resourceGroups.get(key) ?? []), metric]);
    }

    return {
      resourceMetrics: [...resourceGroups.entries()].map(([key, records]) => {
        const [serviceName, environment] = splitKey(key);
        const metricGroups = new Map<string, MetricTelemetry[]>();
        for (const metric of records) {
          const metricKey = `${metric.metricName}\u0000${metric.metricType}\u0000${metric.unit}`;
          metricGroups.set(metricKey, [...(metricGroups.get(metricKey) ?? []), metric]);
        }

        return {
          resource: {
            attributes: resourceAttributes(
              serviceName,
              environment,
              records[0]?.resourceAttributes ?? {},
            ),
          },
          scopeMetrics: [
            {
              scope: { name: 'rootpilot-simulator', version: '0.1.0' },
              metrics: [...metricGroups.entries()].map(([metricKey, metricRecords]) => {
                const [name, type, unit] = metricKey.split('\u0000') as [
                  string,
                  MetricType,
                  string,
                ];
                const dataPoints = metricRecords.map((metric) => ({
                  timeUnixNano: toUnixNano(new Date(metric.timestamp)),
                  asDouble: metric.value,
                  attributes: attributes(metric.labels),
                }));
                if (type === 'sum') {
                  return {
                    name,
                    unit,
                    sum: {
                      dataPoints,
                      isMonotonic: true,
                      aggregationTemporality: 2,
                    },
                  };
                }
                return {
                  name,
                  unit,
                  gauge: { dataPoints },
                };
              }),
            },
          ],
        };
      }),
    };
  });
}

export function buildDryRunPayload(batch: TelemetryBatch): {
  logs: LogsPayload[];
  traces: TracesPayload[];
  metrics: MetricsPayload[];
  deployments: DeploymentEventRequest[];
} {
  return {
    logs: buildLogPayloads(batch.logs),
    traces: buildTracePayloads(batch.spans),
    metrics: buildMetricPayloads(batch.metrics),
    deployments: batch.deploymentEvents,
  };
}
