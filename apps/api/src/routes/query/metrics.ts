import type { FastifyInstance, FastifyReply } from 'fastify';
import type {
  MetricAggregation,
  MetricBaselineComparison,
  MetricCatalogEntry,
  MetricCatalogResponse,
  MetricDetailResponse,
  MetricSeries,
  MetricSeriesResponse,
  MetricTopService,
  MetricTopServicesResponse,
} from '@rootpilot/shared';
import { authMiddleware } from '../../middleware/auth.js';
import { getClickHouseClient } from '../../db/clickhouse.js';

const VALID_INTERVALS = ['1m', '5m', '15m', '1h', '1d'] as const;
const VALID_AGGREGATIONS: readonly MetricAggregation[] = [
  'avg',
  'sum',
  'min',
  'max',
  'count',
  'p50',
  'p95',
  'p99',
] as const;
const DEFAULT_AGGREGATION: MetricAggregation = 'avg';
const DEFAULT_INTERVAL: ValidInterval = '1m';
const MAX_RAW_POINTS = 1000;
const MAX_LABEL_FILTERS = 10;
const LABEL_KEY_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;
const RESERVED_GROUP_BY = new Set(['service_name', 'environment']);

type ValidInterval = (typeof VALID_INTERVALS)[number];

interface MetricsQueryParams {
  metric_name?: string;
  service?: string;
  environment?: string;
  from?: string;
  to?: string;
  interval?: string;
  aggregation?: string;
  group_by?: string;
  labels?: string;
}

interface ParsedMetricFilters {
  metricName?: string;
  service?: string;
  environment?: string;
  fromTime: Date;
  toTime: Date;
  aggregation: MetricAggregation;
  interval?: ValidInterval | null;
  groupBy?: string | null;
  labels: Record<string, string>;
}

interface CatalogRow {
  metric_name: string;
  metric_type: string;
  unit: string;
  services: string[] | string;
  last_seen: string;
  sample_count: string | number;
  label_keys: string[] | string;
}

interface DetailRow extends CatalogRow {
  latest_value: string | number | null;
  example_labels: string | Record<string, string> | null;
}

interface SeriesRow {
  point_timestamp?: string;
  timestamp?: string;
  series_name: string;
  value: string | number;
}

interface TopServiceRow {
  service_name: string;
  latest_value: string | number;
  average: string | number;
  p95: string | number;
  max: string | number;
  last_seen: string;
}

interface ComparisonRow {
  current_avg: string | number | null;
  previous_avg: string | number | null;
  current_max: string | number | null;
  previous_max: string | number | null;
  current_p95: string | number | null;
  previous_p95: string | number | null;
  current_count: string | number | null;
  previous_count: string | number | null;
}

const METRIC_DESCRIPTIONS: Record<string, string> = {
  'http.server.request.duration': 'Server-side request latency captured from HTTP spans.',
  'http.server.request.count': 'Count of inbound HTTP requests.',
  'http.server.error.count': 'Count of inbound HTTP requests that completed with errors.',
  'service.cpu.usage': 'Current CPU utilization reported by a service.',
  'service.memory.usage': 'Current memory usage reported by a service.',
  'db.query.duration': 'Database query latency observed by instrumented services.',
  'cache.hit.count': 'Count of successful cache lookups.',
  'cache.miss.count': 'Count of failed cache lookups.',
  'queue.consumer.lag': 'Queue consumer lag reported by broker or consumer instrumentation.',
  'checkout.error_rate': 'Checkout error ratio reported by checkout instrumentation.',
};

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

function toClickHouseTime(value: Date): string {
  return value.toISOString().replace('T', ' ').replace('Z', '');
}

function parseUtcDateTimeParam(name: string): string {
  return `{${name}:DateTime64(3)}`;
}

function formatTimestamp(ts: string | null | undefined): string {
  if (!ts) return '';
  if (ts.includes('T')) return ts.endsWith('Z') ? ts : `${ts}Z`;
  return `${ts.replace(' ', 'T')}Z`;
}

