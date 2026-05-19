import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../../middleware/auth.js';
import { getClickHouseClient } from '../../db/clickhouse.js';
import type {
  CanonicalLog,
  LogAroundResponse,
  LogFacetCollection,
  LogFacetName,
  LogGroup,
  LogGroupsResponse,
  LogQueryResponse,
  LogSeverity,
} from '@rootpilot/shared';

const VALID_SEVERITIES: Set<string> = new Set(['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL']);
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 1000;
const DEFAULT_TIME_RANGE_MS = 60 * 60 * 1000;
const DEFAULT_AROUND_SECONDS = 300;
const MAX_AROUND_SECONDS = 3600;
const FACET_LIMIT = 8;

const ERROR_TYPE_EXPR = `coalesce(nullIf(JSONExtractString(attributes, 'error.type'), ''), nullIf(JSONExtractString(attributes, 'exception.type'), ''))`;
const HTTP_ROUTE_EXPR = `coalesce(nullIf(JSONExtractString(attributes, 'http.route'), ''), nullIf(JSONExtractString(attributes, 'route'), ''))`;
const VERSION_EXPR = `coalesce(nullIf(JSONExtractString(resource_attributes, 'service.version'), ''), nullIf(JSONExtractString(attributes, 'service.version'), ''), nullIf(JSONExtractString(resource_attributes, 'version'), ''))`;
const EFFECTIVE_FINGERPRINT_EXPR = `if(fingerprint != '', fingerprint, concat('legacy:', lower(hex(SHA256(concat(service_name, '|', environment, '|', message))))))`;

interface LogQueryParams {
  from?: string;
  to?: string;
  service_name?: string;
  environment?: string;
  severity?: string;
  search?: string;
  trace_id?: string;
  span_id?: string;
  error_type?: string;
  fingerprint?: string;
  version?: string;
  attribute_filters?: string;
  limit?: string;
  cursor?: string;
}

interface LogAroundQueryParams {
  log_id?: string;
  timestamp?: string;
  service?: string;
  environment?: string;
  trace_id?: string;
  before_seconds?: string;
  after_seconds?: string;
}

interface LogGroupsQueryParams {
  from?: string;
  to?: string;
  service?: string;
  environment?: string;
  severity?: string;
  search?: string;
  limit?: string;
}

interface AttributeFilter {
  key: string;
  value: string;
}

interface ParsedLogFilters {
  fromTime: string;
  toTime: string;
  serviceName?: string;
  environment?: string;
  severity?: LogSeverity;
  search?: string;
  traceId?: string;
  spanId?: string;
  errorType?: string;
  fingerprint?: string;
  version?: string;
  attributeFilters: AttributeFilter[];
}

interface DecodedCursor {
  ts: string;
  id: string;
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
  resource_attributes: string;
  attributes: string;
  severity: string;
  message: string;
  trace_id: string;
  span_id: string;
  fingerprint: string;
}

interface LogSummaryRow {
  total: number | string;
  error_count: number | string;
  warning_count: number | string;
}

interface LogFacetRow {
  facet: LogFacetName;
  value: string;
  count: number | string;
}

interface LogGroupRow {
  fingerprint: string;
  normalized_message: string;
  example_message: string;
  count: number | string;
  first_seen_at: string;
  last_seen_at: string;
  service_name: string;
  severity: string;
  example_trace_id: string;
}

interface AroundTarget {
  timestamp: string;
  serviceName: string;
  environment: string;
}

function isValidISO8601(value: string): boolean {
  const date = new Date(value);
  return value.trim().length > 0 && !isNaN(date.getTime());
}

function parseUtcDateTime64(paramName: string): string {
  return `parseDateTime64BestEffort({${paramName}:String}, 3, 'UTC')`;
}

function encodeCursor(ts: string, id: string): string {
  return Buffer.from(JSON.stringify({ ts, id })).toString('base64');
}

