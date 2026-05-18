import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authMiddleware } from '../../middleware/auth.js';
import type { OTLPResourceMetrics } from '../../normalizers/metrics.js';
import { normalizeMetrics } from '../../normalizers/metrics.js';
import { getClickHouseClient } from '../../db/clickhouse.js';

/**
 * Expected request body for POST /v1/ingest/metrics.
 */
interface MetricsIngestBody {
  resourceMetrics: OTLPResourceMetrics[];
}

/**
 * Validates the OTLP metrics payload structure.
 * Returns an error message string if invalid, or null if valid.
 */
function validateMetricsPayload(body: unknown): string | null {
  if (!body || typeof body !== 'object') {
    return 'Invalid payload: request body must be a JSON object';
  }

  const payload = body as Record<string, unknown>;

  if (!Array.isArray(payload.resourceMetrics)) {
    return 'Invalid payload: missing or invalid resourceMetrics array';
  }

  if (payload.resourceMetrics.length === 0) {
    return 'Invalid payload: resourceMetrics array must not be empty';
  }

  for (let i = 0; i < payload.resourceMetrics.length; i++) {
    const resourceMetric = payload.resourceMetrics[i] as Record<string, unknown>;

    if (!resourceMetric || typeof resourceMetric !== 'object') {
      return `Invalid payload: resourceMetrics[${i}] must be an object`;
    }

    if (!Array.isArray(resourceMetric.scopeMetrics)) {
      return `Invalid payload: resourceMetrics[${i}].scopeMetrics must be an array`;
    }

    for (let j = 0; j < (resourceMetric.scopeMetrics as unknown[]).length; j++) {
      const scopeMetric = (resourceMetric.scopeMetrics as Record<string, unknown>[])[j];

      if (!scopeMetric || typeof scopeMetric !== 'object') {
        return `Invalid payload: resourceMetrics[${i}].scopeMetrics[${j}] must be an object`;
      }

      if (!Array.isArray(scopeMetric.metrics)) {
        return `Invalid payload: resourceMetrics[${i}].scopeMetrics[${j}].metrics must be an array`;
      }

      for (let k = 0; k < (scopeMetric.metrics as unknown[]).length; k++) {
        const metric = (scopeMetric.metrics as Record<string, unknown>[])[k];

        if (!metric || typeof metric !== 'object') {
          return `Invalid payload: metric at [${i}][${j}][${k}] must be an object`;
        }

        // Each metric must have a name
        if (!metric.name || typeof metric.name !== 'string' || metric.name.trim() === '') {
          return `Invalid payload: metric at [${i}][${j}][${k}] must have a non-empty name field`;
        }

        // Each metric must have one of: gauge, sum, or histogram
        const hasGauge = metric.gauge && typeof metric.gauge === 'object';
        const hasSum = metric.sum && typeof metric.sum === 'object';
        const hasHistogram = metric.histogram && typeof metric.histogram === 'object';

        if (!hasGauge && !hasSum && !hasHistogram) {
          return `Invalid payload: metric "${metric.name}" must have one of gauge, sum, or histogram data container`;
        }

        // Validate data points have numeric values
        const validationError = validateDataPoints(metric, i, j, k);
        if (validationError) return validationError;
      }
    }
  }

  return null;
}

/**
 * Validates that data points within a metric have numeric values.
 */
