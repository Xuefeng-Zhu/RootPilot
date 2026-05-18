import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../../middleware/auth.js';
import { getClickHouseClient } from '../../db/clickhouse.js';
import type { CanonicalLog, LogSeverity } from '@rootpilot/shared';

/**
 * Valid severity values for log filtering.
 */
const VALID_SEVERITIES: Set<string> = new Set(['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL']);

/**
 * Default page size for log queries.
 */
const DEFAULT_LIMIT = 50;

/**
 * Maximum page size for log queries.
 */
const MAX_LIMIT = 1000;

/**
 * Default time range: 1 hour in milliseconds.
 */
const DEFAULT_TIME_RANGE_MS = 60 * 60 * 1000;

/**
 * Query parameters for the GET /v1/logs endpoint.
 */
interface LogQueryParams {
  from?: string;
  to?: string;
  service_name?: string;
  environment?: string;
  severity?: string;
  search?: string;
  limit?: string;
  cursor?: string;
}

/**
 * Decoded cursor structure for pagination.
 */
interface DecodedCursor {
  ts: string;
  id: string;
}

/**
 * Validates an ISO 8601 timestamp string.
 * Returns true if the string is a valid date.
 */
function isValidISO8601(value: string): boolean {
  const date = new Date(value);
  return !isNaN(date.getTime());
}

/**
 * Decodes a base64-encoded cursor string.
 * Returns null if the cursor is invalid.
 */
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

/**
 * Encodes a cursor from timestamp and id.
 */
function encodeCursor(ts: string, id: string): string {
  return Buffer.from(JSON.stringify({ ts, id })).toString('base64');
}

/**
 * Fastify plugin that registers the GET /v1/logs route.
 *
 * Supports filtering by time range, service_name, environment, severity,
 * and case-insensitive text search on message. Uses cursor-based pagination
 * with (timestamp, id) composite cursor. Always scopes queries to the
 * authenticated tenant.
 */
export async function logQueryRoute(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: LogQueryParams }>(
    '/v1/logs',
    { preHandler: authMiddleware },
    async (request, reply) => {
      const { tenantId } = request.tenantContext;
      const params = request.query;

      // ─── Validate limit ──────────────────────────────────────────────
      let limit = DEFAULT_LIMIT;
      if (params.limit !== undefined) {
        const parsedLimit = parseInt(params.limit, 10);
        if (isNaN(parsedLimit) || parsedLimit < 1) {
          return reply.status(400).send({
            error: {
              code: 'INVALID_PARAMETER',
              message: 'Invalid parameter: limit must be a positive integer',
            },
          });
        }
        if (parsedLimit > MAX_LIMIT) {
          return reply.status(400).send({
            error: {
              code: 'INVALID_PARAMETER',
              message: `Invalid parameter: limit must not exceed ${MAX_LIMIT}`,
            },
          });
        }
        limit = parsedLimit;
      }

      // ─── Validate time range ─────────────────────────────────────────
      const now = new Date();
      let fromTime: string;
      let toTime: string;

      if (params.from !== undefined) {
        if (!isValidISO8601(params.from)) {
          return reply.status(400).send({
            error: {
              code: 'INVALID_PARAMETER',
              message: 'Invalid parameter: from must be a valid ISO 8601 timestamp',
            },
          });
        }
        fromTime = new Date(params.from).toISOString();
      } else {
        fromTime = new Date(now.getTime() - DEFAULT_TIME_RANGE_MS).toISOString();
      }

      if (params.to !== undefined) {
        if (!isValidISO8601(params.to)) {
          return reply.status(400).send({
            error: {
              code: 'INVALID_PARAMETER',
              message: 'Invalid parameter: to must be a valid ISO 8601 timestamp',
            },
          });
        }
        toTime = new Date(params.to).toISOString();
      } else {
        toTime = now.toISOString();
      }

      // ─── Validate severity ───────────────────────────────────────────
      if (params.severity !== undefined) {
        const severityUpper = params.severity.toUpperCase();
        if (!VALID_SEVERITIES.has(severityUpper)) {
          return reply.status(400).send({
            error: {
              code: 'INVALID_PARAMETER',
              message: `Invalid parameter: severity must be one of TRACE, DEBUG, INFO, WARN, ERROR, FATAL`,
            },
          });
        }
      }

      // ─── Validate cursor ─────────────────────────────────────────────
      let cursorData: DecodedCursor | null = null;
      if (params.cursor !== undefined) {
        cursorData = decodeCursor(params.cursor);
        if (!cursorData) {
          return reply.status(400).send({
            error: {
              code: 'INVALID_PARAMETER',
              message: 'Invalid parameter: cursor is malformed or invalid',
            },
          });
        }
      }

      // ─── Build ClickHouse query ──────────────────────────────────────
      const conditions: string[] = [];
      const queryParams: Record<string, unknown> = {};

      // Always scope to tenant (Requirement 18.1)
      conditions.push('tenant_id = {tenantId:String}');
      queryParams['tenantId'] = tenantId;

      // Time range filter
      conditions.push('timestamp >= {fromTime:String}');
      queryParams['fromTime'] = fromTime;
      conditions.push('timestamp <= {toTime:String}');
      queryParams['toTime'] = toTime;

      // Optional filters
      if (params.service_name) {
        conditions.push('service_name = {serviceName:String}');
        queryParams['serviceName'] = params.service_name;
      }

      if (params.environment) {
        conditions.push('environment = {environment:String}');
        queryParams['environment'] = params.environment;
      }

      if (params.severity) {
        conditions.push('severity = {severity:String}');
        queryParams['severity'] = params.severity.toUpperCase();
      }

      // Case-insensitive text search on message field
      if (params.search) {
        conditions.push('positionCaseInsensitive(message, {search:String}) > 0');
        queryParams['search'] = params.search;
      }

      // Cursor-based pagination: fetch records older than the cursor
      if (cursorData) {
        conditions.push(
          '(timestamp < {cursorTs:String} OR (timestamp = {cursorTs:String} AND id < {cursorId:String}))',
        );
        queryParams['cursorTs'] = cursorData.ts;
        queryParams['cursorId'] = cursorData.id;
      }

      const whereClause = conditions.join(' AND ');

      // Fetch limit + 1 to determine hasMore
      const fetchLimit = limit + 1;

      const queryText = `
        SELECT
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
        FROM logs
        WHERE ${whereClause}
        ORDER BY timestamp DESC, id DESC
        LIMIT {fetchLimit:UInt32}
      `;
      queryParams['fetchLimit'] = fetchLimit;

      const clickhouse = getClickHouseClient();
      const rows = await clickhouse.query<{
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
      }>(queryText, queryParams);

      // Determine pagination
      const hasMore = rows.length > limit;
      const resultRows = hasMore ? rows.slice(0, limit) : rows;

      // Map rows to CanonicalLog format
      const data: CanonicalLog[] = resultRows.map((row) => ({
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
      }));

      // Build cursor for next page
      let nextCursor: string | null = null;
      if (hasMore && resultRows.length > 0) {
        const lastRow = resultRows[resultRows.length - 1];
        nextCursor = encodeCursor(lastRow.timestamp, lastRow.id);
      }

      return reply.status(200).send({
        data,
        pagination: {
          cursor: nextCursor,
          hasMore,
        },
      });
    },
  );
}

/**
 * Safely parses a JSON string field into a Record.
 * Returns an empty object if parsing fails.
 */
function parseJsonField(value: string): Record<string, string> {
  try {
    if (!value || value === '{}') return {};
    return JSON.parse(value);
  } catch {
    return {};
  }
}
