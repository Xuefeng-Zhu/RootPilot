import Fastify, { FastifyInstance } from 'fastify';
import type { TenantContext } from './middleware/auth.js';
import { metricsIngestRoute } from './routes/ingest/metrics.js';
import { deploymentIngestRoutes } from './routes/ingest/deployments.js';
import { logIngestionRoute } from './routes/ingest/logs.js';
import traceIngestRoute from './routes/ingest/traces.js';
import { servicesQueryRoute } from './routes/query/services.js';
import { deploymentsQueryRoute } from './routes/query/deployments.js';
import { traceQueryRoutes } from './routes/query/traces.js';
import { metricsQueryRoute } from './routes/query/metrics.js';
import { logQueryRoute } from './routes/query/logs.js';

export interface BuildAppOptions {
  logger?: boolean;
}

/**
 * Fastify application factory.
 * Creates and configures the Fastify instance with body limit,
 * JSON schema validation, and route registration.
 * Exported for testing via inject().
 */
export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? true,
    bodyLimit: 5 * 1024 * 1024, // 5 MB
    ajv: {
      customOptions: {
        removeAdditional: false,
        coerceTypes: false,
        allErrors: true,
      },
    },
  });

  // Decorate request with tenantContext so the auth middleware can attach it
  app.decorateRequest('tenantContext', null as unknown as TenantContext);

  // Health check endpoint for Docker health checks
  app.get('/health', async (_request, _reply) => {
    return { status: 'ok' };
  });

  // Register ingestion routes
  await app.register(logIngestionRoute);
  await app.register(traceIngestRoute);
  await app.register(metricsIngestRoute);
  await app.register(deploymentIngestRoutes);

  // Register query routes
  await app.register(logQueryRoute);
  await app.register(traceQueryRoutes);
  await app.register(metricsQueryRoute);
  await app.register(servicesQueryRoute);
  await app.register(deploymentsQueryRoute);

  return app;
}
