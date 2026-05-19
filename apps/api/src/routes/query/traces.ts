import type { FastifyInstance, FastifyReply } from 'fastify';
import type {
  CanonicalLog,
  CanonicalSpan,
  SimilarTrace,
  SimilarTracesResponse,
  TraceDeploymentHint,
  TraceDetailSummary,
  TraceLatencyBucket,
  TraceListResponse,
  TraceLogsResponse,
  TraceSummary,
} from '@rootpilot/shared';
import { authMiddleware } from '../../middleware/auth.js';
import { getClickHouseClient } from '../../db/clickhouse.js';

interface TraceListQuery {
  from?: string;
  to?: string;
  service?: string;
  environment?: string;
  operation?: string;
  status?: string;
  minDuration?: string;
  maxDuration?: string;
  trace_id?: string;
  root_service?: string;
  http_route?: string;
  error_only?: string;
  limit?: string;
  cursor?: string;
}

interface TraceDetailParams {
  traceId: string;
}

interface TraceLogsQuery {
  span_id?: string;
}

interface SimilarTraceQuery {
  from?: string;
  to?: string;
  limit?: string;
}

interface DecodedCursor {
  ts: string;
  id: string;
}

interface ParsedTraceFilters {
  fromTime: string;
  toTime: string;
  service?: string;
  environment?: string;
  operation?: string;
  status?: 'OK' | 'ERROR';
  minDuration?: number;
  maxDuration?: number;
  traceId?: string;
  rootService?: string;
  httpRoute?: string;
  errorOnly: boolean;
  limit: number;
  cursor?: DecodedCursor;
}

interface TraceSummaryRow {
  trace_id: string;
  trace_timestamp: string;
  root_service: string;
  root_operation: string;
  root_environment: string;
  duration_ms: string | number;
  span_count: string | number;
  error_count: string | number;
  services: string[] | string;
  status: string;
}

interface DeploymentHintRow {
  deployment_id?: string;
  timestamp?: string;
  service_name?: string;
  environment?: string;
}

interface LatencyBucketRow {
  bucket?: TraceLatencyBucket['bucket'];
  count?: string | number;
}

interface LogRow {
  id: string;
  tenant_id: string;
  project_id: string;
  timestamp: string;
  received_at: string;
  service_name: string;
  environment: string;
  source: string;
  resource_attributes: string | Record<string, string>;
  attributes: string | Record<string, string>;
  severity: CanonicalLog['severity'];
  message: string;
  trace_id: string;
  span_id: string;
  fingerprint?: string;
}

interface SpanRow {
  id: string;
  tenant_id: string;
  project_id: string;
  timestamp: string;
  received_at: string;
  service_name: string;
  environment: string;
  source: string;
  resource_attributes: string | Record<string, string>;
  attributes: string | Record<string, string>;
  trace_id: string;
  span_id: string;
  parent_span_id: string;
  operation_name: string;
  duration_ms: string | number;
  status_code: CanonicalSpan['status_code'];
  status_message: string;
  kind: CanonicalSpan['kind'];
}

const TRACE_STATUSES = new Set(['OK', 'ERROR']);
const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;
const DEPLOYMENT_WINDOW_MS = 15 * 60 * 1000;
const TRACE_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,256}$/;

const LATENCY_BUCKETS: TraceLatencyBucket['bucket'][] = [
  '<100ms',
  '100-300ms',
  '300-1000ms',
  '1-3s',
  '>3s',
];

function isValidISO8601(value: string): boolean {
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && value.length > 0;
}

function parseUtcDateTime64(paramName: string): string {
  return `parseDateTime64BestEffort({${paramName}:String}, 3, 'UTC')`;
}

function toClickHouseDateTime(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function encodeCursor(ts: string, id: string): string {
  return Buffer.from(JSON.stringify({ ts, id })).toString('base64');
}

function decodeCursor(cursor: string): DecodedCursor | null {
  try {
    const decoded = JSON.parse(Buffer.from(cursor, 'base64').toString('utf-8'));
    if (typeof decoded.ts === 'string' && typeof decoded.id === 'string') {
      return decoded as DecodedCursor;
    }
    return null;
  } catch {
    return null;
  }
}

function parseNumber(value: string | undefined, name: string): number | Error | undefined {
  if (value === undefined || value === '') return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return new Error(`Invalid parameter: ${name} must be a non-negative number`);
  }
  return parsed;
}