function isValidISO8601(value: string): boolean {
  return !Number.isNaN(new Date(value).getTime());
}

function toNumber(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toStringArray(value: string[] | string | null | undefined): string[] {
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  if (typeof value !== 'string' || value.trim() === '') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(Boolean).map(String) : [];
  } catch {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
}

function parseLabelsJson(
  value: string | Record<string, string> | null | undefined,
): Record<string, string> {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed)
        .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
        .map(([key, labelValue]) => [key, labelValue]),
    );
  } catch {
    return {};
  }
}

function validateMetricName(
  metricName: string | undefined,
  required: boolean,
): string | Error | undefined {
  if (metricName === undefined || metricName.trim() === '') {
    return required ? new Error('Invalid parameter: metric_name is required') : undefined;
  }
  const trimmed = metricName.trim();
  if (trimmed.length > 255 || trimmed.includes('/')) {
    return new Error('Invalid parameter: metric_name must be a non-empty metric name');
  }
  return trimmed;
}

function parseTimeRange(params: MetricsQueryParams): { fromTime: Date; toTime: Date } | Error {
  const now = new Date();
  if (params.from !== undefined && params.from !== '' && !isValidISO8601(params.from)) {
    return new Error(
      `Invalid "from" parameter: "${params.from}" is not a valid ISO 8601 timestamp`,
    );
  }
  if (params.to !== undefined && params.to !== '' && !isValidISO8601(params.to)) {
    return new Error(`Invalid "to" parameter: "${params.to}" is not a valid ISO 8601 timestamp`);
  }

  const toTime = params.to && params.to !== '' ? new Date(params.to) : now;
  const defaultFrom = new Date(toTime.getTime() - 60 * 60 * 1000);
  const fromTime = params.from && params.from !== '' ? new Date(params.from) : defaultFrom;

  if (fromTime.getTime() > toTime.getTime()) {
    return new Error('Invalid parameter: from must be before to');
  }

  return { fromTime, toTime };
}

function parseAggregation(value: string | undefined): MetricAggregation | Error {
  if (value === undefined || value === '') return DEFAULT_AGGREGATION;
  if (!VALID_AGGREGATIONS.includes(value as MetricAggregation)) {
    return new Error(
      `Invalid aggregation value: "${value}". Supported values are: ${VALID_AGGREGATIONS.join(', ')}`,
    );
  }
  return value as MetricAggregation;
}

function parseInterval(
  value: string | undefined,
  requiredDefault: boolean,
): ValidInterval | null | Error {
  if (value === undefined || value === '') return requiredDefault ? DEFAULT_INTERVAL : null;
  if (!VALID_INTERVALS.includes(value as ValidInterval)) {
    return new Error(
      `Invalid interval value: "${value}". Supported values are: ${VALID_INTERVALS.join(', ')}`,
    );
  }
  return value as ValidInterval;
}

function parseGroupBy(value: string | undefined): string | null | Error {
  if (value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed === '') return new Error('Invalid parameter: group_by must not be empty');
  if (RESERVED_GROUP_BY.has(trimmed)) return trimmed;
  if (!LABEL_KEY_PATTERN.test(trimmed)) {
    return new Error('Invalid parameter: group_by must be a metric label key or supported column');
  }
  return trimmed;
}

function parseLabelFilters(value: string | undefined): Record<string, string> | Error {
  if (value === undefined || value.trim() === '') return {};
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return new Error('Invalid parameter: labels must be a JSON object');
    }
    const entries = Object.entries(parsed);
    if (entries.length > MAX_LABEL_FILTERS) {
      return new Error(
        `Invalid parameter: labels must contain at most ${MAX_LABEL_FILTERS} filters`,
      );
    }
    const labels: Record<string, string> = {};
    for (const [key, labelValue] of entries) {
      if (!LABEL_KEY_PATTERN.test(key) || typeof labelValue !== 'string') {
        return new Error('Invalid parameter: labels must map safe label keys to string values');
      }
      labels[key] = labelValue;
    }
    return labels;
  } catch (error) {
    if (error instanceof Error && error.message.includes('labels')) return error;
    return new Error('Invalid parameter: labels must be valid JSON');
  }
}

