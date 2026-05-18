import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authMiddleware } from '../../middleware/auth.js';
import { getClickHouseClient } from '../../db/clickhouse.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const VALID_INTERVALS = ['1m', '5m', '15m', '1h', '1d'] as const;
const VALID_AGGREGATIONS = ['avg', 'sum', 'min', 'max', 'count'] as const;
const MAX_RAW_POINTS = 1000;
const DEFAULT_AGGREGATION = 'avg';

type ValidInterval = (typeof VALID_INTERVALS)[number];
type ValidAggregation = (typeof VALID_AGGREGATIONS)[number];

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Maps interval string to ClickHouse toStartOfInterval argument.
 */
function intervalToClickHouse(interval: ValidInterval): string {
  switch (interval) {
    case '1m':
      return 'INTERVAL 1 MINUTE';
    case '5m':
      return 'INTERVAL 5 MINUTE';
    case '15m':
      return 'INTERVAL 15 MINUTE';
    case '1h':
      return 'INTERVAL 1 HOUR';
    case '1d':
      return 'INTERVAL 1 DAY';
  }
}

/**
 * Validates an ISO 8601 timestamp string.
 */
function isValidISO8601(value: string): boolean {
  const date = new Date(value);
  return !isNaN(date.getTime());
}

// ─── Query Parameters Interface ──────────────────────────────────────────────

interface MetricsQueryParams {
  metric_name?: string;
  service?: string;
  environment?: string;
  from?: string;
  to?: string;
  interval?: string;
  aggregation?: string;
}

// ─── Route Plugin ────────────────────────────────────────────────────────────

/**
 * Fastify route plugin for GET /v1/metrics and GET /v1/metrics/names.
 *
 * GET /v1/metrics: Returns metric time-series data with optional aggregation.
 * - Supports filters: metric_name, service, environment, time range
 * - Default time range: last 1 hour
 * - With interval: aggregates using ClickHouse toStartOfInterval()
 * - Without interval: returns raw data points up to 1000
 * - Validates interval and aggregation parameters
 * - Always scopes queries to the authenticated tenant
 *
 * GET /v1/metrics/names: Returns distinct metric names for the authenticated tenant.
 */
