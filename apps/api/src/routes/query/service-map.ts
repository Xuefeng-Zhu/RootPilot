import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../../middleware/auth.js';
import { query as pgQuery } from '../../db/postgres.js';
import type { ServiceMapResponse } from '@rootpilot/shared';
import {
  mapServiceMapEdge,
  mapServiceMapNode,
  type ServiceDependencyRow,
  type ServiceSummaryRow,
} from './correlation-utils.js';

interface ServiceMapQuery {
  environment?: string;
  from?: string;
  to?: string;
}

export async function serviceMapQueryRoute(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: ServiceMapQuery }>(
    '/v1/service-map',
    { preHandler: authMiddleware },
    async (request, reply) => {
      const { tenantId, projectId } = request.tenantContext;
      const environment = request.query.environment ?? null;
      const from = request.query.from ?? null;
      const to = request.query.to ?? null;

      const [nodesResult, edgesResult] = await Promise.all([
        pgQuery<ServiceSummaryRow>(
          `
            SELECT *
            FROM service_summaries
            WHERE tenant_id = $1
              AND project_id = $2
              AND ($3::text IS NULL OR environment = $3)
              AND ($4::timestamptz IS NULL OR last_seen_at >= $4)
              AND ($5::timestamptz IS NULL OR last_seen_at <= $5)
            ORDER BY service_name ASC
          `,
          [tenantId, projectId, environment, from, to],
        ),
        pgQuery<ServiceDependencyRow>(
          `
            SELECT *
            FROM service_dependencies
            WHERE tenant_id = $1
              AND project_id = $2
              AND ($3::text IS NULL OR environment = $3)
              AND ($4::timestamptz IS NULL OR last_seen_at >= $4)
              AND ($5::timestamptz IS NULL OR last_seen_at <= $5)
            ORDER BY call_count DESC, p95_duration_ms DESC
          `,
          [tenantId, projectId, environment, from, to],
        ),
      ]);

      const response: ServiceMapResponse = {
        nodes: nodesResult.rows.map(mapServiceMapNode),
        edges: edgesResult.rows.map(mapServiceMapEdge),
      };

      return reply.status(200).send(response);
    },
  );
}