function validateDataPoints(
  metric: Record<string, unknown>,
  _i: number,
  _j: number,
  _k: number,
): string | null {
  const metricName = metric.name as string;

  if (metric.gauge && typeof metric.gauge === 'object') {
    const gauge = metric.gauge as Record<string, unknown>;
    if (!Array.isArray(gauge.dataPoints) || gauge.dataPoints.length === 0) {
      return `Invalid payload: metric "${metricName}" gauge must have a non-empty dataPoints array`;
    }
    for (const dp of gauge.dataPoints as Record<string, unknown>[]) {
      if (!hasNumericValue(dp)) {
        return `Invalid payload: metric "${metricName}" gauge data point must have a numeric asDouble or asInt value`;
      }
    }
  }

  if (metric.sum && typeof metric.sum === 'object') {
    const sum = metric.sum as Record<string, unknown>;
    if (!Array.isArray(sum.dataPoints) || sum.dataPoints.length === 0) {
      return `Invalid payload: metric "${metricName}" sum must have a non-empty dataPoints array`;
    }
    for (const dp of sum.dataPoints as Record<string, unknown>[]) {
      if (!hasNumericValue(dp)) {
        return `Invalid payload: metric "${metricName}" sum data point must have a numeric asDouble or asInt value`;
      }
    }
  }

  if (metric.histogram && typeof metric.histogram === 'object') {
    const histogram = metric.histogram as Record<string, unknown>;
    if (!Array.isArray(histogram.dataPoints) || histogram.dataPoints.length === 0) {
      return `Invalid payload: metric "${metricName}" histogram must have a non-empty dataPoints array`;
    }
    for (const dp of histogram.dataPoints as Record<string, unknown>[]) {
      if (!hasHistogramNumericValue(dp)) {
        return `Invalid payload: metric "${metricName}" histogram data point must have a numeric sum value`;
      }
    }
  }

  return null;
}

/**
 * Checks if a number data point (gauge/sum) has a valid numeric value.
 */
function hasNumericValue(dataPoint: Record<string, unknown>): boolean {
  if (dataPoint.asDouble !== undefined) {
    const val = Number(dataPoint.asDouble);
    return isFinite(val);
  }
  if (dataPoint.asInt !== undefined) {
    const val = Number(dataPoint.asInt);
    return isFinite(val);
  }
  return false;
}

/**
 * Checks if a histogram data point has a valid numeric sum value.
 */
function hasHistogramNumericValue(dataPoint: Record<string, unknown>): boolean {
  if (dataPoint.sum !== undefined) {
    const val = Number(dataPoint.sum);
    return isFinite(val);
  }
  return false;
}

/**
 * Fastify route plugin for POST /v1/ingest/metrics.
 *
 * - Authenticates via X-API-Key (auth middleware as preHandler)
 * - Validates OTLP metrics payload structure
 * - Normalizes metrics to canonical model
 * - Batch inserts into ClickHouse metrics table
 * - Returns 202 on success, 400 on validation failure, 401 on auth failure
 */
export async function metricsIngestRoute(app: FastifyInstance): Promise<void> {
  app.post(
    '/v1/ingest/metrics',
    {
      preHandler: [authMiddleware],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body;

      // Validate payload structure
      const validationError = validateMetricsPayload(body);
      if (validationError) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_PAYLOAD',
            message: validationError,
          },
        });
      }

      const { resourceMetrics } = body as MetricsIngestBody;
      const { tenantId, projectId } = request.tenantContext;

      // Normalize OTLP metrics to canonical model
      const canonicalMetrics = normalizeMetrics(resourceMetrics, tenantId, projectId);

      // Batch insert into ClickHouse metrics table
      if (canonicalMetrics.length > 0) {
        const clickhouse = getClickHouseClient();
        const rows = canonicalMetrics.map((metric) => ({
          id: metric.id,
          tenant_id: metric.tenant_id,
          project_id: metric.project_id,
          timestamp: metric.timestamp,
          received_at: metric.received_at,
          service_name: metric.service_name,
          environment: metric.environment,
          source: metric.source,
          resource_attributes: JSON.stringify(metric.resource_attributes),
          attributes: JSON.stringify(metric.attributes),
          metric_name: metric.metric_name,
          metric_type: metric.metric_type,
          value: metric.value,
          unit: metric.unit,
          labels: JSON.stringify(metric.labels),
        }));

        await clickhouse.batchInsert('metrics', rows);
      }

      return reply.status(202).send({ accepted: true });
    },
  );
}