export async function metricsQueryRoute(app: FastifyInstance): Promise<void> {
  // ─── GET /v1/metrics/names — List distinct metric names ──────────────

  app.get(
    '/v1/metrics/names',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { tenantId } = request.tenantContext;
      const clickhouse = getClickHouseClient();

      const queryText = `
        SELECT DISTINCT metric_name
        FROM metrics
        WHERE tenant_id = {tenantId:String}
        ORDER BY metric_name ASC
        LIMIT 1000
      `;

      const rows = await clickhouse.query<{ metric_name: string }>(queryText, {
        tenantId,
      });

      const names = rows.map((row) => row.metric_name);
      return reply.status(200).send({ data: names });
    }
  );

  // ─── GET /v1/metrics — Metric time-series data ───────────────────────
  app.get(
    '/v1/metrics',
    {
      preHandler: [authMiddleware],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = request.query as MetricsQueryParams;
      const { tenantId } = request.tenantContext;

      // ─── Validate parameters ─────────────────────────────────────────

      // Validate interval if provided
      if (params.interval !== undefined && params.interval !== '') {
        if (!VALID_INTERVALS.includes(params.interval as ValidInterval)) {
          return reply.status(400).send({
            error: {
              code: 'INVALID_PARAMETER',
              message: `Invalid interval value: "${params.interval}". Supported values are: ${VALID_INTERVALS.join(', ')}`,
            },
          });
        }
      }

      // Validate aggregation if provided
      if (params.aggregation !== undefined && params.aggregation !== '') {
        if (!VALID_AGGREGATIONS.includes(params.aggregation as ValidAggregation)) {
          return reply.status(400).send({
            error: {
              code: 'INVALID_PARAMETER',
              message: `Invalid aggregation value: "${params.aggregation}". Supported values are: ${VALID_AGGREGATIONS.join(', ')}`,
            },
          });
        }
      }

      // Validate time range parameters
      if (params.from !== undefined && params.from !== '' && !isValidISO8601(params.from)) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_PARAMETER',
            message: `Invalid "from" parameter: "${params.from}" is not a valid ISO 8601 timestamp`,
          },
        });
      }

      if (params.to !== undefined && params.to !== '' && !isValidISO8601(params.to)) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_PARAMETER',
            message: `Invalid "to" parameter: "${params.to}" is not a valid ISO 8601 timestamp`,
          },
        });
      }

      // ─── Determine time range ────────────────────────────────────────

      const now = new Date();
      const defaultFrom = new Date(now.getTime() - 60 * 60 * 1000); // 1 hour ago

      const fromTime = params.from && params.from !== '' ? new Date(params.from) : defaultFrom;
      const toTime = params.to && params.to !== '' ? new Date(params.to) : now;

      // ─── Determine aggregation and interval ──────────────────────────

      const interval: ValidInterval | null =
        params.interval && params.interval !== ''
          ? (params.interval as ValidInterval)
          : null;

      const aggregation: ValidAggregation =
        params.aggregation && params.aggregation !== ''
          ? (params.aggregation as ValidAggregation)
          : DEFAULT_AGGREGATION;

      // ─── Build ClickHouse query ──────────────────────────────────────

      const clickhouse = getClickHouseClient();
      const conditions: string[] = ['tenant_id = {tenantId:String}'];
      const queryParams: Record<string, unknown> = {
        tenantId,
        fromTime: fromTime.toISOString().replace('T', ' ').replace('Z', ''),
        toTime: toTime.toISOString().replace('T', ' ').replace('Z', ''),
      };

      conditions.push('timestamp >= {fromTime:DateTime64(3)}');
      conditions.push('timestamp <= {toTime:DateTime64(3)}');

      if (params.metric_name && params.metric_name !== '') {
        conditions.push('metric_name = {metricName:String}');
        queryParams.metricName = params.metric_name;
      }

      if (params.service && params.service !== '') {
        conditions.push('service_name = {serviceName:String}');
        queryParams.serviceName = params.service;
      }

      if (params.environment && params.environment !== '') {
        conditions.push('environment = {environment:String}');
        queryParams.environment = params.environment;
      }

      const whereClause = conditions.join(' AND ');

      let queryText: string;

      if (interval) {
        // Aggregated query with interval
        const chInterval = intervalToClickHouse(interval);
        queryText = `
          SELECT
            toStartOfInterval(timestamp, ${chInterval}) AS timestamp,
            ${aggregation}(value) AS value
          FROM metrics
          WHERE ${whereClause}
          GROUP BY timestamp
          ORDER BY timestamp ASC
        `;
      } else {
        // Raw data points, limited to MAX_RAW_POINTS
        queryText = `
          SELECT
            timestamp,
            value
          FROM metrics
          WHERE ${whereClause}
          ORDER BY timestamp ASC
          LIMIT ${MAX_RAW_POINTS}
        `;
      }

      const rows = await clickhouse.query<{ timestamp: string; value: number }>(
        queryText,
        queryParams
      );

      // ─── Format response ─────────────────────────────────────────────

      const data = rows.map((row) => ({
        timestamp: formatTimestamp(row.timestamp),
        value: Number(row.value),
      }));

      return reply.status(200).send({
        metric_name: params.metric_name || null,
        aggregation,
        interval: interval || null,
        data,
      });
    }
  );
}

/**
 * Formats a ClickHouse timestamp string to ISO 8601.
 */
function formatTimestamp(ts: string): string {
  // ClickHouse returns timestamps like "2024-01-01 00:00:00.000"
  // Convert to ISO 8601 format
  if (ts.includes('T')) {
    return ts; // Already ISO format
  }
  return ts.replace(' ', 'T') + 'Z';
}
