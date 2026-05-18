import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authMiddleware } from '../../middleware/auth.js';
import { getClickHouseClient } from '../../db/clickhouse.js';
import type { ServiceEntry, ServiceListResponse } from '@rootpilot/shared';

/**
 * Fastify plugin that registers the GET /v1/services route.
 *
 * Aggregates across logs, spans, and metrics tables to return
 * unique (service_name, environment) pairs with counts and last_seen.
 * Always scoped to the authenticated tenant.
 */
export async function servicesQueryRoute(app: FastifyInstance): Promise<void> {
  app.get(
    '/v1/services',
    { preHandler: authMiddleware },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { tenantId } = request.tenantContext;
      const clickhouse = getClickHouseClient();

      // Aggregate service data across logs, spans, and metrics tables using UNION ALL
      const queryText = `
        SELECT
          service_name,
          environment,
          max(last_seen) AS last_seen,
          sum(log_count) AS log_count,
          sum(span_count) AS span_count,
          sum(metric_count) AS metric_count
        FROM (
          SELECT
            service_name,
            environment,
            max(timestamp) AS last_seen,
            count(*) AS log_count,
            0 AS span_count,
            0 AS metric_count
          FROM logs
          WHERE tenant_id = {tenantId:String}
          GROUP BY service_name, environment

          UNION ALL

          SELECT
            service_name,
            environment,
            max(timestamp) AS last_seen,
            0 AS log_count,
            count(*) AS span_count,
            0 AS metric_count
          FROM spans
          WHERE tenant_id = {tenantId:String}
          GROUP BY service_name, environment

          UNION ALL

          SELECT
            service_name,
            environment,
            max(timestamp) AS last_seen,
            0 AS log_count,
            0 AS span_count,
            count(*) AS metric_count
          FROM metrics
          WHERE tenant_id = {tenantId:String}
          GROUP BY service_name, environment
        )
        GROUP BY service_name, environment
        ORDER BY last_seen DESC
      `;

      const rows = await clickhouse.query<{
        service_name: string;
        environment: string;
        last_seen: string;
        log_count: string | number;
        span_count: string | number;
        metric_count: string | number;
      }>(queryText, { tenantId });

      const data: ServiceEntry[] = rows.map((row) => ({
        service_name: row.service_name,
        environment: row.environment,
        last_seen: row.last_seen,
        log_count: Number(row.log_count),
        span_count: Number(row.span_count),
        metric_count: Number(row.metric_count),
      }));

      const response: ServiceListResponse = { data };
      return reply.status(200).send(response);
    }
  );
}