function validateTraceId(value: string | undefined, name: string): string | Error | undefined {
  if (value === undefined || value === '') return undefined;
  if (!TRACE_ID_PATTERN.test(value)) {
    return new Error(`Invalid parameter: ${name} must be a valid trace identifier`);
  }
  return value;
}

function parseBoolean(value: string | undefined): boolean {
  if (!value) return false;
  return value === 'true' || value === '1';
}

function parseTraceFilters(params: TraceListQuery): ParsedTraceFilters | Error {
  if (params.from && !isValidISO8601(params.from)) {
    return new Error('Invalid parameter: from must be a valid ISO 8601 timestamp');
  }
  if (params.to && !isValidISO8601(params.to)) {
    return new Error('Invalid parameter: to must be a valid ISO 8601 timestamp');
  }

  const limit = params.limit ? parseInt(params.limit, 10) : DEFAULT_LIMIT;
  if (Number.isNaN(limit) || limit < 1) {
    return new Error('Invalid parameter: limit must be a positive integer');
  }
  if (limit > MAX_LIMIT) {
    return new Error(`Invalid parameter: limit must not exceed ${MAX_LIMIT}`);
  }

  const minDuration = parseNumber(params.minDuration, 'minDuration');
  if (minDuration instanceof Error) return minDuration;
  const maxDuration = parseNumber(params.maxDuration, 'maxDuration');
  if (maxDuration instanceof Error) return maxDuration;
  if (minDuration !== undefined && maxDuration !== undefined && maxDuration < minDuration) {
    return new Error('Invalid parameter: maxDuration must be greater than or equal to minDuration');
  }

  let status: ParsedTraceFilters['status'];
  if (params.status) {
    const normalizedStatus = params.status.toUpperCase();
    if (!TRACE_STATUSES.has(normalizedStatus)) {
      return new Error('Invalid parameter: status must be OK or ERROR');
    }
    status = normalizedStatus as 'OK' | 'ERROR';
  }

  let cursor: DecodedCursor | undefined;
  if (params.cursor) {
    const decoded = decodeCursor(params.cursor);
    if (!decoded) {
      return new Error('Invalid parameter: cursor is malformed');
    }
    cursor = decoded;
  }

  const traceId = validateTraceId(params.trace_id, 'trace_id');
  if (traceId instanceof Error) return traceId;

  const now = new Date();
  const defaultFrom = new Date(now.getTime() - 60 * 60 * 1000);
  return {
    fromTime: toClickHouseDateTime(params.from ?? defaultFrom),
    toTime: toClickHouseDateTime(params.to ?? now),
    service: params.service || undefined,
    environment: params.environment || undefined,
    operation: params.operation || undefined,
    status,
    minDuration,
    maxDuration,
    traceId,
    rootService: params.root_service || undefined,
    httpRoute: params.http_route || undefined,
    errorOnly: parseBoolean(params.error_only),
    limit,
    cursor,
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

function parseJsonField(value: string | Record<string, string>): Record<string, string> {
  if (typeof value !== 'string') return value;
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
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

function normalizeTimestamp(value: string): string {
  return value.includes(' ') ? value.replace(' ', 'T') : value;
}

function buildTraceConditions(
  tenantId: string,
  filters: ParsedTraceFilters,
): { whereClause: string; havingClause: string; queryParams: Record<string, unknown> } {
  const conditions = [
    'tenant_id = {tenantId:String}',
    `timestamp >= ${parseUtcDateTime64('fromTime')}`,
    `timestamp <= ${parseUtcDateTime64('toTime')}`,
  ];
  const matchingTraceConditions = [
    'tenant_id = {tenantId:String}',
    `timestamp >= ${parseUtcDateTime64('fromTime')}`,
    `timestamp <= ${parseUtcDateTime64('toTime')}`,
  ];
  let hasMatchingSpanFilter = false;
  const havingConditions: string[] = [];
  const queryParams: Record<string, unknown> = {
    tenantId,
    fromTime: filters.fromTime,
    toTime: filters.toTime,
  };

  if (filters.service) {
    matchingTraceConditions.push('service_name = {service:String}');
    hasMatchingSpanFilter = true;
    queryParams.service = filters.service;
  }
  if (filters.environment) {
    conditions.push('environment = {environment:String}');
    queryParams.environment = filters.environment;
  }
  if (filters.operation) {
    matchingTraceConditions.push('positionCaseInsensitive(operation_name, {operation:String}) > 0');
    hasMatchingSpanFilter = true;
    queryParams.operation = filters.operation;
  }
  if (filters.traceId) {
    conditions.push('trace_id = {traceId:String}');
    queryParams.traceId = filters.traceId;
  }
  if (filters.httpRoute) {
    matchingTraceConditions.push(
      "coalesce(nullIf(JSONExtractString(attributes, 'http.route'), ''), JSONExtractString(attributes, 'route')) = {httpRoute:String}",
    );
    hasMatchingSpanFilter = true;
    queryParams.httpRoute = filters.httpRoute;
  }
  if (hasMatchingSpanFilter) {
    conditions.push(
      `trace_id IN (SELECT DISTINCT trace_id FROM spans WHERE ${matchingTraceConditions.join(' AND ')})`,
    );
  }
  if (filters.minDuration !== undefined) {
    havingConditions.push('duration_ms >= {minDuration:Float64}');
    queryParams.minDuration = filters.minDuration;
  }
  if (filters.maxDuration !== undefined) {
    havingConditions.push('duration_ms <= {maxDuration:Float64}');
    queryParams.maxDuration = filters.maxDuration;
  }
  if (filters.status) {
    havingConditions.push('status = {status:String}');
    queryParams.status = filters.status;
  }
  if (filters.errorOnly) {
    havingConditions.push('error_count > 0');
  }
  if (filters.rootService) {
    havingConditions.push('root_service = {rootService:String}');
    queryParams.rootService = filters.rootService;
  }
  if (filters.cursor) {
    havingConditions.push(
      `(trace_timestamp < ${parseUtcDateTime64('cursorTs')} OR (trace_timestamp = ${parseUtcDateTime64('cursorTs')} AND trace_id < {cursorId:String}))`,
    );
    queryParams.cursorTs = filters.cursor.ts;
    queryParams.cursorId = filters.cursor.id;
  }

  return {
    whereClause: conditions.join(' AND '),
    havingClause: havingConditions.length > 0 ? `HAVING ${havingConditions.join(' AND ')}` : '',
    queryParams,
  };
}

function traceSummaryQuery(whereClause: string, havingClause = '', suffix = ''): string {
  return `
    SELECT
      trace_id,
      min(timestamp) AS trace_timestamp,
      argMinIf(service_name, timestamp, parent_span_id = '') AS root_service,
      argMinIf(operation_name, timestamp, parent_span_id = '') AS root_operation,
      argMinIf(environment, timestamp, parent_span_id = '') AS root_environment,
      greatest(max(toUnixTimestamp64Milli(timestamp) + toInt64(greatest(duration_ms, 0))) - min(toUnixTimestamp64Milli(timestamp)), 0) AS duration_ms,
      count() AS span_count,
      countIf(status_code = 'ERROR') AS error_count,
      groupUniqArray(20)(service_name) AS services,
      if(countIf(status_code = 'ERROR') > 0, 'ERROR', 'OK') AS status
    FROM spans
    WHERE ${whereClause}
    GROUP BY trace_id
    ${havingClause}
    ${suffix}
  `;
}

function mapLogRow(row: LogRow): CanonicalLog {
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    project_id: row.project_id,
    timestamp: row.timestamp,
    received_at: row.received_at,
    service_name: row.service_name,
    environment: row.environment,
    source: row.source,
    resource_attributes: parseJsonField(row.resource_attributes),
    attributes: parseJsonField(row.attributes),
    severity: row.severity,
    message: row.message,
    trace_id: row.trace_id,
    span_id: row.span_id,
    fingerprint: row.fingerprint ?? '',
  };
}

function mapSpanRow(row: SpanRow): CanonicalSpan {
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    project_id: row.project_id,
    timestamp: row.timestamp,
    received_at: row.received_at,
    service_name: row.service_name,
    environment: row.environment,
    source: row.source,
    resource_attributes: parseJsonField(row.resource_attributes),
    attributes: parseJsonField(row.attributes),
    trace_id: row.trace_id,
    span_id: row.span_id,
    parent_span_id: row.parent_span_id || null,
    operation_name: row.operation_name,
    duration_ms: toNumber(row.duration_ms),
    status_code: row.status_code,
    status_message: row.status_message,
    kind: row.kind,
  };
}

function makeLatencyBuckets(rows: TraceSummaryRow[]): TraceLatencyBucket[] {
  const counts = new Map<TraceLatencyBucket['bucket'], number>();
  for (const bucket of LATENCY_BUCKETS) counts.set(bucket, 0);
  for (const row of rows) {
    const duration = toNumber(row.duration_ms);
    const bucket =
      duration < 100
        ? '<100ms'
        : duration < 300
          ? '100-300ms'
          : duration < 1000
            ? '300-1000ms'
            : duration < 3000
              ? '1-3s'
              : '>3s';
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
  }
  return LATENCY_BUCKETS.map((bucket) => ({ bucket, count: counts.get(bucket) ?? 0 }));
}

async function fetchLatencyBuckets(
  tenantId: string,
  filters: ParsedTraceFilters,
): Promise<TraceLatencyBucket[]> {
  const bucketFilters = { ...filters, cursor: undefined };
  const { whereClause, havingClause, queryParams } = buildTraceConditions(tenantId, bucketFilters);
  const rows = await getClickHouseClient().query<LatencyBucketRow>(
    `
      SELECT
        bucket,
        count() AS count
      FROM (
        SELECT
          multiIf(
            duration_ms < 100, '<100ms',
            duration_ms < 300, '100-300ms',
            duration_ms < 1000, '300-1000ms',
            duration_ms < 3000, '1-3s',
            '>3s'
          ) AS bucket
        FROM (
          ${traceSummaryQuery(whereClause, havingClause)}
        )
      )
      GROUP BY bucket
    `,
    queryParams,
  );
  const counts = new Map<TraceLatencyBucket['bucket'], number>();
  for (const row of rows) {
    if (row.bucket && LATENCY_BUCKETS.includes(row.bucket)) {
      counts.set(row.bucket, toNumber(row.count));
    }
  }
  return LATENCY_BUCKETS.map((bucket) => ({ bucket, count: counts.get(bucket) ?? 0 }));
}

async function findDeploymentHints(
  tenantId: string,
  projectId: string,
  rows: TraceSummaryRow[],
): Promise<Map<string, string>> {
  const datedRows = rows
    .map((row) => ({
      traceId: row.trace_id,
      rootService: row.root_service,
      environment: row.root_environment,
      timestamp: new Date(normalizeTimestamp(row.trace_timestamp)).getTime(),
    }))
    .filter(
      (row) => row.rootService && row.environment && row.traceId && Number.isFinite(row.timestamp),
    );

  if (datedRows.length === 0) return new Map();
  const from = Math.min(...datedRows.map((row) => row.timestamp)) - DEPLOYMENT_WINDOW_MS;
  const to = Math.max(...datedRows.map((row) => row.timestamp)) + DEPLOYMENT_WINDOW_MS;

  const deploymentRows = await getClickHouseClient().query<DeploymentHintRow>(
    `
      SELECT
        toString(deployment_id) AS deployment_id,
        timestamp,
        service_name,
        environment
      FROM deployment_events
      WHERE tenant_id = {tenantId:String}
        AND project_id = {projectId:String}
        AND timestamp >= ${parseUtcDateTime64('deploymentFrom')}
        AND timestamp <= ${parseUtcDateTime64('deploymentTo')}
      ORDER BY timestamp DESC
      LIMIT 500
    `,
    {
      tenantId,
      projectId,
      deploymentFrom: new Date(from).toISOString(),
      deploymentTo: new Date(to).toISOString(),
    },
  );

  const hints = new Map<string, string>();
  for (const trace of datedRows) {
    let nearestDeployment: DeploymentHintRow | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const deployment of deploymentRows) {
      if (!deployment.deployment_id || !deployment.timestamp) continue;
      if (deployment.service_name !== trace.rootService) continue;
      if (deployment.environment !== trace.environment) continue;
      const distance = Math.abs(
        new Date(normalizeTimestamp(deployment.timestamp)).getTime() - trace.timestamp,
      );
      if (distance <= DEPLOYMENT_WINDOW_MS && distance < nearestDistance) {
        nearestDeployment = deployment;
        nearestDistance = distance;
      }
    }
    if (nearestDeployment?.deployment_id) {
      hints.set(trace.traceId, nearestDeployment.deployment_id);
    }
  }

  return hints;
}