function parseMetricFilters(
  params: MetricsQueryParams,
  options: { requireMetricName?: boolean; defaultInterval?: boolean } = {},
): ParsedMetricFilters | Error {
  const metricName = validateMetricName(params.metric_name, options.requireMetricName === true);
  if (metricName instanceof Error) return metricName;

  const timeRange = parseTimeRange(params);
  if (timeRange instanceof Error) return timeRange;

  const aggregation = parseAggregation(params.aggregation);
  if (aggregation instanceof Error) return aggregation;

  const interval = parseInterval(params.interval, options.defaultInterval === true);
  if (interval instanceof Error) return interval;

  const groupBy = parseGroupBy(params.group_by);
  if (groupBy instanceof Error) return groupBy;

  const labels = parseLabelFilters(params.labels);
  if (labels instanceof Error) return labels;

  return {
    metricName,
    service: params.service,
    environment: params.environment,
    fromTime: timeRange.fromTime,
    toTime: timeRange.toTime,
    aggregation,
    interval,
    groupBy,
    labels,
  };
}

function aggregationExpression(aggregation: MetricAggregation): string {
  switch (aggregation) {
    case 'avg':
      return 'avg(value)';
    case 'sum':
      return 'sum(value)';
    case 'min':
      return 'min(value)';
    case 'max':
      return 'max(value)';
    case 'count':
      return 'count(value)';
    case 'p50':
      return 'quantile(0.50)(value)';
    case 'p95':
      return 'quantile(0.95)(value)';
    case 'p99':
      return 'quantile(0.99)(value)';
  }
}

function groupByExpression(
  groupBy: string | null | undefined,
  queryParams: Record<string, unknown>,
): string {
  if (!groupBy) return `'All'`;
  if (groupBy === 'service_name' || groupBy === 'environment') return groupBy;
  if (groupBy === 'version') {
    return `coalesce(nullIf(JSONExtractString(labels, 'version'), ''), nullIf(JSONExtractString(resource_attributes, 'service.version'), ''), 'unknown')`;
  }
  queryParams.groupByLabel = groupBy;
  return `coalesce(nullIf(JSONExtractString(labels, {groupByLabel:String}), ''), 'unknown')`;
}

function buildWhereClause(
  tenantId: string,
  filters: ParsedMetricFilters,
  options: { includeTime?: boolean; fromTimeOverride?: Date } = {},
): { whereClause: string; queryParams: Record<string, unknown> } {
  const conditions = ['tenant_id = {tenantId:String}'];
  const queryParams: Record<string, unknown> = { tenantId };

  if (options.includeTime !== false) {
    conditions.push(`timestamp >= ${parseUtcDateTimeParam('fromTime')}`);
    conditions.push(`timestamp <= ${parseUtcDateTimeParam('toTime')}`);
    queryParams.fromTime = toClickHouseTime(options.fromTimeOverride ?? filters.fromTime);
    queryParams.toTime = toClickHouseTime(filters.toTime);
  }

  if (filters.metricName) {
    conditions.push('metric_name = {metricName:String}');
    queryParams.metricName = filters.metricName;
  }
  if (filters.service) {
    conditions.push('service_name = {serviceName:String}');
    queryParams.serviceName = filters.service;
  }
  if (filters.environment) {
    conditions.push('environment = {environment:String}');
    queryParams.environment = filters.environment;
  }

  Object.entries(filters.labels).forEach(([key, value], index) => {
    conditions.push(
      `JSONExtractString(labels, {labelKey${index}:String}) = {labelValue${index}:String}`,
    );
    queryParams[`labelKey${index}`] = key;
    queryParams[`labelValue${index}`] = value;
  });

  return {
    whereClause: conditions.join(' AND '),
    queryParams,
  };
}

