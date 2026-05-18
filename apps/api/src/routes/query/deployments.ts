import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../../middleware/auth.js';
import { getClickHouseClient } from '../../db/clickhouse.js';
import { query as pgQuery } from '../../db/postgres.js';
import type { DeploymentListResponse } from '@rootpilot/shared';
import type { CanonicalDeploymentEvent, DecodedCursor } from '@rootpilot/shared';
import { buildDeploymentImpactResponse, type DeploymentImpactRow } from './correlation-utils.js';

/**
 * Decodes a base64-encoded cursor string into { ts, id }.
 * Returns null if the cursor is invalid.
 */
function decodeCursor(cursor: string): DecodedCursor | null {
  try {
    const decoded = Buffer.from(cursor, 'base64').toString('utf-8');
    const parsed = JSON.parse(decoded);
    if (typeof parsed.ts === 'string' && typeof parsed.id === 'string') {
      return parsed as DecodedCursor;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Encodes a cursor from timestamp and deployment_id.
 */
function encodeCursor(ts: string, id: string): string {
  return Buffer.from(JSON.stringify({ ts, id })).toString('base64');
}

/**
 * Validates an ISO 8601 timestamp string.
 */
function isValidISO8601(value: string): boolean {
  const date = new Date(value);
  return !isNaN(date.getTime());
}

function toClickHouseDateTime(value: string): string {
  return value;
}

function parseUtcDateTime64(paramName: string): string {
  return `parseDateTime64BestEffort({${paramName}:String}, 3, 'UTC')`;
}

interface DeploymentsQuerystring {
  from?: string;
  to?: string;
  service?: string;
  environment?: string;
  limit?: string;
  cursor?: string;
}

interface DeploymentDetailParams {
  deploymentId: string;
}

/**
 * Fastify plugin that registers the GET /v1/deployments route.
 *
 * Returns paginated deployment events scoped to the authenticated tenant.
 * Supports filters: from, to, service, environment.
 * Default limit 50, max 200, cursor-based pagination using (timestamp, deployment_id).
 */
export async function deploymentsQueryRoute(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: DeploymentsQuerystring }>(
    '/v1/deployments',
    { preHandler: authMiddleware },
    async (request, reply) => {
      const { tenantId } = request.tenantContext;
      const { projectId } = request.tenantContext;
      const params = request.query;

      // Parse and validate limit
      let limit = 50;
      if (params.limit !== undefined) {
        const parsedLimit = parseInt(params.limit, 10);
        if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 200) {
          return reply.status(400).send({
            error: {
              code: 'INVALID_PARAMETER',
              message: 'Invalid limit parameter: must be a number between 1 and 200',
            },
          });
        }
        limit = parsedLimit;
      }

      // Validate time range parameters
      if (params.from !== undefined && !isValidISO8601(params.from)) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_PARAMETER',
            message: 'Invalid from parameter: must be a valid ISO 8601 timestamp',
          },
        });
      }

      if (params.to !== undefined && !isValidISO8601(params.to)) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_PARAMETER',
            message: 'Invalid to parameter: must be a valid ISO 8601 timestamp',
          },
        });
      }

      // Validate cursor if provided
      let cursorData: DecodedCursor | null = null;
      if (params.cursor) {
        cursorData = decodeCursor(params.cursor);
        if (!cursorData) {
          return reply.status(400).send({
            error: {
              code: 'INVALID_PARAMETER',
              message: 'Invalid cursor parameter: malformed pagination cursor',
            },
          });
        }
      }

      // Build query
      const conditions: string[] = [
        'tenant_id = {tenantId:String}',
        'project_id = {projectId:String}',
      ];
      const queryParams: Record<string, unknown> = { tenantId, projectId };

      if (params.from) {
        conditions.push(`timestamp >= ${parseUtcDateTime64('from')}`);
        queryParams.from = toClickHouseDateTime(params.from);
      }

      if (params.to) {
        conditions.push(`timestamp <= ${parseUtcDateTime64('to')}`);
        queryParams.to = toClickHouseDateTime(params.to);
      }

      if (params.service) {
        conditions.push('service_name = {service:String}');
        queryParams.service = params.service;
      }

      if (params.environment) {
        conditions.push('environment = {environment:String}');
        queryParams.environment = params.environment;
      }

      // Cursor-based pagination: fetch records older than the cursor
      if (cursorData) {
        conditions.push(
          `(timestamp < ${parseUtcDateTime64('cursorTs')} OR (timestamp = ${parseUtcDateTime64('cursorTs')} AND deployment_id < {cursorId:String}))`,
        );
        queryParams.cursorTs = toClickHouseDateTime(cursorData.ts);
        queryParams.cursorId = cursorData.id;
      }

      const whereClause = conditions.join(' AND ');

      // Fetch limit + 1 to determine hasMore
      const fetchLimit = limit + 1;
      queryParams.fetchLimit = fetchLimit;

      const queryText = `
        SELECT
          deployment_id,
          tenant_id,
          project_id,
          timestamp,
          service_name,
          environment,
          version,
          git_sha,
          deployed_by,
          provider,
          metadata
        FROM deployment_events
        WHERE ${whereClause}
        ORDER BY timestamp DESC, deployment_id DESC
        LIMIT {fetchLimit:UInt32}
      `;

      const clickhouse = getClickHouseClient();
      const rows = await clickhouse.query<{
        deployment_id: string;
        tenant_id: string;
        project_id: string;
        timestamp: string;
        service_name: string;
        environment: string;
        version: string;
        git_sha: string;
        deployed_by: string;
        provider: string;
        metadata: string;
      }>(queryText, queryParams);

      // Determine if there are more results
      const hasMore = rows.length > limit;
      const resultRows = hasMore ? rows.slice(0, limit) : rows;

      // Map rows to canonical deployment events
      const data: CanonicalDeploymentEvent[] = resultRows.map((row) => ({
        deployment_id: row.deployment_id,
        tenant_id: row.tenant_id,
        project_id: row.project_id,
        timestamp: row.timestamp,
        service_name: row.service_name,
        environment: row.environment,
        version: row.version,
        git_sha: row.git_sha,
        deployed_by: row.deployed_by,
        provider: row.provider,
        metadata: parseMetadata(row.metadata),
      }));

      // Build cursor for next page
      let nextCursor: string | null = null;
      if (hasMore && resultRows.length > 0) {
        const lastRow = resultRows[resultRows.length - 1];
        nextCursor = encodeCursor(lastRow.timestamp, lastRow.deployment_id);
      }

      const response: DeploymentListResponse = {
        data,
        pagination: {
          cursor: nextCursor,
          hasMore,
        },
      };

      return reply.status(200).send(response);
    },
  );

  app.get<{ Params: DeploymentDetailParams }>(
    '/v1/deployments/:deploymentId',
    { preHandler: authMiddleware },
    async (request, reply) => {
      const deployment = await findDeployment(
        request.tenantContext.tenantId,
        request.tenantContext.projectId,
        request.params.deploymentId,
      );

      if (!deployment) {
        return reply.status(404).send({
          error: {
            code: 'NOT_FOUND',
            message: `Deployment '${request.params.deploymentId}' was not found`,
          },
        });
      }

      return reply.status(200).send({ data: deployment });
    },
  );

  app.get<{ Params: DeploymentDetailParams }>(
    '/v1/deployments/:deploymentId/impact',
    { preHandler: authMiddleware },
    async (request, reply) => {
      const deployment = await findDeployment(
        request.tenantContext.tenantId,
        request.tenantContext.projectId,
        request.params.deploymentId,
      );

      if (!deployment) {
        return reply.status(404).send({
          error: {
            code: 'NOT_FOUND',
            message: `Deployment '${request.params.deploymentId}' was not found`,
          },
        });
      }

      const impactRows = await pgQuery<DeploymentImpactRow>(
        `
          SELECT *
          FROM deployment_impacts
          WHERE tenant_id = $1
            AND project_id = $2
            AND deployment_id = $3
          LIMIT 1
        `,
        [
          request.tenantContext.tenantId,
          request.tenantContext.projectId,
          request.params.deploymentId,
        ],
      );

      return reply
        .status(200)
        .send(buildDeploymentImpactResponse(deployment, impactRows.rows[0] ?? null));
    },
  );
}