function decodeCursor(cursor: string): DecodedCursor | null {
  try {
    const decoded = Buffer.from(cursor, 'base64').toString('utf-8');
    const parsed = JSON.parse(decoded);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof parsed.ts === 'string' &&
      typeof parsed.id === 'string'
    ) {
      return parsed as DecodedCursor;
    }
    return null;
  } catch {
    return null;
  }
}

function parseLimit(
  value: string | undefined,
  defaultLimit: number,
  maxLimit: number,
): number | Error {
  if (value === undefined) return defaultLimit;

  const parsedLimit = parseInt(value, 10);
  if (isNaN(parsedLimit) || parsedLimit < 1) {
    return new Error('Invalid parameter: limit must be a positive integer');
  }
  if (parsedLimit > maxLimit) {
    return new Error(`Invalid parameter: limit must not exceed ${maxLimit}`);
  }
  return parsedLimit;
}

function parseSeverity(value: string | undefined): LogSeverity | Error | undefined {
  if (value === undefined || value === '') return undefined;

  const severity = value.toUpperCase();
  if (!VALID_SEVERITIES.has(severity)) {
    return new Error(
      'Invalid parameter: severity must be one of TRACE, DEBUG, INFO, WARN, ERROR, FATAL',
    );
  }
  return severity as LogSeverity;
}

function parseTimeRange(params: {
  from?: string;
  to?: string;
}): { fromTime: string; toTime: string } | Error {
  const now = new Date();
  let fromTime: string;
  let toTime: string;

  if (params.from !== undefined) {
    if (!isValidISO8601(params.from)) {
      return new Error('Invalid parameter: from must be a valid ISO 8601 timestamp');
    }
    fromTime = new Date(params.from).toISOString();
  } else {
    fromTime = new Date(now.getTime() - DEFAULT_TIME_RANGE_MS).toISOString();
  }

  if (params.to !== undefined) {
    if (!isValidISO8601(params.to)) {
      return new Error('Invalid parameter: to must be a valid ISO 8601 timestamp');
    }
    toTime = new Date(params.to).toISOString();
  } else {
    toTime = now.toISOString();
  }

  return { fromTime, toTime };
}

function parseAttributeFilters(value: string | undefined): AttributeFilter[] | Error {
  if (value === undefined || value.trim() === '') return [];

  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      return new Error('Invalid parameter: attribute_filters must be a JSON array');
    }
    if (parsed.length > 10) {
      return new Error('Invalid parameter: attribute_filters must contain at most 10 filters');
    }

    return parsed.map((item, index) => {
      if (
        typeof item !== 'object' ||
        item === null ||
        typeof item.key !== 'string' ||
        typeof item.value !== 'string' ||
        item.key.trim() === '' ||
        item.value.trim() === ''
      ) {
        throw new Error(
          `Invalid parameter: attribute_filters[${index}] must include key and value strings`,
        );
      }

      return {
        key: item.key,
        value: item.value,
      };
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('attribute_filters')) {
      return error;
    }
    return new Error('Invalid parameter: attribute_filters must be valid JSON');
  }
}

function parseLogFilters(params: LogQueryParams): ParsedLogFilters | Error {
  const timeRange = parseTimeRange(params);
  if (timeRange instanceof Error) return timeRange;

  const severity = parseSeverity(params.severity);
  if (severity instanceof Error) return severity;

  const attributeFilters = parseAttributeFilters(params.attribute_filters);
  if (attributeFilters instanceof Error) return attributeFilters;

  return {
    fromTime: timeRange.fromTime,
    toTime: timeRange.toTime,
    serviceName: params.service_name,
    environment: params.environment,
    severity,
    search: params.search,
    traceId: params.trace_id,
    spanId: params.span_id,
    errorType: params.error_type,
    fingerprint: params.fingerprint,
    version: params.version,
    attributeFilters,
  };
}