function sendInvalid(reply: FastifyReply, error: Error) {
  return reply.status(400).send({
    error: {
      code: 'INVALID_PARAMETER',
      message: error.message,
    },
  });
}

function mapCatalogRow(row: CatalogRow): MetricCatalogEntry {
  return {
    metric_name: row.metric_name,
    metric_type: row.metric_type,
    unit: row.unit,
    services: toStringArray(row.services),
    last_seen: formatTimestamp(row.last_seen),
    sample_count: toNumber(row.sample_count),
    label_keys: toStringArray(row.label_keys),
  };
}

function metricDescription(metricName: string): string {
  return METRIC_DESCRIPTIONS[metricName] ?? 'Custom metric reported through RootPilot ingestion.';
}

function buildSeriesResponse(
  rows: SeriesRow[],
  filters: ParsedMetricFilters,
  unit: string,
  comparison?: MetricBaselineComparison,
): MetricSeriesResponse {
  const seriesByName = new Map<string, MetricSeries>();
  for (const row of rows) {
    const name = row.series_name || 'unknown';
    const existing =
      seriesByName.get(name) ??
      ({
        name,
        labels: filters.groupBy ? { [filters.groupBy]: name } : {},
        points: [],
      } satisfies MetricSeries);
    existing.points.push({
      timestamp: formatTimestamp(row.point_timestamp ?? row.timestamp ?? ''),
      value: toNumber(row.value),
    });
    seriesByName.set(name, existing);
  }

  return {
    metric_name: filters.metricName!,
    unit,
    aggregation: filters.aggregation,
    interval: filters.interval ?? DEFAULT_INTERVAL,
    group_by: filters.groupBy ?? null,
    series: [...seriesByName.values()],
    comparison,
  };
}

function comparisonValue(current: number, previous: number) {
  const delta = current - previous;
  const deltaPercent =
    previous === 0
      ? current === 0
        ? 0
        : null
      : Number(((delta / Math.abs(previous)) * 100).toFixed(2));
  return {
    current,
    previous,
    delta,
    delta_percent: deltaPercent,
  };
}

function primaryComparisonMetric(metricName: string): 'avg' | 'max' | 'p95' | 'count' {
  if (metricName.includes('duration') || metricName.includes('latency')) return 'p95';
  if (metricName.includes('count') || metricName.includes('error')) return 'count';
  return 'avg';
}

function changeStatus(
  current: number,
  previous: number,
): 'Large increase' | 'Large decrease' | 'Stable' {
  if (previous === 0 && current > 0) return 'Large increase';
  if (previous === 0) return 'Stable';
  const deltaPercent = ((current - previous) / Math.abs(previous)) * 100;
  if (deltaPercent >= 40) return 'Large increase';
  if (deltaPercent <= -40) return 'Large decrease';
  return 'Stable';
}

function comparisonSummary(
  metricName: string,
  comparison: MetricBaselineComparison,
  primary: 'avg' | 'max' | 'p95' | 'count',
): string {
  const value = comparison[primary];
  const direction = value.delta >= 0 ? 'increased' : 'decreased';
  const percent =
    value.delta_percent === null ? 'from zero' : `${Math.abs(value.delta_percent).toFixed(0)}%`;
  const durationMs = new Date(comparison.to).getTime() - new Date(comparison.from).getTime();
  const minutes = Math.max(1, Math.round(durationMs / 60000));
  const metricLabel =
    primary === 'p95' ? 'p95 latency' : primary === 'count' ? 'sample count' : `${primary} value`;
  return `${metricLabel} ${direction} ${percent} compared with the previous ${minutes} minutes for ${metricName}.`;
}

async function fetchMetricUnit(metricName: string, tenantId: string): Promise<string> {
  const clickhouse = getClickHouseClient();
  const rows = await clickhouse.query<{ unit: string }>(
    `
      SELECT argMax(unit, timestamp) AS unit
      FROM metrics
      WHERE tenant_id = {tenantId:String} AND metric_name = {metricName:String}
    `,
    { tenantId, metricName },
  );
  return rows[0]?.unit ?? '';
}

