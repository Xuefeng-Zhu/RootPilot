import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { getClickHouseClient } from '../../db/clickhouse.js';
import { authMiddleware } from '../../middleware/auth.js';
import type { DeploymentEventRequest } from '@rootpilot/shared';

/**
 * Validates that a string is a valid ISO 8601 timestamp.
 */
function isValidISO8601(value: string): boolean {
  const date = new Date(value);
  return !isNaN(date.getTime());
}

/**
 * Registers the POST /v1/events/deployments route.
 * Accepts RootPilot custom JSON format (not OTLP).
 */
export async function deploymentIngestRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/v1/events/deployments',
    { preHandler: authMiddleware },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as Record<string, unknown> | null | undefined;

      // Validate body is an object
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_PAYLOAD',
            message: 'Request body must be a valid JSON object with required fields: service_name, environment, version',
          },
        });
      }

      const payload = body as Partial<DeploymentEventRequest>;

      // Validate required fields
      const missingFields: string[] = [];

      if (!payload.service_name || typeof payload.service_name !== 'string' || payload.service_name.trim() === '') {
        missingFields.push('service_name');
      }

      if (!payload.environment || typeof payload.environment !== 'string' || payload.environment.trim() === '') {
        missingFields.push('environment');
      }

      if (!payload.version || typeof payload.version !== 'string' || payload.version.trim() === '') {
        missingFields.push('version');
      }

      if (missingFields.length > 0) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_PAYLOAD',
            message: `Missing or invalid required fields: ${missingFields.join(', ')}`,
          },
        });
      }

      // Validate timestamp if provided
      if (payload.timestamp !== undefined && payload.timestamp !== null) {
        if (typeof payload.timestamp !== 'string' || !isValidISO8601(payload.timestamp)) {
          return reply.status(400).send({
            error: {
              code: 'INVALID_PAYLOAD',
              message: 'Invalid timestamp: must be a valid ISO 8601 string',
            },
          });
        }
      }

      // Build the deployment event record
      const { tenantId, projectId } = request.tenantContext;
      const now = new Date().toISOString();

      const deploymentEvent = {
        deployment_id: payload.deployment_id || uuidv4(),
        tenant_id: tenantId,
        project_id: projectId,
        timestamp: payload.timestamp || now,
        service_name: payload.service_name!,
        environment: payload.environment!,
        version: payload.version!,
        git_sha: payload.git_sha || '',
        deployed_by: payload.deployed_by || '',
        provider: payload.provider || '',
        metadata: JSON.stringify(payload.metadata || {}),
      };

      // Insert into ClickHouse
      const clickhouse = getClickHouseClient();
      await clickhouse.batchInsert('deployment_events', [deploymentEvent]);

      return reply.status(202).send({ status: 'accepted' });
    }
  );
}
