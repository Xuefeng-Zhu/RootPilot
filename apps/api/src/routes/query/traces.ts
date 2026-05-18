import { FastifyInstance } from 'fastify';
import { authMiddleware } from '../../middleware/auth.js';
import { getClickHouseClient } from '../../db/clickhouse.js';

/**
 * Query parameters for GET /v1/traces
 */
interface TraceListQuery {
  from?: string;
  to?: string;
  service?: string;
  environment?: string;
  minDuration?: string;
  limit?: string;
  cursor?: string;
}

/**
 * Route parameters for GET /v1/traces/:traceId
 */
interface TraceDetailParams {
  traceId: string;
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
 */
function isValidISO8601(value: string): boolean {
  const date = new Date(value);
  return !isNaN(date.getTime()) && value.length > 0;
}

/**
 * Encodes a cursor from timestamp and id.
 */
function encodeCursor(ts: string, id: string): string {
  return Buffer.from(JSON.stringify({ ts, id })).toString('base64');
}

/**
 * Decodes a base64-encoded cursor.
 * Returns null if the cursor is invalid.
 */
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

/**
 * Fastify plugin that registers trace query routes:
 * - GET /v1/traces — paginated trace summaries
 * - GET /v1/traces/:traceId — all spans for a trace
 */
export async function traceQueryRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /v1/traces
   * Returns paginated trace summaries scoped to the authenticated tenant.
   * Supports filters: from, to, service, environment, minDuration
   * Default time range: last 1 hour
   * Default limit: 50, max: 200
   * Cursor-based pagination sorted by timestamp descending
   */
  app.get<{ Querystring: TraceListQuery }>(
    '/v1/traces',
    { preHandler: authMiddleware },
    async (request, reply) => {
      const { from, to, service, environment, minDuration, limit: limitStr, cursor } = request.query;
      const { tenantId } = request.tenantContext;

      // Validate limit
      const limit = limitStr ? parseInt(limitStr, 10) : 50;
      if (isNaN(limit) || limit < 1) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_PARAMETER',
            message: 'Invalid parameter: limit must be a positive integer',
          },
        });
      }
      if (limit > 200) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_PARAMETER',
            message: 'Invalid parameter: limit must not exceed 200',
          },
        });
      }

      // Validate time range parameters
      if (from && !isValidISO8601(from)) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_PARAMETER',
            message: 'Invalid parameter: from must be a valid ISO 8601 timestamp',
          },
        });
      }
      if (to && !isValidISO8601(to)) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_PARAMETER',
            message: 'Invalid parameter: to must be a valid ISO 8601 timestamp',
          },
        });
      }

      // Validate minDuration
      if (minDuration !== undefined && minDuration !== '') {
        const minDurationNum = parseFloat(minDuration);
        if (isNaN(minDurationNum) || minDurationNum < 0) {
          return reply.status(400).send({
            error: {
              code: 'INVALID_PARAMETER',
              message: 'Invalid parameter: minDuration must be a non-negative number',
            },
          });
        }
      }

      // Decode cursor if provided
      let decodedCursor: DecodedCursor | null = null;
      if (cursor) {
        decodedCursor = decodeCursor(cursor);
        if (!decodedCursor) {
          return reply.status(400).send({
            error: {
              code: 'INVALID_PARAMETER',
              message: 'Invalid parameter: cursor is malformed',
            },
          });
        }
      }

      // Build time range defaults
      const now = new Date();
      const defaultFrom = new Date(now.getTime() - 60 * 60 * 1000); // 1 hour ago
      const fromTime = from ? new Date(from).toISOString() : defaultFrom.toISOString();
      const toTime = to ? new Date(to).toISOString() : now.toISOString();

      // Build WHERE conditions for the spans table
      const conditions: string[] = [
        `tenant_id = {tenantId:String}`,
        `timestamp >= {fromTime:String}`,
        `timestamp <= {toTime:String}`,
      ];
      const params: Record<string, unknown> = {
        tenantId,
        fromTime,
        toTime,
        fetchLimit: limit + 1, // fetch one extra to determine hasMore
      };

      if (service) {
        conditions.push(`service_name = {service:String}`);
        params.service = service;
      }

      if (environment) {
        conditions.push(`environment = {environment:String}`);
        params.environment = environment;
      }

      const whereClause = conditions.join(' AND ');

      // Build HAVING clause for post-aggregation filters
      const havingConditions: string[] = [];

      if (minDuration !== undefined && minDuration !== '') {
        const minDurationNum = parseFloat(minDuration);
        havingConditions.push(`duration_ms >= {minDuration:Float64}`);
        params.minDuration = minDurationNum;
      }

      // Cursor-based pagination: filter after aggregation
      if (decodedCursor) {
        havingConditions.push(
          `(timestamp < {cursorTs:String} OR (timestamp = {cursorTs:String} AND trace_id < {cursorId:String}))`
        );
        params.cursorTs = decodedCursor.ts;
        params.cursorId = decodedCursor.id;
      }

      const havingClause = havingConditions.length > 0
        ? `HAVING ${havingConditions.join(' AND ')}`
        : '';

      // Query to get trace summaries with aggregation
      // Root span is the one with empty parent_span_id
      const queryText = `
        SELECT
          trace_id,
          min(timestamp) as timestamp,
          maxIf(service_name, parent_span_id = '') as root_service,
          maxIf(operation_name, parent_span_id = '') as root_operation,
          max(duration_ms) as duration_ms,
          count() as span_count,
          if(countIf(status_code = 'ERROR') > 0, 'ERROR', 'OK') as status
        FROM spans
        WHERE ${whereClause}
        GROUP BY trace_id
        ${havingClause}
        ORDER BY timestamp DESC, trace_id DESC
        LIMIT {fetchLimit:UInt32}
      `;

      const clickhouse = getClickHouseClient();
      const rows = await clickhouse.query<{
        trace_id: string;
        timestamp: string;
        root_service: string;
        root_operation: string;
        duration_ms: number;
        span_count: number | string;
        status: string;
      }>(queryText, params);

      // Determine if there are more results
      const hasMore = rows.length > limit;
      const results = hasMore ? rows.slice(0, limit) : rows;

      // Build cursor for next page
      let nextCursor: string | null = null;
      if (hasMore && results.length > 0) {
        const lastRow = results[results.length - 1]!;
        nextCursor = encodeCursor(lastRow.timestamp, lastRow.trace_id);
      }

      // Format response
      const data = results.map((row) => ({
        trace_id: row.trace_id,
        root_service: row.root_service || '',
        root_operation: row.root_operation || '',
        duration_ms: typeof row.duration_ms === 'string' ? parseFloat(row.duration_ms as unknown as string) : row.duration_ms,
        span_count: typeof row.span_count === 'string' ? parseInt(row.span_count as unknown as string, 10) : row.span_count,
        status: row.status,
        timestamp: row.timestamp,
      }));

      return reply.status(200).send({
        data,
        pagination: {
          cursor: nextCursor,
          hasMore,
        },
      });
    }
  );

  /**
   * GET /v1/traces/:traceId
   * Returns all spans for a specific trace sorted by start time ascending.
   * Max 10,000 spans. Returns 404 if trace not found within tenant's data.
   */
  app.get<{ Params: TraceDetailParams }>(
    '/v1/traces/:traceId',
    { preHandler: authMiddleware },
    async (request, reply) => {
      const { traceId } = request.params;
      const { tenantId } = request.tenantContext;

      const clickhouse = getClickHouseClient();

      // Query all spans for this trace, scoped to tenant
      const queryText = `
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
      `;

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
        trace_id: string;
        span_id: string;
        parent_span_id: string;
        operation_name: string;
        duration_ms: number;
        status_code: string;
        status_message: string;
        kind: string;
      }>(queryText, { tenantId, traceId });

      // Return 404 if no spans found for this trace
      if (rows.length === 0) {
        return reply.status(404).send({
          error: {
            code: 'NOT_FOUND',
            message: `Trace with id '${traceId}' not found`,
          },
        });
      }

      // Parse JSON fields and format response
      const data = rows.map((row) => ({
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
        duration_ms: typeof row.duration_ms === 'string' ? parseFloat(row.duration_ms as unknown as string) : row.duration_ms,
        status_code: row.status_code,
        status_message: row.status_message,
        kind: row.kind,
      }));

      return reply.status(200).send({ data });
    }
  );
}

/**
 * Safely parses a JSON string field, returning an empty object on failure.
 */
function parseJsonField(value: string): Record<string, string> {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}