function mapTraceSummaryRow(
  row: TraceSummaryRow,
  deploymentHints: Map<string, string>,
): TraceSummary {
  const startTime = normalizeTimestamp(row.trace_timestamp);
  const deploymentId = deploymentHints.get(row.trace_id) ?? null;
  return {
    trace_id: row.trace_id,
    root_service: row.root_service || '',
    root_operation: row.root_operation || '',
    start_time: startTime,
    timestamp: startTime,
    duration_ms: toNumber(row.duration_ms),
    span_count: toNumber(row.span_count),
    error_count: toNumber(row.error_count),
    services: toStringArray(row.services),
    status: row.status || (toNumber(row.error_count) > 0 ? 'ERROR' : 'OK'),
    near_deployment: deploymentId !== null,
    deployment_id: deploymentId,
  };
}

function buildTraceDetailSummary(
  traceId: string,
  spans: CanonicalSpan[],
  relatedLogsCount: number,
  deployment: TraceDeploymentHint,
): TraceDetailSummary {
  const sortedSpans = [...spans].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );
  const starts = sortedSpans
    .map((span) => new Date(span.timestamp).getTime())
    .filter((value) => Number.isFinite(value));
  const startMs = starts.length > 0 ? Math.min(...starts) : 0;
  const endMs = Math.max(
    startMs,
    ...sortedSpans.map((span) => {
      const start = new Date(span.timestamp).getTime();
      return Number.isFinite(start) ? start + Math.max(span.duration_ms, 0) : startMs;
    }),
  );
  const root = sortedSpans.find((span) => !span.parent_span_id) ?? sortedSpans[0];
  const services = [...new Set(sortedSpans.map((span) => span.service_name).filter(Boolean))];
  const errorCount = sortedSpans.filter((span) => span.status_code === 'ERROR').length;
  const startTime = startMs > 0 ? new Date(startMs).toISOString() : '';
  return {
    trace_id: traceId,
    start_time: startTime,
    timestamp: startTime,
    duration_ms: Math.max(endMs - startMs, 0),
    root_service: root?.service_name ?? '',
    root_operation: root?.operation_name ?? '',
    status: errorCount > 0 ? 'ERROR' : 'OK',
    span_count: sortedSpans.length,
    error_count: errorCount,
    services,
    related_logs_count: relatedLogsCount,
    deployment,
  };
}

