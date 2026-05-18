import { FastifyInstance } from 'fastify';
import { authMiddleware } from '../../middleware/auth.js';
import { normalizeLogRecords, OTLPResourceLogs } from '../../normalizers/logs.js';
import { getClickHouseClient } from '../../db/clickhouse.js';

/**
 * Expected request body shape for log ingestion.
 */
interface LogIngestionBody {
  resourceLogs: OTLPResourceLogs[];
}

/**
 * Counts the total number of logRecords across all resourceLogs/scopeLogs.
 */
function countLogRecords(resourceLogs: OTLPResourceLogs[]): number {
  let count = 0;
  for (const resourceLog of resourceLogs) {
    const scopeLogs = resourceLog.scopeLogs || [];
    for (const scopeLog of scopeLogs) {
      count += (scopeLog.logRecords || []).length;
    }
  }
  return count;
}

/**
 * Fastify plugin that registers the POST /v1/ingest/logs route.
 *
 * Validates payload structure, enforces record limits, normalizes
 * log records, and batch inserts into ClickHouse.
 */
export async function logIngestionRoute(app: FastifyInstance): Promise<void> {
  app.post<{ Body: LogIngestionBody }>(
    '/v1/ingest/logs',
    { preHandler: authMiddleware },
    async (request, reply) => {
      const body = request.body;

      // Validate that body is an object with resourceLogs array
      if (!body || typeof body !== 'object' || !Array.isArray(body.resourceLogs)) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_PAYLOAD',
            message: 'Invalid payload: request body must contain a resourceLogs array',
          },
        });
      }

      // Validate that at least one logRecord exists
      const totalRecords = countLogRecords(body.resourceLogs);
      if (totalRecords === 0) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_PAYLOAD',
            message: 'Invalid payload: at least one logRecord must be present in the request',
          },
        });
      }

      // Enforce max 1000 logRecords per request
      if (totalRecords > 1000) {
        return reply.status(400).send({
          error: {
            code: 'RECORD_LIMIT_EXCEEDED',
            message: `Record limit exceeded: request contains ${totalRecords} logRecords, maximum allowed is 1000`,
          },
        });
      }

      // Normalize log records to canonical model
      const { tenantId, projectId } = request.tenantContext;
      const canonicalLogs = normalizeLogRecords(body.resourceLogs, tenantId, projectId);

      // Batch insert into ClickHouse logs table
      const clickhouse = getClickHouseClient();
      await clickhouse.batchInsert(
        'logs',
        canonicalLogs.map((log) => ({
          ...log,
          resource_attributes: JSON.stringify(log.resource_attributes),
          attributes: JSON.stringify(log.attributes),
        }))
      );

      return reply.status(202).send();
    }
  );
}
