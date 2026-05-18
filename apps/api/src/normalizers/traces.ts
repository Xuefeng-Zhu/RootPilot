import { v4 as uuidv4 } from 'uuid';
import type { CanonicalSpan, SpanKind, SpanStatusCode } from '@rootpilot/shared';

/**
 * OTLP attribute key-value pair format.
 */
interface OTLPAttribute {
  key: string;
  value: {
    stringValue?: string;
    intValue?: string | number;
    doubleValue?: number;
    boolValue?: boolean;
    arrayValue?: unknown;
    kvlistValue?: unknown;
  };
}

/**
 * OTLP span status.
 */
interface OTLPSpanStatus {
  code?: number;
  message?: string;
}

/**
 * OTLP span structure within scopeSpans.
 */
interface OTLPSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind?: number;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  status?: OTLPSpanStatus;
  attributes?: OTLPAttribute[];
}

/**
 * OTLP scope containing spans.
 */
interface OTLPScopeSpans {
  scope?: { name?: string };
  spans: OTLPSpan[];
}

/**
 * OTLP resource containing scope spans.
 */
export interface OTLPResourceSpans {
  resource?: {
    attributes?: OTLPAttribute[];
  };
  scopeSpans: OTLPScopeSpans[];
}

/**
 * Maps OTLP span kind integer to string enum.
 * 0 and 1 both map to INTERNAL (0 = UNSPECIFIED, 1 = INTERNAL in OTLP).
 */
const SPAN_KIND_MAP: Record<number, SpanKind> = {
  0: 'INTERNAL',
  1: 'INTERNAL',
  2: 'SERVER',
  3: 'CLIENT',
  4: 'PRODUCER',
  5: 'CONSUMER',
};

/**
 * Maps OTLP status code integer to string enum.
 */
const STATUS_CODE_MAP: Record<number, SpanStatusCode> = {
  0: 'UNSET',
  1: 'OK',
  2: 'ERROR',
};

/**
 * Flattens OTLP key-value attribute array to a simple Record<string, string>.
 */
function flattenAttributes(attrs?: OTLPAttribute[]): Record<string, string> {
  if (!attrs || !Array.isArray(attrs)) {
    return {};
  }

  const result: Record<string, string> = {};
  for (const attr of attrs) {
    if (!attr.key || !attr.value) continue;

    const val = attr.value;
    if (val.stringValue !== undefined) {
      result[attr.key] = val.stringValue;
    } else if (val.intValue !== undefined) {
      result[attr.key] = String(val.intValue);
    } else if (val.doubleValue !== undefined) {
      result[attr.key] = String(val.doubleValue);
    } else if (val.boolValue !== undefined) {
      result[attr.key] = String(val.boolValue);
    }
  }
  return result;
}

/**
 * Converts nanosecond timestamp (as string) to ISO 8601 string.
 */
function nanoToISO(nanoStr: string): string {
  const nanos = BigInt(nanoStr);
  const millis = Number(nanos / BigInt(1_000_000));
  return new Date(millis).toISOString();
}

/**
 * Computes duration in milliseconds from start and end nanosecond timestamps.
 * duration_ms = (endTimeUnixNano - startTimeUnixNano) / 1,000,000
 */
function computeDurationMs(startNano: string, endNano: string): number {
  const start = BigInt(startNano);
  const end = BigInt(endNano);
  return Number(end - start) / 1_000_000;
}

/**
 * Maps span kind integer to SpanKind string.
 * Returns 'INTERNAL' for unrecognized values.
 */
export function mapSpanKind(kind?: number): SpanKind {
  if (kind === undefined || kind === null) {
    return 'INTERNAL';
  }
  return SPAN_KIND_MAP[kind] ?? 'INTERNAL';
}

/**
 * Maps status code integer to SpanStatusCode string.
 * Returns 'UNSET' for unrecognized values.
 */
export function mapStatusCode(code?: number): SpanStatusCode {
  if (code === undefined || code === null) {
    return 'UNSET';
  }
  return STATUS_CODE_MAP[code] ?? 'UNSET';
}

/**
 * Normalizes OTLP resourceSpans into flat CanonicalSpan records.
 *
 * Parses the nested OTLP structure (resourceSpans → scopeSpans → spans),
 * extracts resource-level attributes (service.name, deployment.environment),
 * computes duration, maps kind and status enums, and produces canonical spans.
 */
export function normalizeSpans(
  resourceSpans: OTLPResourceSpans[],
  tenantId: string,
  projectId: string,
): CanonicalSpan[] {
  const receivedAt = new Date().toISOString();
  const spans: CanonicalSpan[] = [];

  for (const resourceSpan of resourceSpans) {
    const resourceAttrs = flattenAttributes(resourceSpan.resource?.attributes);
    const serviceName = resourceAttrs['service.name'] ?? '';
    const environment = resourceAttrs['deployment.environment'] ?? '';

    for (const scopeSpan of resourceSpan.scopeSpans) {
      for (const span of scopeSpan.spans) {
        const canonicalSpan: CanonicalSpan = {
          id: uuidv4(),
          tenant_id: tenantId,
          project_id: projectId,
          timestamp: nanoToISO(span.startTimeUnixNano),
          received_at: receivedAt,
          service_name: serviceName,
          environment,
          source: 'otlp',
          resource_attributes: resourceAttrs,
          attributes: flattenAttributes(span.attributes),
          trace_id: span.traceId,
          span_id: span.spanId,
          parent_span_id:
            span.parentSpanId && span.parentSpanId.length > 0 ? span.parentSpanId : null,
          operation_name: span.name,
          duration_ms: computeDurationMs(span.startTimeUnixNano, span.endTimeUnixNano),
          status_code: mapStatusCode(span.status?.code),
          status_message: span.status?.message ?? '',
          kind: mapSpanKind(span.kind),
        };

        spans.push(canonicalSpan);
      }
    }
  }

  return spans;
}