async function findNearestDeployment(
  tenantId: string,
  projectId: string,
  service: string,
  environment: string,
  timestamp: string,
): Promise<TraceDeploymentHint> {
  if (!service || !environment || !timestamp) {
    return { near_deployment: false, deployment_id: null };
  }
  const start = new Date(timestamp).getTime();
  if (!Number.isFinite(start)) {
    return { near_deployment: false, deployment_id: null };
  }
  const rows = await getClickHouseClient().query<DeploymentHintRow>(
    `
      SELECT
        toString(deployment_id) AS deployment_id,
        timestamp,
        service_name,
        environment
      FROM deployment_events
      WHERE tenant_id = {tenantId:String}
        AND project_id = {projectId:String}
        AND service_name = {service:String}
        AND environment = {environment:String}
        AND timestamp >= ${parseUtcDateTime64('fromTime')}
        AND timestamp <= ${parseUtcDateTime64('toTime')}
      ORDER BY timestamp DESC
      LIMIT 20
    `,
    {
      tenantId,
      projectId,
      service,
      environment,
      fromTime: new Date(start - DEPLOYMENT_WINDOW_MS).toISOString(),
      toTime: new Date(start + DEPLOYMENT_WINDOW_MS).toISOString(),
    },
  );
  let match: DeploymentHintRow | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const row of rows) {
    if (!row.deployment_id || !row.timestamp) continue;
    const deploymentTime = new Date(normalizeTimestamp(row.timestamp)).getTime();
    if (!Number.isFinite(deploymentTime)) continue;
    const distance = Math.abs(deploymentTime - start);
    if (distance <= DEPLOYMENT_WINDOW_MS && distance < nearestDistance) {
      match = row;
      nearestDistance = distance;
    }
  }
  return {
    near_deployment: Boolean(match?.deployment_id),
    deployment_id: match?.deployment_id ?? null,
  };
}

