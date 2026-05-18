import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../../middleware/auth.js';
import { getClickHouseClient } from '../../db/clickhouse.js';
import { query as pgQuery } from '../../db/postgres.js';
import type {
  ServiceEntry,
  ServiceListResponse,
  ServiceSummary,
  TimelineEvent,
  TimelineResponse,
} from '@rootpilot/shared';
import {
  mapErrorGroup,
  mapServiceDependency,
  mapServiceSummary,
  timelineSort,
  toNumber,
  type ErrorGroupRow,
  type ServiceDependencyRow,
  type ServiceSummaryRow,
} from './correlation-utils.js';

interface ServicesQuerystring {
  environment?: string;
}

interface ServiceParams {
  serviceName: string;
}

/**
 * Fastify plugin that registers service catalog and service detail routes.
 *
 * Phase 2 reads deterministic service summaries from Postgres. If the graph
 * refresh job has not been run yet, GET /v1/services falls back to the original
 * live ClickHouse aggregation so Phase 1 local development still feels useful.
 */
export async function servicesQueryRoute(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: ServicesQuerystring }>(
    '/v1/services',
    { preHandler: authMiddleware },
    async (request, reply) => {
      const { tenantId, projectId } = request.tenantContext;
      const params = request.query;
      const summaries = await queryServiceSummaries(tenantId, projectId, params.environment);

      if (summaries.length > 0) {
        return reply.status(200).send({ data: summaries });
      }

      const fallback = await queryLiveServices(tenantId, params.environment);
      const response: ServiceListResponse = { data: fallback };
      return reply.status(200).send(response);
    },
  );

  app.get<{ Params: ServiceParams; Querystring: ServicesQuerystring }>(
    '/v1/services/:serviceName',
    { preHandler: authMiddleware },
    async (request, reply) => {
      const { tenantId, projectId } = request.tenantContext;
      const rows = await pgQuery<ServiceSummaryRow>(
        `
          SELECT *
          FROM service_summaries
          WHERE tenant_id = $1
            AND project_id = $2
            AND service_name = $3
            AND ($4::text IS NULL OR environment = $4)
          ORDER BY last_seen_at DESC
          LIMIT 1
        `,
        [tenantId, projectId, request.params.serviceName, request.query.environment ?? null],
      );

      if (rows.rows.length === 0) {
        return reply.status(404).send({
          error: {
            code: 'NOT_FOUND',
            message: `Service '${request.params.serviceName}' was not found`,
          },
        });
      }

      return reply.status(200).send({ data: mapServiceSummary(rows.rows[0]!) });
    },
  );

  app.get<{ Params: ServiceParams; Querystring: ServicesQuerystring }>(
    '/v1/services/:serviceName/dependencies',
    { preHandler: authMiddleware },
    async (request, reply) => {
      const dependencies = await queryServiceDependencies(
        request.tenantContext.tenantId,
        request.tenantContext.projectId,
        request.params.serviceName,
        'all',
        request.query.environment,
      );
      return reply.status(200).send({ data: dependencies });
    },
  );

  app.get<{ Params: ServiceParams; Querystring: ServicesQuerystring }>(
    '/v1/services/:serviceName/upstream',
    { preHandler: authMiddleware },
    async (request, reply) => {
      const dependencies = await queryServiceDependencies(
        request.tenantContext.tenantId,
        request.tenantContext.projectId,
        request.params.serviceName,
        'upstream',
        request.query.environment,
      );
      return reply.status(200).send({ data: dependencies });
    },
  );

  app.get<{ Params: ServiceParams; Querystring: ServicesQuerystring }>(
    '/v1/services/:serviceName/downstream',
    { preHandler: authMiddleware },
    async (request, reply) => {
      const dependencies = await queryServiceDependencies(
        request.tenantContext.tenantId,
        request.tenantContext.projectId,
        request.params.serviceName,
        'downstream',
        request.query.environment,
      );
      return reply.status(200).send({ data: dependencies });
    },
  );

  app.get<{ Params: ServiceParams; Querystring: ServicesQuerystring }>(
    '/v1/services/:serviceName/health',
    { preHandler: authMiddleware },
    async (request, reply) => {
      const summaries = await queryServiceSummaries(
        request.tenantContext.tenantId,
        request.tenantContext.projectId,
        request.query.environment,
        request.params.serviceName,
      );

      if (summaries.length === 0) {
        return reply.status(404).send({
          error: {
            code: 'NOT_FOUND',
            message: `Service '${request.params.serviceName}' was not found`,
          },
        });
      }

      const service = summaries[0]!;
      return reply.status(200).send({
        data: {
          service_name: service.service_name,
          environment: service.environment,
          health_status: service.health_status,
          request_count: service.request_count,
          error_count: service.error_count,
          avg_latency_ms: service.avg_latency_ms,
          p95_latency_ms: service.p95_latency_ms,
          last_seen_at: service.last_seen_at,
        },
      });
    },
  );

  app.get<{ Params: ServiceParams; Querystring: ServicesQuerystring }>(
    '/v1/services/:serviceName/error-groups',
    { preHandler: authMiddleware },
    async (request, reply) => {
      const rows = await pgQuery<ErrorGroupRow>(
        `
          SELECT *
          FROM error_groups
          WHERE tenant_id = $1
            AND project_id = $2
            AND service_name = $3
            AND ($4::text IS NULL OR environment = $4)
          ORDER BY last_seen_at DESC
          LIMIT 100
        `,
        [
          request.tenantContext.tenantId,
          request.tenantContext.projectId,
          request.params.serviceName,
          request.query.environment ?? null,
        ],
      );
      return reply.status(200).send({ data: rows.rows.map(mapErrorGroup) });
    },
  );

  app.get<{ Params: ServiceParams; Querystring: ServicesQuerystring }>(
    '/v1/services/:serviceName/timeline',
    { preHandler: authMiddleware },
    async (request, reply) => {
      const timeline = await buildServiceTimeline(
        request.tenantContext.tenantId,
        request.tenantContext.projectId,
        request.params.serviceName,
        request.query.environment,
      );
      const response: TimelineResponse = { data: timeline };
      return reply.status(200).send(response);
    },
  );

  app.get<{ Params: ServiceParams; Querystring: ServicesQuerystring }>(
    '/v1/services/:serviceName/deployments',
    { preHandler: authMiddleware },
    async (request, reply) => {
      const clickhouse = getClickHouseClient();
      const conditions = [
        'tenant_id = {tenantId:String}',
        'project_id = {projectId:String}',
        'service_name = {serviceName:String}',
      ];
      const queryParams: Record<string, unknown> = {
        tenantId: request.tenantContext.tenantId,
        projectId: request.tenantContext.projectId,
        serviceName: request.params.serviceName,
      };
      if (request.query.environment) {
        conditions.push('environment = {environment:String}');
        queryParams.environment = request.query.environment;
      }
      const rows = await clickhouse.query(
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
          WHERE ${conditions.join(' AND ')}
          ORDER BY timestamp DESC
          LIMIT 100
        `,
        queryParams,
      );
      return reply.status(200).send({ data: rows });
    },
  );

  app.get<{ Params: ServiceParams; Querystring: ServicesQuerystring }>(
    '/v1/services/:serviceName/recent-changes',
    { preHandler: authMiddleware },
    async (request, reply) => {
      const timeline = await buildServiceTimeline(
        request.tenantContext.tenantId,
        request.tenantContext.projectId,
        request.params.serviceName,
        request.query.environment,
      );
      return reply.status(200).send({
        data: timeline.filter(
          (event) => event.type === 'deployment' || event.type === 'new_error_group',
        ),
      });
    },
  );
}

async function queryServiceSummaries(
  tenantId: string,
  projectId: string,
  environment?: string,
  serviceName?: string,
): Promise<ServiceSummary[]> {
  const rows = await pgQuery<ServiceSummaryRow>(
    `
      SELECT *
      FROM service_summaries
      WHERE tenant_id = $1
        AND project_id = $2
        AND ($3::text IS NULL OR environment = $3)
        AND ($4::text IS NULL OR service_name = $4)
      ORDER BY health_status = 'degraded' DESC,
        health_status = 'warning' DESC,
        last_seen_at DESC,
        service_name ASC
    `,
    [tenantId, projectId, environment ?? null, serviceName ?? null],
  );
  return rows.rows.map(mapServiceSummary);
}

async function queryLiveServices(tenantId: string, environment?: string): Promise<ServiceEntry[]> {
  const clickhouse = getClickHouseClient();
  const conditions = ['tenant_id = {tenantId:String}'];
  const queryParams: Record<string, unknown> = { tenantId };
  if (environment) {
    conditions.push('environment = {environment:String}');
    queryParams.environment = environment;
  }
  const where = conditions.join(' AND ');

  const rows = await clickhouse.query<{
    service_name: string;
    environment: string;
    last_seen: string;
    log_count: string | number;
    span_count: string | number;
    metric_count: string | number;
  }>(
    `
      SELECT
        service_name,
        environment,
        max(last_seen) AS last_seen,
        sum(log_count) AS log_count,
        sum(span_count) AS span_count,
        sum(metric_count) AS metric_count
      FROM (
        SELECT service_name, environment, max(timestamp) AS last_seen, count(*) AS log_count, 0 AS span_count, 0 AS metric_count
        FROM logs
        WHERE ${where}
        GROUP BY service_name, environment

        UNION ALL

        SELECT service_name, environment, max(timestamp) AS last_seen, 0 AS log_count, count(*) AS span_count, 0 AS metric_count
        FROM spans
        WHERE ${where}
        GROUP BY service_name, environment

        UNION ALL

        SELECT service_name, environment, max(timestamp) AS last_seen, 0 AS log_count, 0 AS span_count, count(*) AS metric_count
        FROM metrics
        WHERE ${where}
        GROUP BY service_name, environment
      )
      GROUP BY service_name, environment
      ORDER BY last_seen DESC
    `,
    queryParams,
  );

  return rows.map((row) => ({
    service_name: row.service_name,
    environment: row.environment,
    last_seen: row.last_seen,
    log_count: toNumber(row.log_count),
    span_count: toNumber(row.span_count),
    metric_count: toNumber(row.metric_count),
  }));
}

async function queryServiceDependencies(
  tenantId: string,
  projectId: string,
  serviceName: string,
  direction: 'all' | 'upstream' | 'downstream',
  environment?: string,
) {
  const directionCondition =
    direction === 'upstream'
      ? 'target_service = $3'
      : direction === 'downstream'
        ? 'source_service = $3'
        : '(source_service = $3 OR target_service = $3)';
  const rows = await pgQuery<ServiceDependencyRow>(
    `
      SELECT *
      FROM service_dependencies
      WHERE tenant_id = $1
        AND project_id = $2
        AND ${directionCondition}
        AND ($4::text IS NULL OR environment = $4)
      ORDER BY error_count DESC, p95_duration_ms DESC, call_count DESC
    `,
    [tenantId, projectId, serviceName, environment ?? null],
  );
  return rows.rows.map(mapServiceDependency);
}

async function buildServiceTimeline(
  tenantId: string,
  projectId: string,
  serviceName: string,
  environment?: string,
): Promise<TimelineEvent[]> {
  const events: TimelineEvent[] = [];
  const summaries = await queryServiceSummaries(tenantId, projectId, environment, serviceName);
  const summary = summaries[0];
  if (summary) {
    events.push({
      type: 'service_first_seen',
      timestamp: summary.first_seen_at,
      title: `${serviceName} first seen`,
      severity: 'info',
      metadata: { environment: summary.environment },
    });
  }

  const errorGroups = await pgQuery<ErrorGroupRow>(
    `
      SELECT *
      FROM error_groups
      WHERE tenant_id = $1
        AND project_id = $2
        AND service_name = $3
        AND ($4::text IS NULL OR environment = $4)
      ORDER BY first_seen_at DESC
      LIMIT 25
    `,
    [tenantId, projectId, serviceName, environment ?? null],
  );

  for (const group of errorGroups.rows) {
    events.push({
      type: 'new_error_group',
      timestamp: group.first_seen_at,
      title: `New error group: ${group.error_type ?? group.normalized_message}`,
      severity: 'error',
      metadata: { error_group_id: group.id, count: toNumber(group.count) },
    });
  }

  const impacts = await pgQuery<{
    deployment_id: string;
    service_name: string;
    environment: string;
    risk_level: string;
    p95_latency_before_ms: string | number;
    p95_latency_after_ms: string | number;
    error_count_before: string | number;
    error_count_after: string | number;
    calculated_at: string;
  }>(
    `
      SELECT *
      FROM deployment_impacts
      WHERE tenant_id = $1
        AND project_id = $2
        AND service_name = $3
        AND ($4::text IS NULL OR environment = $4)
      ORDER BY calculated_at DESC
      LIMIT 25
    `,
    [tenantId, projectId, serviceName, environment ?? null],
  );

  for (const impact of impacts.rows) {
    if (
      toNumber(impact.p95_latency_after_ms) > toNumber(impact.p95_latency_before_ms) * 1.5 &&
      toNumber(impact.p95_latency_after_ms) >= 200
    ) {
      events.push({
        type: 'latency_spike',
        timestamp: impact.calculated_at,
        title: `p95 latency increased to ${Math.round(toNumber(impact.p95_latency_after_ms))}ms`,
        severity: impact.risk_level === 'high' ? 'error' : 'warning',
        metadata: { deployment_id: impact.deployment_id },
      });
    }
    if (toNumber(impact.error_count_after) > toNumber(impact.error_count_before)) {
      events.push({
        type: 'error_spike',
        timestamp: impact.calculated_at,
        title: `Errors increased from ${toNumber(impact.error_count_before)} to ${toNumber(
          impact.error_count_after,
        )}`,
        severity: impact.risk_level === 'high' ? 'error' : 'warning',
        metadata: { deployment_id: impact.deployment_id },
      });
    }
  }

  const clickhouse = getClickHouseClient();
  const conditions = [
    'tenant_id = {tenantId:String}',
    'project_id = {projectId:String}',
    'service_name = {serviceName:String}',
  ];
  const params: Record<string, unknown> = { tenantId, projectId, serviceName };
  if (environment) {
    conditions.push('environment = {environment:String}');
    params.environment = environment;
  }
  const deployments = await clickhouse.query<{
    deployment_id: string;
    timestamp: string;
    version: string;
    environment: string;
  }>(
    `
      SELECT toString(deployment_id) AS deployment_id, timestamp, version, environment
      FROM deployment_events
      WHERE ${conditions.join(' AND ')}
      ORDER BY timestamp DESC
      LIMIT 25
    `,
    params,
  );

  for (const deployment of deployments) {
    events.push({
      type: 'deployment',
      timestamp: deployment.timestamp,
      title: `${serviceName} deployed ${deployment.version}`,
      severity: 'info',
      metadata: {
        deployment_id: deployment.deployment_id,
        environment: deployment.environment,
      },
    });
  }

  return events.sort(timelineSort).slice(0, 50);
}