async function fetchComparison(
  tenantId: string,
  filters: ParsedMetricFilters,
): Promise<MetricBaselineComparison> {
  const windowMs = filters.toTime.getTime() - filters.fromTime.getTime();
  const previousFrom = new Date(filters.fromTime.getTime() - windowMs);
  const previousTo = filters.fromTime;
  const { whereClause, queryParams } = buildWhereClause(tenantId, filters, {
    fromTimeOverride: previousFrom,
  });

  const rows = await getClickHouseClient().query<ComparisonRow>(
    `
      SELECT
        avgIf(value, timestamp >= ${parseUtcDateTimeParam('fromTime')}) AS current_avg,
        avgIf(value, timestamp < ${parseUtcDateTimeParam('fromTime')}) AS previous_avg,
        maxIf(value, timestamp >= ${parseUtcDateTimeParam('fromTime')}) AS current_max,
        maxIf(value, timestamp < ${parseUtcDateTimeParam('fromTime')}) AS previous_max,
        quantileIf(0.95)(value, timestamp >= ${parseUtcDateTimeParam('fromTime')}) AS current_p95,
        quantileIf(0.95)(value, timestamp < ${parseUtcDateTimeParam('fromTime')}) AS previous_p95,
        countIf(timestamp >= ${parseUtcDateTimeParam('fromTime')}) AS current_count,
        countIf(timestamp < ${parseUtcDateTimeParam('fromTime')}) AS previous_count
      FROM metrics
      WHERE ${whereClause}
    `,
    queryParams,
  );

  const row = rows[0] ?? {
    current_avg: 0,
    previous_avg: 0,
    current_max: 0,
    previous_max: 0,
    current_p95: 0,
    previous_p95: 0,
    current_count: 0,
    previous_count: 0,
  };
  const primary = primaryComparisonMetric(filters.metricName!);
  const comparison: MetricBaselineComparison = {
    from: filters.fromTime.toISOString(),
    to: filters.toTime.toISOString(),
    previous_from: previousFrom.toISOString(),
    previous_to: previousTo.toISOString(),
    avg: comparisonValue(toNumber(row.current_avg), toNumber(row.previous_avg)),
    max: comparisonValue(toNumber(row.current_max), toNumber(row.previous_max)),
    p95: comparisonValue(toNumber(row.current_p95), toNumber(row.previous_p95)),
    count: comparisonValue(toNumber(row.current_count), toNumber(row.previous_count)),
    status: 'Stable',
    summary: '',
  };
  comparison.status = changeStatus(comparison[primary].current, comparison[primary].previous);
  comparison.summary = comparisonSummary(filters.metricName!, comparison, primary);
  return comparison;
}

async function fetchSeries(
  tenantId: string,
  filters: ParsedMetricFilters,
): Promise<MetricSeriesResponse> {
  const unit = await fetchMetricUnit(filters.metricName!, tenantId);
  const { whereClause, queryParams } = buildWhereClause(tenantId, filters);
  const groupExpression = groupByExpression(filters.groupBy, queryParams);
  const interval = filters.interval ?? DEFAULT_INTERVAL;
  const rows = await getClickHouseClient().query<SeriesRow>(
    `
      SELECT
        formatDateTime(toStartOfInterval(timestamp, ${intervalToClickHouse(interval)}), '%Y-%m-%dT%H:%i:%S.%f', 'UTC') AS point_timestamp,
        ${groupExpression} AS series_name,
        ${aggregationExpression(filters.aggregation)} AS value
      FROM metrics
      WHERE ${whereClause}
      GROUP BY point_timestamp, series_name
      ORDER BY point_timestamp ASC, series_name ASC
    `,
    queryParams,
  );
  const comparison = await fetchComparison(tenantId, filters);
  return buildSeriesResponse(rows, { ...filters, interval }, unit, comparison);
}