function buildLogWhereClause(
  tenantId: string,
  filters: ParsedLogFilters,
  options: { cursor?: DecodedCursor } = {},
): { whereClause: string; queryParams: Record<string, unknown> } {
  const conditions: string[] = [
    'tenant_id = {tenantId:String}',
    `logs.timestamp >= ${parseUtcDateTime64('fromTime')}`,
    `logs.timestamp <= ${parseUtcDateTime64('toTime')}`,
  ];
  const queryParams: Record<string, unknown> = {
    tenantId,
    fromTime: filters.fromTime,
    toTime: filters.toTime,
  };

  if (filters.serviceName) {
    conditions.push('service_name = {serviceName:String}');
    queryParams['serviceName'] = filters.serviceName;
  }

  if (filters.environment) {
    conditions.push('environment = {environment:String}');
    queryParams['environment'] = filters.environment;
  }

  if (filters.severity) {
    conditions.push('severity = {severity:String}');
    queryParams['severity'] = filters.severity;
  }

  if (filters.search) {
    conditions.push('positionCaseInsensitive(message, {search:String}) > 0');
    queryParams['search'] = filters.search;
  }

  if (filters.traceId) {
    conditions.push('trace_id = {traceId:String}');
    queryParams['traceId'] = filters.traceId;
  }

  if (filters.spanId) {
    conditions.push('span_id = {spanId:String}');
    queryParams['spanId'] = filters.spanId;
  }

  if (filters.errorType) {
    conditions.push(`${ERROR_TYPE_EXPR} = {errorType:String}`);
    queryParams['errorType'] = filters.errorType;
  }

  if (filters.fingerprint) {
    conditions.push(`${EFFECTIVE_FINGERPRINT_EXPR} = {fingerprint:String}`);
    queryParams['fingerprint'] = filters.fingerprint;
  }

  if (filters.version) {
    conditions.push(`${VERSION_EXPR} = {version:String}`);
    queryParams['version'] = filters.version;
  }

  filters.attributeFilters.forEach((filter, index) => {
    conditions.push(
      `JSONExtractString(attributes, {attributeKey${index}:String}) = {attributeValue${index}:String}`,
    );
    queryParams[`attributeKey${index}`] = filter.key;
    queryParams[`attributeValue${index}`] = filter.value;
  });

  if (options.cursor) {
    conditions.push(
      `(logs.timestamp < ${parseUtcDateTime64('cursorTs')} OR (logs.timestamp = ${parseUtcDateTime64('cursorTs')} AND id < {cursorId:String}))`,
    );
    queryParams['cursorTs'] = options.cursor.ts;
    queryParams['cursorId'] = options.cursor.id;
  }

  return {
    whereClause: conditions.join(' AND '),
    queryParams,
  };
}