async function fetchSpansForTrace(tenantId: string, traceId: string): Promise<CanonicalSpan[]> {
  const rows = await getClickHouseClient().query<SpanRow>(
    `
      SELECT
        id,
        tenant_id,
        project_id,
        timestamp,
        received_at,
        service_name,
        environment,
        source,
        resource_attributes,
        attributes,
        trace_id,
        span_id,
        parent_span_id,
        operation_name,
        duration_ms,
        status_code,
        status_message,
        kind
      FROM spans
      WHERE tenant_id = {tenantId:String} AND trace_id = {traceId:String}
      ORDER BY timestamp ASC
      LIMIT 10000
    `,
    { tenantId, traceId },
  );
  return rows.map(mapSpanRow);
}

async function fetchRelatedLogs(
  tenantId: string,
  traceId: string,
  spanId?: string,
): Promise<CanonicalLog[]> {
  const conditions = ['tenant_id = {tenantId:String}', 'trace_id = {traceId:String}'];
  const params: Record<string, unknown> = { tenantId, traceId };
  if (spanId) {
    conditions.push('span_id = {spanId:String}');
    params.spanId = spanId;
  }
  const rows = await getClickHouseClient().query<LogRow>(
    `
      SELECT
        toString(id) AS id,
        tenant_id,
        project_id,
        timestamp,
        received_at,
        service_name,
        environment,
        source,
        '{}' AS resource_attributes,
        '{}' AS attributes,
        severity,
        message,
        trace_id,
        span_id,
        fingerprint
      FROM logs
      WHERE ${conditions.join(' AND ')}
      ORDER BY timestamp ASC
      LIMIT 500
    `,
    params,
  );
  return rows.map(mapLogRow);
}