/**
 * Safely parses a metadata JSON string into an object.
 */
function parseMetadata(metadata: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(metadata);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

async function findDeployment(
  tenantId: string,
  projectId: string,
  deploymentId: string,
): Promise<CanonicalDeploymentEvent | null> {
  const clickhouse = getClickHouseClient();
  const rows = await clickhouse.query<{
    deployment_id: string;
    tenant_id: string;
    project_id: string;
    timestamp: string;
    service_name: string;
    environment: string;
    version: string;
    git_sha: string;
    deployed_by: string;
    provider: string;
    metadata: string;
  }>(
    `
      SELECT
        toString(deployment_id) AS deployment_id,
        tenant_id,
        project_id,
        timestamp,
        service_name,
        environment,
        version,
        git_sha,
        deployed_by,
        provider,
        metadata
      FROM deployment_events
      WHERE tenant_id = {tenantId:String}
        AND project_id = {projectId:String}
        AND toString(deployment_id) = {deploymentId:String}
      LIMIT 1
    `,
    { tenantId, projectId, deploymentId },
  );

  const row = rows[0];
  if (!row) return null;

  return {
    deployment_id: row.deployment_id,
    tenant_id: row.tenant_id,
    project_id: row.project_id,
    timestamp: row.timestamp,
    service_name: row.service_name,
    environment: row.environment,
    version: row.version,
    git_sha: row.git_sha,
    deployed_by: row.deployed_by,
    provider: row.provider,
    metadata: parseMetadata(row.metadata),
  };
}