export async function metricsQueryRoute(app: FastifyInstance): Promise<void> {
  app.get('/v1/metrics/names', { preHandler: [authMiddleware] }, async (request, reply) => {
    const rows = await getClickHouseClient().query<{ metric_name: string }>(
      `
        SELECT DISTINCT metric_name
        FROM metrics
        WHERE tenant_id = {tenantId:String}
        ORDER BY metric_name ASC
        LIMIT 1000
      `,
      { tenantId: request.tenantContext.tenantId },
    );
    return reply.status(200).send({ data: rows.map((row) => row.metric_name) });
  });

  app.get('/v1/metrics/catalog', { preHandler: [authMiddleware] }, async (request, reply) => {
    const rows = await getClickHouseClient().query<CatalogRow>(
      `
        SELECT
          metric_name,
          argMax(metric_type, timestamp) AS metric_type,
          argMax(unit, timestamp) AS unit,
          groupUniqArray(20)(service_name) AS services,
          formatDateTime(max(timestamp), '%Y-%m-%dT%H:%i:%S.%f', 'UTC') AS last_seen,
          count() AS sample_count,
          arraySlice(arrayDistinct(arrayFlatten(groupArray(JSONExtractKeys(labels)))), 1, 50) AS label_keys
        FROM metrics
        WHERE tenant_id = {tenantId:String}
        GROUP BY metric_name
        ORDER BY max(timestamp) DESC, metric_name ASC
        LIMIT 500
      `,
      { tenantId: request.tenantContext.tenantId },
    );
    const response: MetricCatalogResponse = { data: rows.map(mapCatalogRow) };
    return reply.status(200).send(response);
  });

  app.get<{ Querystring: MetricsQueryParams }>(
    '/v1/metrics/query',
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const filters = parseMetricFilters(request.query, {
        requireMetricName: true,
        defaultInterval: true,
      });
      if (filters instanceof Error) return sendInvalid(reply, filters);
      const response = await fetchSeries(request.tenantContext.tenantId, filters);
      return reply.status(200).send(response);
    },
  );

  app.get<{ Querystring: MetricsQueryParams }>(
    '/v1/metrics',
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const filters = parseMetricFilters(request.query);
      if (filters instanceof Error) return sendInvalid(reply, filters);

      const { whereClause, queryParams } = buildWhereClause(
        request.tenantContext.tenantId,
        filters,
      );
      const rows = await getClickHouseClient().query<{
        point_timestamp?: string;
        timestamp?: string;
        value: number;
      }>(
        filters.interval
          ? `
              SELECT
                formatDateTime(toStartOfInterval(timestamp, ${intervalToClickHouse(filters.interval)}), '%Y-%m-%dT%H:%i:%S.%f', 'UTC') AS point_timestamp,
                ${aggregationExpression(filters.aggregation)} AS value
              FROM metrics
              WHERE ${whereClause}
              GROUP BY point_timestamp
              ORDER BY point_timestamp ASC
            `
          : `
              SELECT
                formatDateTime(timestamp, '%Y-%m-%dT%H:%i:%S.%f', 'UTC') AS point_timestamp,
                value
              FROM metrics
              WHERE ${whereClause}
              ORDER BY timestamp ASC
              LIMIT ${MAX_RAW_POINTS}
            `,
        queryParams,
      );

      return reply.status(200).send({
        metric_name: filters.metricName ?? null,
        aggregation: filters.aggregation,
        interval: filters.interval ?? null,
        data: rows.map((row) => ({
          timestamp: formatTimestamp(row.point_timestamp ?? row.timestamp ?? ''),
          value: toNumber(row.value),
        })),
      });
    },
  );

  app.get<{ Params: { metricName: string } }>(
    '/v1/metrics/:metricName',
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const metricName = validateMetricName(request.params.metricName, true);
      if (metricName instanceof Error || metricName === undefined) {
        return sendInvalid(
          reply,
          metricName ?? new Error('Invalid parameter: metric_name is required'),
        );
      }

      const rows = await getClickHouseClient().query<DetailRow>(
        `
          SELECT
            metric_name,
            argMax(metric_type, timestamp) AS metric_type,
            argMax(unit, timestamp) AS unit,
            groupUniqArray(20)(service_name) AS services,
            formatDateTime(max(timestamp), '%Y-%m-%dT%H:%i:%S.%f', 'UTC') AS last_seen,
            count() AS sample_count,
            arraySlice(arrayDistinct(arrayFlatten(groupArray(JSONExtractKeys(labels)))), 1, 50) AS label_keys,
            argMax(value, timestamp) AS latest_value,
            argMax(labels, timestamp) AS example_labels
          FROM metrics
          WHERE tenant_id = {tenantId:String} AND metric_name = {metricName:String}
          GROUP BY metric_name
          LIMIT 1
        `,
        { tenantId: request.tenantContext.tenantId, metricName },
      );

      if (!rows[0]) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: `Metric "${metricName}" was not found` },
        });
      }

      const row = rows[0];
      const response: MetricDetailResponse = {
        metric_name: row.metric_name,
        description: metricDescription(row.metric_name),
        metric_type: row.metric_type,
        unit: row.unit,
        services: toStringArray(row.services),
        label_keys: toStringArray(row.label_keys),
        latest_value: row.latest_value === null ? null : toNumber(row.latest_value),
        last_seen: formatTimestamp(row.last_seen),
        sample_count: toNumber(row.sample_count),
        example_labels: parseLabelsJson(row.example_labels),
      };
      return reply.status(200).send(response);
    },
  );

  app.get<{ Params: { metricName: string }; Querystring: Omit<MetricsQueryParams, 'metric_name'> }>(
    '/v1/metrics/:metricName/series',
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const filters = parseMetricFilters(
        {
          ...request.query,
          metric_name: request.params.metricName,
        },
        { requireMetricName: true, defaultInterval: true },
      );
      if (filters instanceof Error) return sendInvalid(reply, filters);
      const response = await fetchSeries(request.tenantContext.tenantId, filters);
      return reply.status(200).send(response);
    },
  );

  app.get<{ Params: { metricName: string }; Querystring: Omit<MetricsQueryParams, 'metric_name'> }>(
    '/v1/metrics/:metricName/top-services',
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const filters = parseMetricFilters(
        {
          ...request.query,
          metric_name: request.params.metricName,
        },
        { requireMetricName: true },
      );
      if (filters instanceof Error) return sendInvalid(reply, filters);

      const { whereClause, queryParams } = buildWhereClause(
        request.tenantContext.tenantId,
        filters,
      );
      const orderBy =
        primaryComparisonMetric(filters.metricName!) === 'p95'
          ? 'p95 DESC'
          : primaryComparisonMetric(filters.metricName!) === 'count'
            ? 'total DESC'
            : 'latest_value DESC';

      const rows = await getClickHouseClient().query<TopServiceRow>(
        `
          SELECT
            service_name,
            argMax(value, timestamp) AS latest_value,
            avg(value) AS average,
            quantile(0.95)(value) AS p95,
            max(value) AS max,
            sum(value) AS total,
            formatDateTime(max(timestamp), '%Y-%m-%dT%H:%i:%S.%f', 'UTC') AS last_seen
          FROM metrics
          WHERE ${whereClause}
          GROUP BY service_name
          ORDER BY ${orderBy}
          LIMIT 20
        `,
        queryParams,
      );

      const response: MetricTopServicesResponse = {
        metric_name: filters.metricName!,
        unit: await fetchMetricUnit(filters.metricName!, request.tenantContext.tenantId),
        aggregation: filters.aggregation,
        data: rows.map(
          (row): MetricTopService => ({
            service_name: row.service_name,
            latest_value: toNumber(row.latest_value),
            average: toNumber(row.average),
            p95: toNumber(row.p95),
            max: toNumber(row.max),
            last_seen: formatTimestamp(row.last_seen),
          }),
        ),
      };
      return reply.status(200).send(response);
    },
  );
}