async function countRelatedLogs(tenantId: string, traceId: string): Promise<number> {
  const rows = await getClickHouseClient().query<{ count: string | number }>(
    `
      SELECT count() AS count
      FROM logs
      WHERE tenant_id = {tenantId:String} AND trace_id = {traceId:String}
    `,
    { tenantId, traceId },
  );
  return toNumber(rows[0]?.count);
}

export async function traceQueryRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: TraceListQuery }>(
    '/v1/traces',
    { preHandler: authMiddleware },
    async (request, reply) => {
      const filters = parseTraceFilters(request.query);
      if (filters instanceof Error) return sendInvalid(reply, filters);

      const { tenantId, projectId } = request.tenantContext;
      const { whereClause, havingClause, queryParams } = buildTraceConditions(tenantId, filters);
      queryParams.fetchLimit = filters.limit + 1;
      const rows = await getClickHouseClient().query<TraceSummaryRow>(
        traceSummaryQuery(
          whereClause,
          havingClause,
          'ORDER BY trace_timestamp DESC, trace_id DESC LIMIT {fetchLimit:UInt32}',
        ),
        queryParams,
      );

      const hasMore = rows.length > filters.limit;
      const resultRows = hasMore ? rows.slice(0, filters.limit) : rows;
      const [deploymentHints, latencyBuckets] =
        resultRows.length > 0
          ? await Promise.all([
              findDeploymentHints(tenantId, projectId, resultRows),
              fetchLatencyBuckets(tenantId, filters),
            ])
          : [new Map(), makeLatencyBuckets([])];
      const data = resultRows.map((row) => mapTraceSummaryRow(row, deploymentHints));
      const lastRow = data[data.length - 1];
      const response: TraceListResponse = {
        data,
        pagination: {
          cursor: hasMore && lastRow ? encodeCursor(lastRow.start_time, lastRow.trace_id) : null,
          hasMore,
        },
        summary: {
          latency_buckets: latencyBuckets,
        },
      };
      return reply.status(200).send(response);
    },
  );

  app.get<{ Params: TraceDetailParams; Querystring: TraceLogsQuery }>(
    '/v1/traces/:traceId/logs',
    { preHandler: authMiddleware },
    async (request, reply) => {
      const traceId = validateTraceId(request.params.traceId, 'traceId');
      if (traceId instanceof Error) return sendInvalid(reply, traceId);
      if (traceId === undefined) {
        return sendInvalid(reply, new Error('Invalid parameter: traceId is required'));
      }
      const logs = await fetchRelatedLogs(
        request.tenantContext.tenantId,
        traceId,
        request.query.span_id,
      );
      const response: TraceLogsResponse = { data: logs };
      return reply.status(200).send(response);
    },
  );

  app.get<{ Params: TraceDetailParams; Querystring: SimilarTraceQuery }>(
    '/v1/traces/:traceId/similar',
    { preHandler: authMiddleware },
    async (request, reply) => {
      const traceId = validateTraceId(request.params.traceId, 'traceId');
      if (traceId instanceof Error) return sendInvalid(reply, traceId);
      if (traceId === undefined) {
        return sendInvalid(reply, new Error('Invalid parameter: traceId is required'));
      }
      if (request.query.from && !isValidISO8601(request.query.from)) {
        return sendInvalid(
          reply,
          new Error('Invalid parameter: from must be a valid ISO 8601 timestamp'),
        );
      }
      if (request.query.to && !isValidISO8601(request.query.to)) {
        return sendInvalid(
          reply,
          new Error('Invalid parameter: to must be a valid ISO 8601 timestamp'),
        );
      }
      const limit = request.query.limit ? parseInt(request.query.limit, 10) : 10;
      if (Number.isNaN(limit) || limit < 1 || limit > 50) {
        return sendInvalid(reply, new Error('Invalid parameter: limit must be between 1 and 50'));
      }

      const spans = await fetchSpansForTrace(request.tenantContext.tenantId, traceId);
      if (spans.length === 0) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: `Trace with id '${traceId}' not found` },
        });
      }
      const targetSummary = buildTraceDetailSummary(traceId, spans, 0, {
        near_deployment: false,
        deployment_id: null,
      });
      const targetStart = new Date(targetSummary.start_time).getTime();
      const filters: ParsedTraceFilters = {
        fromTime: request.query.from ?? new Date(targetStart - 24 * 60 * 60 * 1000).toISOString(),
        toTime: request.query.to ?? new Date(targetStart + 24 * 60 * 60 * 1000).toISOString(),
        rootService: targetSummary.root_service,
        environment: spans[0]?.environment,
        limit,
        errorOnly: false,
      };
      const { whereClause, havingClause, queryParams } = buildTraceConditions(
        request.tenantContext.tenantId,
        filters,
      );
      const similarRows = await getClickHouseClient().query<TraceSummaryRow>(
        traceSummaryQuery(
          whereClause,
          `${havingClause ? `${havingClause} AND` : 'HAVING'} root_operation = {rootOperation:String} AND trace_id != {traceId:String}`,
          'ORDER BY trace_timestamp DESC, trace_id DESC LIMIT {limit:UInt32}',
        ),
        {
          ...queryParams,
          rootOperation: targetSummary.root_operation,
          traceId,
          limit,
        },
      );
      const data: SimilarTrace[] = similarRows.map((row) => {
        const startTime = normalizeTimestamp(row.trace_timestamp);
        return {
          trace_id: row.trace_id,
          start_time: startTime,
          timestamp: startTime,
          duration_ms: toNumber(row.duration_ms),
          status: row.status || (toNumber(row.error_count) > 0 ? 'ERROR' : 'OK'),
          error_count: toNumber(row.error_count),
        };
      });
      const response: SimilarTracesResponse = { data };
      return reply.status(200).send(response);
    },
  );

  app.get<{ Params: TraceDetailParams }>(
    '/v1/traces/:traceId',
    { preHandler: authMiddleware },
    async (request, reply) => {
      const traceId = validateTraceId(request.params.traceId, 'traceId');
      if (traceId instanceof Error) return sendInvalid(reply, traceId);
      if (traceId === undefined) {
        return sendInvalid(reply, new Error('Invalid parameter: traceId is required'));
      }

      const spans = await fetchSpansForTrace(request.tenantContext.tenantId, traceId);
      if (spans.length === 0) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: `Trace with id '${traceId}' not found` },
        });
      }
      const relatedLogsCount = await countRelatedLogs(request.tenantContext.tenantId, traceId);
      const preliminary = buildTraceDetailSummary(traceId, spans, relatedLogsCount, {
        near_deployment: false,
        deployment_id: null,
      });
      const deployment = await findNearestDeployment(
        request.tenantContext.tenantId,
        request.tenantContext.projectId,
        preliminary.root_service,
        spans[0]?.environment ?? '',
        preliminary.start_time,
      );
      const summary = buildTraceDetailSummary(traceId, spans, relatedLogsCount, deployment);
      return reply.status(200).send({ data: spans, summary });
    },
  );
}
