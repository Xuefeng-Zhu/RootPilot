import { v4 as uuidv4 } from 'uuid';
import type { CanonicalLog, LogSeverity } from '@rootpilot/shared';

/**
 * OTLP attribute key-value pair format.
 */
interface OTLPAttribute {
  key: string;
  value: {
    stringValue?: string;
    intValue?: string | number;
    boolValue?: boolean;
    doubleValue?: number;
    arrayValue?: unknown;
    kvlistValue?: unknown;
  };
}

/**
 * OTLP log record structure within a scopeLog.
 */
interface OTLPLogRecord {
  timeUnixNano?: string;
  observedTimeUnixNano?: string;
  severityNumber?: number;
  severityText?: string;
  body?: {
    stringValue?: string;
  };
  attributes?: OTLPAttribute[];
  traceId?: string;
  spanId?: string;
}

/**
 * OTLP scope logs structure containing log records.
 */
interface OTLPScopeLogs {
  scope?: {
    name?: string;
    version?: string;
  };
  logRecords?: OTLPLogRecord[];
}

/**
 * OTLP resource logs structure — top-level element in the payload.
 */
export interface OTLPResourceLogs {
  resource?: {
    attributes?: OTLPAttribute[];
  };
  scopeLogs?: OTLPScopeLogs[];
}

/**
 * Maps an OTLP severityNumber to a canonical severity string.
 *
 * Ranges:
 * - 1–4: TRACE
 * - 5–8: DEBUG
 * - 9–12: INFO
 * - 13–16: WARN
 * - 17–20: ERROR
 * - 21–24: FATAL
 * - absent or outside 1–24: INFO (default)
 */
export function mapSeverityNumber(severityNumber?: number): LogSeverity {
  if (severityNumber == null || severityNumber < 1 || severityNumber > 24) {
    return 'INFO';
  }

  if (severityNumber <= 4) return 'TRACE';
  if (severityNumber <= 8) return 'DEBUG';
  if (severityNumber <= 12) return 'INFO';
  if (severityNumber <= 16) return 'WARN';
  if (severityNumber <= 20) return 'ERROR';
  return 'FATAL';
}

/**
 * Converts OTLP attribute array to a flat Record<string, string>.
 */
export function flattenAttributes(attributes?: OTLPAttribute[]): Record<string, string> {
  if (!attributes || !Array.isArray(attributes)) {
    return {};
  }

  const result: Record<string, string> = {};
  for (const attr of attributes) {
    if (!attr.key || !attr.value) continue;

    const val = attr.value;
    if (val.stringValue !== undefined) {
      result[attr.key] = val.stringValue;
    } else if (val.intValue !== undefined) {
      result[attr.key] = String(val.intValue);
    } else if (val.boolValue !== undefined) {
      result[attr.key] = String(val.boolValue);
    } else if (val.doubleValue !== undefined) {
      result[attr.key] = String(val.doubleValue);
    }
  }
  return result;
}

/**
 * Converts a nanosecond timestamp string to an ISO 8601 string.
 * Returns null if the input is absent or invalid.
 */
export function nanoToISO(timeUnixNano?: string): string | null {
  if (!timeUnixNano) return null;

  const nanos = BigInt(timeUnixNano);
  const millis = Number(nanos / BigInt(1_000_000));
  if (isNaN(millis) || millis <= 0) return null;

  return new Date(millis).toISOString();
}

/**
 * Normalizes OTLP resourceLogs into canonical log records.
 *
 * Parses the OTLP structure: resourceLogs → scopeLogs → logRecords
 * and produces flat CanonicalLog records ready for ClickHouse insertion.
 */
export function normalizeLogRecords(
  resourceLogs: OTLPResourceLogs[],
  tenantId: string,
  projectId: string,
): CanonicalLog[] {
  const receivedAt = new Date().toISOString();
  const results: CanonicalLog[] = [];

  for (const resourceLog of resourceLogs) {
    const resourceAttributes = flattenAttributes(resourceLog.resource?.attributes);
    const serviceName = resourceAttributes['service.name'] || '';
    const environment = resourceAttributes['deployment.environment'] || '';

    const scopeLogs = resourceLog.scopeLogs || [];

    for (const scopeLog of scopeLogs) {
      const logRecords = scopeLog.logRecords || [];

      for (const logRecord of logRecords) {
        const timestamp = nanoToISO(logRecord.timeUnixNano) || receivedAt;

        const severity = mapSeverityNumber(logRecord.severityNumber);
        const message = logRecord.body?.stringValue || '';
        const attributes = flattenAttributes(logRecord.attributes);

        const canonicalLog: CanonicalLog = {
          id: uuidv4(),
          tenant_id: tenantId,
          project_id: projectId,
          timestamp,
          received_at: receivedAt,
          service_name: serviceName,
          environment,
          source: scopeLog.scope?.name || '',
          resource_attributes: resourceAttributes,
          attributes,
          severity,
          message,
          trace_id: logRecord.traceId || '',
          span_id: logRecord.spanId || '',
          fingerprint: '',
        };

        results.push(canonicalLog);
      }
    }
  }

  return results;
}
