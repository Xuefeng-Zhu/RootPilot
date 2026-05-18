import { v4 as uuidv4 } from 'uuid';
import type { CanonicalMetric, MetricType } from '@rootpilot/shared';

/**
 * OTLP attribute key-value pair.
 */
export interface OTLPAttribute {
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
 * OTLP metric data point (gauge or sum).
 */
export interface OTLPNumberDataPoint {
  timeUnixNano?: string;
  startTimeUnixNano?: string;
  asDouble?: number;
  asInt?: string | number;
  attributes?: OTLPAttribute[];
}

/**
 * OTLP histogram data point.
 */
export interface OTLPHistogramDataPoint {
  timeUnixNano?: string;
  startTimeUnixNano?: string;
  count?: string | number;
  sum?: number;
  min?: number;
  max?: number;
  bucketCounts?: (string | number)[];
  explicitBounds?: number[];
  attributes?: OTLPAttribute[];
}

/**
 * OTLP metric with one of gauge, sum, or histogram data containers.
 */
export interface OTLPMetric {
  name: string;
  unit?: string;
  description?: string;
  gauge?: {
    dataPoints: OTLPNumberDataPoint[];
  };
  sum?: {
    dataPoints: OTLPNumberDataPoint[];
    isMonotonic?: boolean;
    aggregationTemporality?: number;
  };
  histogram?: {
    dataPoints: OTLPHistogramDataPoint[];
    aggregationTemporality?: number;
  };
}

/**
 * OTLP scope metrics container.
 */
export interface OTLPScopeMetrics {
  scope?: {
    name?: string;
    version?: string;
  };
  metrics: OTLPMetric[];
}

/**
 * OTLP resource metrics container (top-level).
 */
export interface OTLPResourceMetrics {
  resource?: {
    attributes?: OTLPAttribute[];
  };
  scopeMetrics: OTLPScopeMetrics[];
}

const VALID_METRIC_TYPES: MetricType[] = ['gauge', 'sum', 'histogram'];

/**
 * Flatten OTLP attributes array to a Record<string, string>.
 */
function flattenAttributes(attrs?: OTLPAttribute[]): Record<string, string> {
  if (!attrs || !Array.isArray(attrs)) return {};

  const result: Record<string, string> = {};
  for (const attr of attrs) {
    if (!attr.key || !attr.value) continue;
    const val = attr.value;
    if (val.stringValue !== undefined) {
      result[attr.key] = String(val.stringValue);
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
 * Convert nanosecond timestamp string to ISO 8601 string.
 */
function nanoToISO(timeUnixNano?: string): string {
  if (!timeUnixNano) {
    return new Date().toISOString();
  }
  const nanos = BigInt(timeUnixNano);
  const millis = Number(nanos / BigInt(1_000_000));
  return new Date(millis).toISOString();
}

/**
 * Extract a numeric value from a number data point.
 * Returns the value or undefined if not numeric.
 */
function extractNumberValue(dataPoint: OTLPNumberDataPoint): number | undefined {
  if (dataPoint.asDouble !== undefined) {
    const val = Number(dataPoint.asDouble);
    return isFinite(val) ? val : undefined;
  }
  if (dataPoint.asInt !== undefined) {
    const val = Number(dataPoint.asInt);
    return isFinite(val) ? val : undefined;
  }
  return undefined;
}

/**
 * Extract a numeric value from a histogram data point.
 * Uses sum/count to compute average, or sum if count is 0 or absent.
 */
function extractHistogramValue(dataPoint: OTLPHistogramDataPoint): number | undefined {
  if (dataPoint.sum !== undefined) {
    const sum = Number(dataPoint.sum);
    if (!isFinite(sum)) return undefined;

    const count = dataPoint.count !== undefined ? Number(dataPoint.count) : 0;
    if (count > 0) {
      return sum / count;
    }
    return sum;
  }
  return undefined;
}

/**
 * Determine the metric type from the OTLP metric structure.
 * Returns the type if valid, or undefined if not recognized.
 */
function detectMetricType(metric: OTLPMetric): MetricType | undefined {
  if (metric.gauge) return 'gauge';
  if (metric.sum) return 'sum';
  if (metric.histogram) return 'histogram';
  return undefined;
}

/**
 * Normalize OTLP resourceMetrics into flat CanonicalMetric records.
 *
 * - Parses the OTLP resourceMetrics → scopeMetrics → metrics structure
 * - Validates metric_type is one of: gauge, sum, histogram (skips invalid)
 * - Validates value is numeric (skips non-numeric data points)
 * - Extracts labels from metric data point attributes
 * - Extracts service_name and environment from resource attributes
 */
export function normalizeMetrics(
  resourceMetrics: OTLPResourceMetrics[],
  tenantId: string,
  projectId: string,
): CanonicalMetric[] {
  const results: CanonicalMetric[] = [];
  const receivedAt = new Date().toISOString();

  for (const resourceMetric of resourceMetrics) {
    const resourceAttrs = flattenAttributes(resourceMetric.resource?.attributes);
    const serviceName = resourceAttrs['service.name'] || 'unknown';
    const environment = resourceAttrs['deployment.environment'] || '';

    for (const scopeMetric of resourceMetric.scopeMetrics) {
      for (const metric of scopeMetric.metrics) {
        const metricType = detectMetricType(metric);

        // Skip metrics with unrecognized type
        if (!metricType || !VALID_METRIC_TYPES.includes(metricType)) {
          continue;
        }

        const metricName = metric.name || '';
        const unit = metric.unit || '';

        if (metricType === 'histogram' && metric.histogram) {
          for (const dataPoint of metric.histogram.dataPoints) {
            const value = extractHistogramValue(dataPoint);
            // Skip data points with non-numeric values
            if (value === undefined) continue;

            const labels = flattenAttributes(dataPoint.attributes);
            const timestamp = nanoToISO(dataPoint.timeUnixNano);

            results.push({
              id: uuidv4(),
              tenant_id: tenantId,
              project_id: projectId,
              timestamp,
              received_at: receivedAt,
              service_name: serviceName,
              environment,
              source: '',
              resource_attributes: resourceAttrs,
              attributes: {},
              metric_name: metricName,
              metric_type: metricType,
              value,
              unit,
              labels,
            });
          }
        } else {
          // gauge or sum
          const dataPoints =
            metricType === 'gauge' ? metric.gauge?.dataPoints : metric.sum?.dataPoints;

          if (!dataPoints) continue;

          for (const dataPoint of dataPoints) {
            const value = extractNumberValue(dataPoint);
            // Skip data points with non-numeric values
            if (value === undefined) continue;

            const labels = flattenAttributes(dataPoint.attributes);
            const timestamp = nanoToISO(dataPoint.timeUnixNano);

            results.push({
              id: uuidv4(),
              tenant_id: tenantId,
              project_id: projectId,
              timestamp,
              received_at: receivedAt,
              service_name: serviceName,
              environment,
              source: '',
              resource_attributes: resourceAttrs,
              attributes: {},
              metric_name: metricName,
              metric_type: metricType,
              value,
              unit,
              labels,
            });
          }
        }
      }
    }
  }

  return results;
}