function logSelectColumns(): string {
  return `
    id,
    tenant_id,
    project_id,
    formatDateTime(timestamp, '%Y-%m-%dT%H:%i:%S.%f', 'UTC') AS timestamp,
    formatDateTime(received_at, '%Y-%m-%dT%H:%i:%S.%f', 'UTC') AS received_at,
    service_name,
    environment,
    source,
    resource_attributes,
    attributes,
    severity,
    message,
    trace_id,
    span_id,
    fingerprint
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
    severity: row.severity as LogSeverity,
    message: row.message,
    trace_id: row.trace_id,
    span_id: row.span_id,
    fingerprint: row.fingerprint,
  };
}

export async function logQueryRoute(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: LogAroundQueryParams }>(
    '/v1/logs/around',
    { preHandler: authMiddleware },
    async (request, reply) => {
      const { tenantId } = request.tenantContext;
      const beforeSeconds = parseAroundSeconds(
        request.query.before_seconds,
        DEFAULT_AROUND_SECONDS,
        'before_seconds',
      );
      if (beforeSeconds instanceof Error) {
        return reply
          .status(400)
          .send({ error: { code: 'INVALID_PARAMETER', message: beforeSeconds.message } });
      }

      const afterSeconds = parseAroundSeconds(
        request.query.after_seconds,
        DEFAULT_AROUND_SECONDS,
        'after_seconds',
      );
      if (afterSeconds instanceof Error) {
        return reply
          .status(400)
          .send({ error: { code: 'INVALID_PARAMETER', message: afterSeconds.message } });
      }

      const target = await resolveAroundTarget(tenantId, request.query);
      if (target instanceof Error) {
        const statusCode = target.message.includes('not found') ? 404 : 400;
        return reply.status(statusCode).send({
          error: {
            code: statusCode === 404 ? 'NOT_FOUND' : 'INVALID_PARAMETER',
            message: target.message,
          },
        });
      }

      const targetTime = new Date(target.timestamp).getTime();
      const fromTime = new Date(targetTime - beforeSeconds * 1000).toISOString();
      const toTime = new Date(targetTime + afterSeconds * 1000).toISOString();

      const conditions = [
        'tenant_id = {tenantId:String}',
        'service_name = {serviceName:String}',
        'environment = {environment:String}',
        `logs.timestamp >= ${parseUtcDateTime64('fromTime')}`,
        `logs.timestamp <= ${parseUtcDateTime64('toTime')}`,
      ];
      const params: Record<string, unknown> = {
        tenantId,
        serviceName: target.serviceName,
        environment: target.environment,
        fromTime,
        toTime,
      };

      if (request.query.trace_id) {
        conditions.push('trace_id = {traceId:String}');
        params['traceId'] = request.query.trace_id;
      }

      const clickhouse = getClickHouseClient();
      const rows = await clickhouse.query<LogRow>(
        `
          SELECT ${logSelectColumns()}
          FROM logs
          WHERE ${conditions.join(' AND ')}
          ORDER BY timestamp ASC, id ASC
          LIMIT 500
        `,
        params,
      );

      const response: LogAroundResponse = { data: rows.map(mapLogRow) };
      return reply.status(200).send(response);
    },
  );

  app.get<{ Querystring: LogGroupsQueryParams }>(
    '/v1/logs/groups',
    { preHandler: authMiddleware },
    async (request, reply) => {
      const limit = parseLimit(request.query.limit, 100, 500);
      if (limit instanceof Error) {
        return reply
          .status(400)
          .send({ error: { code: 'INVALID_PARAMETER', message: limit.message } });
      }

      const severity = parseSeverity(request.query.severity);
      if (severity instanceof Error) {
        return reply
          .status(400)
          .send({ error: { code: 'INVALID_PARAMETER', message: severity.message } });
      }

      const timeRange = parseTimeRange(request.query);
      if (timeRange instanceof Error) {
        return reply
          .status(400)
          .send({ error: { code: 'INVALID_PARAMETER', message: timeRange.message } });
      }

      const filters: ParsedLogFilters = {
        fromTime: timeRange.fromTime,
        toTime: timeRange.toTime,
        serviceName: request.query.service,
        environment: request.query.environment,
        severity,
        search: request.query.search,
        attributeFilters: [],
      };
      const { whereClause, queryParams } = buildLogWhereClause(
        request.tenantContext.tenantId,
        filters,
      );
      queryParams['limit'] = limit;

      const clickhouse = getClickHouseClient();
      const rows = await clickhouse.query<LogGroupRow>(
        `
          SELECT
            grouping_fingerprint AS fingerprint,
            any(message) AS normalized_message,
            any(message) AS example_message,
            count() AS count,
            formatDateTime(min(timestamp), '%Y-%m-%dT%H:%i:%S.%f', 'UTC') AS first_seen_at,
            formatDateTime(max(timestamp), '%Y-%m-%dT%H:%i:%S.%f', 'UTC') AS last_seen_at,
            service_name,
            severity,
            maxIf(trace_id, trace_id != '') AS example_trace_id
          FROM (
            SELECT
              service_name,
              environment,
              severity,
              message,
              timestamp,
              trace_id,
              ${EFFECTIVE_FINGERPRINT_EXPR} AS grouping_fingerprint
            FROM logs
            WHERE ${whereClause}
          )
          GROUP BY grouping_fingerprint, service_name, severity
          ORDER BY count DESC, last_seen_at DESC
          LIMIT {limit:UInt32}
        `,
        queryParams,
      );

      const response: LogGroupsResponse = {
        data: rows.map(
          (row): LogGroup => ({
            fingerprint: row.fingerprint,
            normalized_message: row.normalized_message,
            example_message: row.example_message,
            count: toNumber(row.count),
            first_seen_at: row.first_seen_at,
            last_seen_at: row.last_seen_at,
            service_name: row.service_name,
            severity: row.severity,
            example_trace_id: row.example_trace_id || null,
          }),
        ),
      };

      return reply.status(200).send(response);
    },
  );

  app.get<{ Querystring: LogQueryParams }>(
    '/v1/logs',
    { preHandler: authMiddleware },
    async (request, reply) => {
      const limit = parseLimit(request.query.limit, DEFAULT_LIMIT, MAX_LIMIT);
      if (limit instanceof Error) {
        return reply
          .status(400)
          .send({ error: { code: 'INVALID_PARAMETER', message: limit.message } });
      }

      const filters = parseLogFilters(request.query);
      if (filters instanceof Error) {
        return reply
          .status(400)
          .send({ error: { code: 'INVALID_PARAMETER', message: filters.message } });
      }

      let cursorData: DecodedCursor | null = null;
      if (request.query.cursor !== undefined) {
        cursorData = decodeCursor(request.query.cursor);
        if (!cursorData) {
          return reply.status(400).send({
            error: {
              code: 'INVALID_PARAMETER',
              message: 'Invalid parameter: cursor is malformed or invalid',
            },
          });
        }
      }

      const { whereClause, queryParams } = buildLogWhereClause(
        request.tenantContext.tenantId,
        filters,
        {
          cursor: cursorData ?? undefined,
        },
      );
      queryParams['fetchLimit'] = limit + 1;

      const clickhouse = getClickHouseClient();
      const rows = await clickhouse.query<LogRow>(
        `
          SELECT ${logSelectColumns()}
          FROM logs
          WHERE ${whereClause}
          ORDER BY timestamp DESC, id DESC
          LIMIT {fetchLimit:UInt32}
        `,
        queryParams,
      );

      const hasMore = rows.length > limit;
      const resultRows = hasMore ? rows.slice(0, limit) : rows;
      const data = resultRows.map(mapLogRow);
      const lastRow = resultRows[resultRows.length - 1];
      const nextCursor = hasMore && lastRow ? encodeCursor(lastRow.timestamp, lastRow.id) : null;

      const response: LogQueryResponse = {
        data,
        pagination: {
          cursor: nextCursor,
          hasMore,
        },
        summary: await fetchLogSummary(request.tenantContext.tenantId, filters),
        facets: await fetchLogFacets(request.tenantContext.tenantId, filters),
      };

      return reply.status(200).send(response);
    },
  );
}

async function fetchLogSummary(
  tenantId: string,
  filters: ParsedLogFilters,
): Promise<LogQueryResponse['summary']> {
  const { whereClause, queryParams } = buildLogWhereClause(tenantId, filters);
  const clickhouse = getClickHouseClient();
  const rows = await clickhouse.query<LogSummaryRow>(
    `
      SELECT
        count() AS total,
        countIf(severity IN ('ERROR', 'FATAL')) AS error_count,
        countIf(severity = 'WARN') AS warning_count
      FROM logs
      WHERE ${whereClause}
    `,
    queryParams,
  );
  const row = rows[0];
  return {
    total: row ? toNumber(row.total) : 0,
    error_count: row ? toNumber(row.error_count) : 0,
    warning_count: row ? toNumber(row.warning_count) : 0,
    from: filters.fromTime,
    to: filters.toTime,
  };
}

async function fetchLogFacets(
  tenantId: string,
  filters: ParsedLogFilters,
): Promise<LogFacetCollection> {
  const { whereClause, queryParams } = buildLogWhereClause(tenantId, filters);
  const clickhouse = getClickHouseClient();
  const rows = await clickhouse.query<LogFacetRow>(
    `
      SELECT facet, value, count
      FROM (
        SELECT 'services' AS facet, service_name AS value, count() AS count
        FROM logs
        WHERE ${whereClause}
        GROUP BY service_name
        HAVING value != ''
        UNION ALL
        SELECT 'severities' AS facet, severity AS value, count() AS count
        FROM logs
        WHERE ${whereClause}
        GROUP BY severity
        HAVING value != ''
        UNION ALL
        SELECT 'environments' AS facet, environment AS value, count() AS count
        FROM logs
        WHERE ${whereClause}
        GROUP BY environment
        HAVING value != ''
        UNION ALL
        SELECT 'error_types' AS facet, ${ERROR_TYPE_EXPR} AS value, count() AS count
        FROM logs
        WHERE ${whereClause}
        GROUP BY value
        HAVING value != ''
        UNION ALL
        SELECT 'http_routes' AS facet, ${HTTP_ROUTE_EXPR} AS value, count() AS count
        FROM logs
        WHERE ${whereClause}
        GROUP BY value
        HAVING value != ''
        UNION ALL
        SELECT 'fingerprints' AS facet, ${EFFECTIVE_FINGERPRINT_EXPR} AS value, count() AS count
        FROM logs
        WHERE ${whereClause}
        GROUP BY value
        HAVING value != ''
        UNION ALL
        SELECT 'versions' AS facet, ${VERSION_EXPR} AS value, count() AS count
        FROM logs
        WHERE ${whereClause}
        GROUP BY value
        HAVING value != ''
      )
      ORDER BY facet ASC, count DESC
      LIMIT ${FACET_LIMIT} BY facet
    `,
    queryParams,
  );

  const facets: LogFacetCollection = {
    services: [],
    severities: [],
    environments: [],
    error_types: [],
    http_routes: [],
    fingerprints: [],
    versions: [],
  };

  for (const row of rows) {
    if (!row.facet || !(row.facet in facets) || !row.value) continue;
    facets[row.facet].push({
      value: row.value,
      count: toNumber(row.count),
    });
  }

  return facets;
}

async function resolveAroundTarget(
  tenantId: string,
  query: LogAroundQueryParams,
): Promise<AroundTarget | Error> {
  if (query.log_id) {
    const clickhouse = getClickHouseClient();
    const rows = await clickhouse.query<{
      timestamp: string;
      service_name: string;
      environment: string;
    }>(
      `
        SELECT
          formatDateTime(timestamp, '%Y-%m-%dT%H:%i:%S.%f', 'UTC') AS timestamp,
          service_name,
          environment
        FROM logs
        WHERE tenant_id = {tenantId:String} AND id = {logId:String}
        LIMIT 1
      `,
      { tenantId, logId: query.log_id },
    );

    const row = rows[0];
    if (!row) return new Error(`Log '${query.log_id}' was not found`);
    return {
      timestamp: withUtcSuffix(row.timestamp),
      serviceName: row.service_name,
      environment: row.environment,
    };
  }

  if (!query.timestamp || !query.service || !query.environment) {
    return new Error('Invalid parameter: provide log_id or timestamp, service, and environment');
  }

  if (!isValidISO8601(query.timestamp)) {
    return new Error('Invalid parameter: timestamp must be a valid ISO 8601 timestamp');
  }

  return {
    timestamp: new Date(query.timestamp).toISOString(),
    serviceName: query.service,
    environment: query.environment,
  };
}

function parseAroundSeconds(
  value: string | undefined,
  defaultValue: number,
  name: string,
): number | Error {
  if (value === undefined) return defaultValue;
  const parsed = parseInt(value, 10);
  if (isNaN(parsed) || parsed < 1 || parsed > MAX_AROUND_SECONDS) {
    return new Error(
      `Invalid parameter: ${name} must be a number between 1 and ${MAX_AROUND_SECONDS}`,
    );
  }
  return parsed;
}

function toNumber(value: number | string): number {
  if (typeof value === 'number') return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function withUtcSuffix(value: string): string {
  return value.endsWith('Z') ? value : `${value}Z`;
}

function parseJsonField(value: string): Record<string, string> {
  try {
    if (!value || value === '{}') return {};
    const parsed = JSON.parse(value);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}
