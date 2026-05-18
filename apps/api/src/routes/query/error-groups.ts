import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../../middleware/auth.js';
import { query as pgQuery } from '../../db/postgres.js';
import type { ErrorGroupDetailResponse, ErrorGroupListResponse } from '@rootpilot/shared';
import { mapErrorGroup, type ErrorGroupRow } from './correlation-utils.js';

interface ErrorGroupsQuery {
  from?: string;
  to?: string;
  service?: string;
  environment?: string;
  severity?: string;
  is_new?: string;
  limit?: string;
}

interface ErrorGroupParams {
  id: string;
}

export async function errorGroupsQueryRoute(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: ErrorGroupsQuery }>(
    '/v1/error-groups',
    { preHandler: authMiddleware },
    async (request, reply) => {
      const limit = parseLimit(request.query.limit);
      if (limit instanceof Error) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_PARAMETER',
            message: limit.message,
          },
        });
      }

      const isNew =
        request.query.is_new === undefined ? null : request.query.is_new.toLowerCase() === 'true';
      const rows = await pgQuery<ErrorGroupRow>(
        `
          SELECT *
          FROM error_groups
          WHERE tenant_id = $1
            AND project_id = $2
            AND ($3::text IS NULL OR service_name = $3)
            AND ($4::text IS NULL OR environment = $4)
            AND ($5::text IS NULL OR severity = $5)
            AND ($6::boolean IS NULL OR is_new = $6)
            AND ($7::timestamptz IS NULL OR last_seen_at >= $7)
            AND ($8::timestamptz IS NULL OR first_seen_at <= $8)
          ORDER BY last_seen_at DESC, count DESC
          LIMIT $9
        `,
        [
          request.tenantContext.tenantId,
          request.tenantContext.projectId,
          request.query.service ?? null,
          request.query.environment ?? null,
          request.query.severity ?? null,
          isNew,
          request.query.from ?? null,
          request.query.to ?? null,
          limit,
        ],
      );

      const response: ErrorGroupListResponse = { data: rows.rows.map(mapErrorGroup) };
      return reply.status(200).send(response);
    },
  );

  app.get<{ Params: ErrorGroupParams }>(
    '/v1/error-groups/:id',
    { preHandler: authMiddleware },
    async (request, reply) => {
      const rows = await pgQuery<ErrorGroupRow>(
        `
          SELECT *
          FROM error_groups
          WHERE tenant_id = $1
            AND project_id = $2
            AND id = $3
          LIMIT 1
        `,
        [request.tenantContext.tenantId, request.tenantContext.projectId, request.params.id],
      );

      if (rows.rows.length === 0) {
        return reply.status(404).send({
          error: {
            code: 'NOT_FOUND',
            message: `Error group '${request.params.id}' was not found`,
          },
        });
      }

      const response: ErrorGroupDetailResponse = { data: mapErrorGroup(rows.rows[0]!) };
      return reply.status(200).send(response);
    },
  );
}

function parseLimit(value: string | undefined): number | Error {
  if (value === undefined) return 100;

  const limit = Number.parseInt(value, 10);
  if (!Number.isFinite(limit) || limit < 1 || limit > 500) {
    return new Error('Invalid limit parameter: must be a number between 1 and 500');
  }

  return limit;
}
