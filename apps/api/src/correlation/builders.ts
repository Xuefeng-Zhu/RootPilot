import type { IClickHouseClient } from '../db/clickhouse.js';
import { getClickHouseClient } from '../db/clickhouse.js';
import { query as pgQuery } from '../db/postgres.js';
import { createErrorFingerprint, safeJson, stringAttribute } from './fingerprint.js';
import { calculateHealthStatus, riskLevelFromImpact } from './health.js';
import type { TimeRange } from './time.js';
import { toIso } from './time.js';

export interface BuildTarget {
  tenantId: string;
  projectId: string;
}

export interface BuildOptions {
  range: TimeRange;
  tenantId?: string;
  projectId?: string;
  environment?: string;
  clickhouse?: IClickHouseClient;
}

export interface BuildResult {
  serviceSummaries: number;
  serviceDependencies: number;
  errorGroups: number;
  deploymentImpacts: number;
}

type SignalName = 'logs' | 'traces' | 'metrics' | 'deployments';

interface MutableServiceAggregate {
  serviceName: string;
  environment: string;
  firstSeenAt: string;
  lastSeenAt: string;
  sourceSignals: Record<SignalName, boolean> & {
    log_count: number;
    span_count: number;
    metric_count: number;
    deployment_count: number;
  };
  latestVersion: string | null;
  latestDeploymentId: string | null;
  requestCount: number;
  errorCount: number;
  warningCount: number;
  logCount: number;
  spanCount: number;
  metricCount: number;
  deploymentCount: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
}

interface LogAggregateRow {
  service_name: string;
  environment: string;
  first_seen_at: string;
  last_seen_at: string;
  log_count: string | number;
  error_count: string | number;
  warning_count: string | number;
}

interface SpanAggregateRow {
  service_name: string;
  environment: string;
  first_seen_at: string;
  last_seen_at: string;
  span_count: string | number;
  request_count: string | number;
  error_count: string | number;
  avg_latency_ms: string | number;
  p95_latency_ms: string | number;
}

interface MetricAggregateRow {
  service_name: string;
  environment: string;
  first_seen_at: string;
  last_seen_at: string;
  metric_count: string | number;
}

interface DeploymentAggregateRow {
  service_name: string;
  environment: string;
  first_seen_at: string;
  last_seen_at: string;
  deployment_count: string | number;
  latest_version: string;
  latest_deployment_id: string;
}

interface DependencyRow {
  environment: string;
  source_service: string;
  target_service: string;
  operation_name: string;
  call_count: string | number;
  error_count: string | number;
  avg_duration_ms: string | number;
  p95_duration_ms: string | number;
  last_seen_at: string;
  example_trace_id: string;
}

interface ErrorSourceRow {
  source_kind: 'log' | 'span';
  timestamp: string;
  service_name: string;
  environment: string;
  message: string;
  operation_name: string;
  trace_id: string;
  attributes: string;
}

interface DeploymentRow {
  deployment_id: string;
  timestamp: string;
  service_name: string;
  environment: string;
  version: string;
  git_sha: string;
  deployed_by: string;
  provider: string;
  metadata: string;
}

interface TelemetryWindowRow {
  span_error_count: string | number;
  p95_latency_ms: string | number;
  example_trace_ids: string[];
}

interface LogErrorCountRow {
  log_error_count: string | number;
}

export async function resolveBuildTargets(options: BuildOptions): Promise<BuildTarget[]> {
  if (options.tenantId && options.projectId) {
    return [{ tenantId: options.tenantId, projectId: options.projectId }];
  }

  const result = await pgQuery<{ tenant_id: string; project_id: string }>(
    `
      SELECT tenants.id AS tenant_id, projects.id AS project_id
      FROM tenants
      JOIN projects ON projects.tenant_id = tenants.id
      WHERE ($1::uuid IS NULL OR tenants.id = $1::uuid)
        AND ($2::uuid IS NULL OR projects.id = $2::uuid)
      ORDER BY tenants.created_at ASC, projects.created_at ASC
    `,
    [options.tenantId ?? null, options.projectId ?? null],
  );

  return result.rows.map((row) => ({
    tenantId: row.tenant_id,
    projectId: row.project_id,
  }));
}

export async function buildServiceSummaries(options: BuildOptions): Promise<number> {
  const clickhouse = options.clickhouse ?? getClickHouseClient();
  const targets = await resolveBuildTargets(options);
  let count = 0;

  for (const target of targets) {
    const aggregates = new Map<string, MutableServiceAggregate>();
    const params = clickhouseParams(target, options);
    const where = clickhouseWhere('timestamp', options.environment);

    const [logs, spans, metrics, deployments] = await Promise.all([
      clickhouse.query<LogAggregateRow>(
        `
          SELECT
            service_name,
            environment,
            min(timestamp) AS first_seen_at,
            max(timestamp) AS last_seen_at,
            count() AS log_count,
            countIf(severity IN ('ERROR', 'FATAL')) AS error_count,
            countIf(severity = 'WARN') AS warning_count
          FROM logs
          WHERE ${where}
          GROUP BY service_name, environment
        `,
        params,
      ),
      clickhouse.query<SpanAggregateRow>(
        `
          SELECT
            service_name,
            environment,
            min(timestamp) AS first_seen_at,
            max(timestamp) AS last_seen_at,
            count() AS span_count,
            countIf(kind = 'SERVER') AS request_count,
            countIf(status_code = 'ERROR') AS error_count,
            avg(duration_ms) AS avg_latency_ms,
            quantile(0.95)(duration_ms) AS p95_latency_ms
          FROM spans
          WHERE ${where}
          GROUP BY service_name, environment
        `,
        params,
      ),
      clickhouse.query<MetricAggregateRow>(
        `
          SELECT
            service_name,
            environment,
            min(timestamp) AS first_seen_at,
            max(timestamp) AS last_seen_at,
            count() AS metric_count
          FROM metrics
          WHERE ${where}
          GROUP BY service_name, environment
        `,
        params,
      ),
      clickhouse.query<DeploymentAggregateRow>(
        `
          SELECT
            service_name,
            environment,
            min(timestamp) AS first_seen_at,
            max(timestamp) AS last_seen_at,
            count() AS deployment_count,
            argMax(version, timestamp) AS latest_version,
            toString(argMax(deployment_id, timestamp)) AS latest_deployment_id
          FROM deployment_events
          WHERE ${where}
          GROUP BY service_name, environment
        `,
        params,
      ),
    ]);

    for (const row of logs) {
      const aggregate = serviceAggregate(aggregates, row.service_name, row.environment);
      markSeen(aggregate, row.first_seen_at, row.last_seen_at);
      aggregate.sourceSignals.logs = true;
      aggregate.logCount = toNumber(row.log_count);
      aggregate.errorCount += toNumber(row.error_count);
      aggregate.warningCount += toNumber(row.warning_count);
    }

    for (const row of spans) {
      const aggregate = serviceAggregate(aggregates, row.service_name, row.environment);
      markSeen(aggregate, row.first_seen_at, row.last_seen_at);
      aggregate.sourceSignals.traces = true;
      aggregate.spanCount = toNumber(row.span_count);
      aggregate.requestCount = toNumber(row.request_count) || toNumber(row.span_count);
      aggregate.errorCount += toNumber(row.error_count);
      aggregate.avgLatencyMs = toNumber(row.avg_latency_ms);
      aggregate.p95LatencyMs = toNumber(row.p95_latency_ms);
    }

    for (const row of metrics) {
      const aggregate = serviceAggregate(aggregates, row.service_name, row.environment);
      markSeen(aggregate, row.first_seen_at, row.last_seen_at);
      aggregate.sourceSignals.metrics = true;
      aggregate.metricCount = toNumber(row.metric_count);
    }

    for (const row of deployments) {
      const aggregate = serviceAggregate(aggregates, row.service_name, row.environment);
      markSeen(aggregate, row.first_seen_at, row.last_seen_at);
      aggregate.sourceSignals.deployments = true;
      aggregate.deploymentCount = toNumber(row.deployment_count);
      aggregate.latestVersion = row.latest_version || null;
      aggregate.latestDeploymentId = row.latest_deployment_id || null;
    }

    for (const aggregate of aggregates.values()) {
      aggregate.sourceSignals.log_count = aggregate.logCount;
      aggregate.sourceSignals.span_count = aggregate.spanCount;
      aggregate.sourceSignals.metric_count = aggregate.metricCount;
      aggregate.sourceSignals.deployment_count = aggregate.deploymentCount;
      const healthStatus = calculateHealthStatus({
        requestCount: aggregate.requestCount,
        errorCount: aggregate.errorCount,
        warningCount: aggregate.warningCount,
        p95LatencyMs: aggregate.p95LatencyMs,
        lastSeenAt: aggregate.lastSeenAt,
        now: options.range.to,
      });

      await pgQuery(
        `
          INSERT INTO service_summaries (
            tenant_id,
            project_id,
            service_name,
            environment,
            first_seen_at,
            last_seen_at,
            source_signals,
            latest_version,
            latest_deployment_id,
            request_count,
            error_count,
            log_count,
            span_count,
            metric_count,
            deployment_count,
            avg_latency_ms,
            p95_latency_ms,
            health_status,
            updated_at
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12, $13,
            $14, $15, $16, $17, $18, NOW()
          )
          ON CONFLICT (tenant_id, project_id, service_name, environment)
          DO UPDATE SET
            first_seen_at = LEAST(service_summaries.first_seen_at, EXCLUDED.first_seen_at),
            last_seen_at = EXCLUDED.last_seen_at,
            source_signals = EXCLUDED.source_signals,
            latest_version = COALESCE(EXCLUDED.latest_version, service_summaries.latest_version),
            latest_deployment_id = COALESCE(
              EXCLUDED.latest_deployment_id,
              service_summaries.latest_deployment_id
            ),
            request_count = EXCLUDED.request_count,
            error_count = EXCLUDED.error_count,
            log_count = EXCLUDED.log_count,
            span_count = EXCLUDED.span_count,
            metric_count = EXCLUDED.metric_count,
            deployment_count = EXCLUDED.deployment_count,
            avg_latency_ms = EXCLUDED.avg_latency_ms,
            p95_latency_ms = EXCLUDED.p95_latency_ms,
            health_status = EXCLUDED.health_status,
            updated_at = NOW()
        `,
        [
          target.tenantId,
          target.projectId,
          aggregate.serviceName,
          aggregate.environment,
          aggregate.firstSeenAt,
          aggregate.lastSeenAt,
          JSON.stringify(aggregate.sourceSignals),
          aggregate.latestVersion,
          aggregate.latestDeploymentId,
          aggregate.requestCount,
          aggregate.errorCount,
          aggregate.logCount,
          aggregate.spanCount,
          aggregate.metricCount,
          aggregate.deploymentCount,
          aggregate.avgLatencyMs,
          aggregate.p95LatencyMs,
          healthStatus,
        ],
      );
      count += 1;
    }
  }

  return count;
}

export async function buildServiceDependencies(options: BuildOptions): Promise<number> {
  const clickhouse = options.clickhouse ?? getClickHouseClient();
  const targets = await resolveBuildTargets(options);
  let count = 0;

  for (const target of targets) {
    const params = clickhouseParams(target, options);
    const envCondition = options.environment ? 'AND child.environment = {environment:String}' : '';
    const rows = await clickhouse.query<DependencyRow>(
      `
        SELECT
          child.environment AS environment,
          parent.service_name AS source_service,
          child.service_name AS target_service,
          child.operation_name AS operation_name,
          count() AS call_count,
          countIf(child.status_code = 'ERROR') AS error_count,
          avg(child.duration_ms) AS avg_duration_ms,
          quantile(0.95)(child.duration_ms) AS p95_duration_ms,
          max(child.timestamp) AS last_seen_at,
          anyLast(child.trace_id) AS example_trace_id
        FROM spans AS child
        INNER JOIN spans AS parent
          ON child.tenant_id = parent.tenant_id
          AND child.project_id = parent.project_id
          AND child.trace_id = parent.trace_id
          AND child.parent_span_id = parent.span_id
        WHERE child.tenant_id = {tenantId:String}
          AND child.project_id = {projectId:String}
          AND child.timestamp >= parseDateTime64BestEffort({from:String}, 3, 'UTC')
          AND child.timestamp <= parseDateTime64BestEffort({to:String}, 3, 'UTC')
          AND child.parent_span_id != ''
          AND parent.service_name != child.service_name
          ${envCondition}
        GROUP BY child.environment, source_service, target_service, operation_name
      `,
      params,
    );

    for (const row of rows) {
      await pgQuery(
        `
          INSERT INTO service_dependencies (
            tenant_id,
            project_id,
            environment,
            source_service,
            target_service,
            operation_name,
            call_count,
            error_count,
            avg_duration_ms,
            p95_duration_ms,
            last_seen_at,
            example_trace_id,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
          ON CONFLICT (
            tenant_id,
            project_id,
            environment,
            source_service,
            target_service,
            operation_name
          )
          DO UPDATE SET
            call_count = EXCLUDED.call_count,
            error_count = EXCLUDED.error_count,
            avg_duration_ms = EXCLUDED.avg_duration_ms,
            p95_duration_ms = EXCLUDED.p95_duration_ms,
            last_seen_at = EXCLUDED.last_seen_at,
            example_trace_id = EXCLUDED.example_trace_id,
            updated_at = NOW()
        `,
        [
          target.tenantId,
          target.projectId,
          row.environment,
          row.source_service,
          row.target_service,
          row.operation_name,
          toNumber(row.call_count),
          toNumber(row.error_count),
          toNumber(row.avg_duration_ms),
          toNumber(row.p95_duration_ms),
          row.last_seen_at,
          row.example_trace_id || null,
        ],
      );
      count += 1;
    }
  }

  await updateDependencyCounts(options);
  return count;
}

export async function buildErrorGroups(options: BuildOptions): Promise<number> {
  const clickhouse = options.clickhouse ?? getClickHouseClient();
  const targets = await resolveBuildTargets(options);
  let count = 0;

  for (const target of targets) {
    const params = clickhouseParams(target, options);
    const where = clickhouseWhere('timestamp', options.environment);
    const rows = await clickhouse.query<ErrorSourceRow>(
      `
        SELECT
          'log' AS source_kind,
          timestamp,
          service_name,
          environment,
          message,
          '' AS operation_name,
          trace_id,
          attributes
        FROM logs
        WHERE ${where}
          AND severity IN ('ERROR', 'FATAL')

        UNION ALL

        SELECT
          'span' AS source_kind,
          timestamp,
          service_name,
          environment,
          if(status_message = '', operation_name, status_message) AS message,
          operation_name,
          trace_id,
          attributes
        FROM spans
        WHERE ${where}
          AND status_code = 'ERROR'
      `,
      params,
    );

    const groups = new Map<
      string,
      {
        id: string;
        fingerprint: string;
        serviceName: string;
        environment: string;
        errorType: string | null;
        normalizedMessage: string;
        exampleMessage: string;
        firstSeenAt: string;
        lastSeenAt: string;
        count: number;
        affectedTraceIds: Set<string>;
        exampleTraceId: string | null;
        severity: string;
      }
    >();

    for (const row of rows) {
      const attributes = safeJson(row.attributes);
      const route = stringAttribute(attributes, ['http.route', 'route']);
      const errorType =
        stringAttribute(attributes, ['error.type', 'exception.type']) ??
        inferErrorType(row.message);
      const fingerprint = createErrorFingerprint({
        tenantId: target.tenantId,
        projectId: target.projectId,
        serviceName: row.service_name,
        route,
        operationName: row.operation_name,
        errorType,
        message: row.message,
      });
      const key = `${row.service_name}:${row.environment}:${fingerprint.fingerprint}`;
      const group = groups.get(key);

      if (!group) {
        groups.set(key, {
          id: fingerprint.id,
          fingerprint: fingerprint.fingerprint,
          serviceName: row.service_name,
          environment: row.environment,
          errorType: errorType ?? null,
          normalizedMessage: fingerprint.normalizedMessage,
          exampleMessage: row.message,
          firstSeenAt: row.timestamp,
          lastSeenAt: row.timestamp,
          count: 1,
          affectedTraceIds: new Set(row.trace_id ? [row.trace_id] : []),
          exampleTraceId: row.trace_id || null,
          severity: 'error',
        });
        continue;
      }

      group.count += 1;
      if (new Date(row.timestamp) < new Date(group.firstSeenAt)) group.firstSeenAt = row.timestamp;
      if (new Date(row.timestamp) > new Date(group.lastSeenAt)) group.lastSeenAt = row.timestamp;
      if (row.trace_id) group.affectedTraceIds.add(row.trace_id);
      if (!group.exampleTraceId && row.trace_id) group.exampleTraceId = row.trace_id;
    }

    for (const group of groups.values()) {
      const isNew = new Date(group.firstSeenAt).getTime() >= options.range.from.getTime();
      await pgQuery(
        `
          INSERT INTO error_groups (
            id,
            tenant_id,
            project_id,
            service_name,
            environment,
            fingerprint,
            error_type,
            normalized_message,
            example_message,
            first_seen_at,
            last_seen_at,
            count,
            affected_traces_count,
            example_trace_id,
            severity,
            is_new,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW())
          ON CONFLICT (tenant_id, project_id, service_name, environment, fingerprint)
          DO UPDATE SET
            first_seen_at = LEAST(error_groups.first_seen_at, EXCLUDED.first_seen_at),
            last_seen_at = GREATEST(error_groups.last_seen_at, EXCLUDED.last_seen_at),
            count = EXCLUDED.count,
            affected_traces_count = EXCLUDED.affected_traces_count,
            example_trace_id = COALESCE(EXCLUDED.example_trace_id, error_groups.example_trace_id),
            example_message = EXCLUDED.example_message,
            normalized_message = EXCLUDED.normalized_message,
            error_type = COALESCE(EXCLUDED.error_type, error_groups.error_type),
            severity = EXCLUDED.severity,
            is_new = LEAST(error_groups.first_seen_at, EXCLUDED.first_seen_at) >= $17,
            updated_at = NOW()
        `,
        [
          group.id,
          target.tenantId,
          target.projectId,
          group.serviceName,
          group.environment,
          group.fingerprint,
          group.errorType,
          group.normalizedMessage,
          group.exampleMessage,
          group.firstSeenAt,
          group.lastSeenAt,
          group.count,
          group.affectedTraceIds.size,
          group.exampleTraceId,
          group.severity,
          isNew,
          options.range.from,
        ],
      );
      count += 1;
    }
  }

  return count;
}

export async function buildDeploymentImpacts(
  options: BuildOptions & { windowMinutes?: number },
): Promise<number> {
  const clickhouse = options.clickhouse ?? getClickHouseClient();
  const targets = await resolveBuildTargets(options);
  const windowMinutes = options.windowMinutes ?? 30;
  let count = 0;

  for (const target of targets) {
    const params = clickhouseParams(target, options);
    const rows = await clickhouse.query<DeploymentRow>(
      `
        SELECT
          toString(deployment_id) AS deployment_id,
          timestamp,
          service_name,
          environment,
          version,
          git_sha,
          deployed_by,
          provider,
          metadata
        FROM deployment_events
        WHERE ${clickhouseWhere('timestamp', options.environment)}
        ORDER BY timestamp DESC
        LIMIT 500
      `,
      params,
    );

    for (const deployment of rows) {
      const deployedAt = new Date(deployment.timestamp);
      const beforeFrom = new Date(deployedAt.getTime() - windowMinutes * 60 * 1000);
      const afterTo = new Date(deployedAt.getTime() + windowMinutes * 60 * 1000);
      const before = await telemetryWindow(clickhouse, target, {
        from: beforeFrom,
        to: deployedAt,
        serviceName: deployment.service_name,
        environment: deployment.environment,
      });
      const after = await telemetryWindow(clickhouse, target, {
        from: deployedAt,
        to: afterTo,
        serviceName: deployment.service_name,
        environment: deployment.environment,
      });
      const newErrorGroups = await pgQuery<{ count: string | number }>(
        `
          SELECT count(*) AS count
          FROM error_groups
          WHERE tenant_id = $1
            AND project_id = $2
            AND service_name = $3
            AND environment = $4
            AND first_seen_at >= $5
            AND first_seen_at <= $6
        `,
        [
          target.tenantId,
          target.projectId,
          deployment.service_name,
          deployment.environment,
          deployedAt,
          afterTo,
        ],
      );
      const newErrorGroupsCount = toNumber(newErrorGroups.rows[0]?.count ?? 0);
      const riskLevel = riskLevelFromImpact({
        errorCountBefore: before.errorCount,
        errorCountAfter: after.errorCount,
        p95LatencyBeforeMs: before.p95LatencyMs,
        p95LatencyAfterMs: after.p95LatencyMs,
        newErrorGroupsCount,
      });
      const signals = deploymentSignals({
        errorCountBefore: before.errorCount,
        errorCountAfter: after.errorCount,
        p95LatencyBeforeMs: before.p95LatencyMs,
        p95LatencyAfterMs: after.p95LatencyMs,
        newErrorGroupsCount,
      });

      await pgQuery(
        `
          INSERT INTO deployment_impacts (
            tenant_id,
            project_id,
            deployment_id,
            service_name,
            environment,
            before_window_minutes,
            after_window_minutes,
            error_count_before,
            error_count_after,
            p95_latency_before_ms,
            p95_latency_after_ms,
            new_error_groups_count,
            risk_level,
            summary_json,
            calculated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, NOW())
          ON CONFLICT (tenant_id, project_id, deployment_id)
          DO UPDATE SET
            error_count_before = EXCLUDED.error_count_before,
            error_count_after = EXCLUDED.error_count_after,
            p95_latency_before_ms = EXCLUDED.p95_latency_before_ms,
            p95_latency_after_ms = EXCLUDED.p95_latency_after_ms,
            new_error_groups_count = EXCLUDED.new_error_groups_count,
            risk_level = EXCLUDED.risk_level,
            summary_json = EXCLUDED.summary_json,
            calculated_at = NOW()
        `,
        [
          target.tenantId,
          target.projectId,
          deployment.deployment_id,
          deployment.service_name,
          deployment.environment,
          windowMinutes,
          before.errorCount,
          after.errorCount,
          before.p95LatencyMs,
          after.p95LatencyMs,
          newErrorGroupsCount,
          riskLevel,
          JSON.stringify({
            signals,
            example_trace_ids: after.exampleTraceIds,
            deployment: {
              timestamp: deployment.timestamp,
              version: deployment.version,
              git_sha: deployment.git_sha,
              deployed_by: deployment.deployed_by,
              provider: deployment.provider,
              metadata: safeJson(deployment.metadata),
            },
          }),
        ],
      );
      count += 1;
    }
  }

  return count;
}

export async function refreshCorrelations(options: BuildOptions): Promise<BuildResult> {
  const serviceSummaries = await buildServiceSummaries(options);
  const serviceDependencies = await buildServiceDependencies(options);
  const errorGroups = await buildErrorGroups(options);
  const deploymentImpacts = await buildDeploymentImpacts(options);

  return {
    serviceSummaries,
    serviceDependencies,
    errorGroups,
    deploymentImpacts,
  };
}

async function updateDependencyCounts(options: BuildOptions): Promise<void> {
  const targets = await resolveBuildTargets(options);

  for (const target of targets) {
    await pgQuery(
      `
        UPDATE service_summaries AS summary
        SET dependency_count = dependency_counts.count,
            updated_at = NOW()
        FROM (
          SELECT service_name, environment, count(*) AS count
          FROM (
            SELECT source_service AS service_name, environment
            FROM service_dependencies
            WHERE tenant_id = $1 AND project_id = $2
            UNION ALL
            SELECT target_service AS service_name, environment
            FROM service_dependencies
            WHERE tenant_id = $1 AND project_id = $2
          ) AS edges
          GROUP BY service_name, environment
        ) AS dependency_counts
        WHERE summary.tenant_id = $1
          AND summary.project_id = $2
          AND summary.service_name = dependency_counts.service_name
          AND summary.environment = dependency_counts.environment
      `,
      [target.tenantId, target.projectId],
    );
  }
}

function clickhouseParams(
  target: BuildTarget,
  options: Pick<BuildOptions, 'range' | 'environment'>,
): Record<string, unknown> {
  return {
    tenantId: target.tenantId,
    projectId: target.projectId,
    from: toIso(options.range.from),
    to: toIso(options.range.to),
    environment: options.environment,
  };
}

function clickhouseWhere(timestampColumn: string, environment?: string): string {
  const conditions = [
    'tenant_id = {tenantId:String}',
    'project_id = {projectId:String}',
    `${timestampColumn} >= parseDateTime64BestEffort({from:String}, 3, 'UTC')`,
    `${timestampColumn} <= parseDateTime64BestEffort({to:String}, 3, 'UTC')`,
  ];
  if (environment) conditions.push('environment = {environment:String}');
  return conditions.join(' AND ');
}

function aggregateKey(serviceName: string, environment: string): string {
  return `${serviceName}:${environment}`;
}

function serviceAggregate(
  aggregates: Map<string, MutableServiceAggregate>,
  serviceName: string,
  environment: string,
): MutableServiceAggregate {
  const key = aggregateKey(serviceName, environment);
  const existing = aggregates.get(key);
  if (existing) return existing;

  const aggregate: MutableServiceAggregate = {
    serviceName,
    environment,
    firstSeenAt: new Date().toISOString(),
    lastSeenAt: new Date(0).toISOString(),
    sourceSignals: {
      logs: false,
      traces: false,
      metrics: false,
      deployments: false,
      log_count: 0,
      span_count: 0,
      metric_count: 0,
      deployment_count: 0,
    },
    latestVersion: null,
    latestDeploymentId: null,
    requestCount: 0,
    errorCount: 0,
    warningCount: 0,
    logCount: 0,
    spanCount: 0,
    metricCount: 0,
    deploymentCount: 0,
    avgLatencyMs: 0,
    p95LatencyMs: 0,
  };
  aggregates.set(key, aggregate);
  return aggregate;
}

function markSeen(
  aggregate: MutableServiceAggregate,
  firstSeenAt: string,
  lastSeenAt: string,
): void {
  if (new Date(firstSeenAt) < new Date(aggregate.firstSeenAt)) {
    aggregate.firstSeenAt = firstSeenAt;
  }
  if (new Date(lastSeenAt) > new Date(aggregate.lastSeenAt)) {
    aggregate.lastSeenAt = lastSeenAt;
  }
}

function toNumber(value: string | number | null | undefined): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function inferErrorType(message: string): string | undefined {
  const match = /([A-Z][A-Za-z0-9_.]*(?:Error|Exception|Timeout))/u.exec(message);
  return match?.[1];
}

async function telemetryWindow(
  clickhouse: IClickHouseClient,
  target: BuildTarget,
  input: {
    from: Date;
    to: Date;
    serviceName: string;
    environment: string;
  },
): Promise<{ errorCount: number; p95LatencyMs: number; exampleTraceIds: string[] }> {
  const params = {
    tenantId: target.tenantId,
    projectId: target.projectId,
    serviceName: input.serviceName,
    environment: input.environment,
    from: input.from.toISOString(),
    to: input.to.toISOString(),
  };
  const [spanRows, logRows] = await Promise.all([
    clickhouse.query<TelemetryWindowRow>(
      `
        SELECT
          countIf(status_code = 'ERROR') AS span_error_count,
          quantile(0.95)(duration_ms) AS p95_latency_ms,
          groupArray(5)(trace_id) AS example_trace_ids
        FROM spans
        WHERE tenant_id = {tenantId:String}
          AND project_id = {projectId:String}
          AND service_name = {serviceName:String}
          AND environment = {environment:String}
          AND timestamp >= parseDateTime64BestEffort({from:String}, 3, 'UTC')
          AND timestamp <= parseDateTime64BestEffort({to:String}, 3, 'UTC')
      `,
      params,
    ),
    clickhouse.query<LogErrorCountRow>(
      `
        SELECT count() AS log_error_count
        FROM logs
        WHERE tenant_id = {tenantId:String}
          AND project_id = {projectId:String}
          AND service_name = {serviceName:String}
          AND environment = {environment:String}
          AND timestamp >= parseDateTime64BestEffort({from:String}, 3, 'UTC')
          AND timestamp <= parseDateTime64BestEffort({to:String}, 3, 'UTC')
          AND severity IN ('ERROR', 'FATAL')
      `,
      params,
    ),
  ]);

  const span = spanRows[0];
  const log = logRows[0];
  const traceIds = Array.isArray(span?.example_trace_ids) ? span.example_trace_ids : [];

  return {
    errorCount: toNumber(span?.span_error_count) + toNumber(log?.log_error_count),
    p95LatencyMs: toNumber(span?.p95_latency_ms),
    exampleTraceIds: [...new Set(traceIds.filter(Boolean))],
  };
}

function deploymentSignals(input: {
  errorCountBefore: number;
  errorCountAfter: number;
  p95LatencyBeforeMs: number;
  p95LatencyAfterMs: number;
  newErrorGroupsCount: number;
}): Array<{ type: string; message: string }> {
  const signals: Array<{ type: string; message: string }> = [];

  if (input.newErrorGroupsCount > 0) {
    signals.push({
      type: 'error_group',
      message: `${input.newErrorGroupsCount} new error group(s) appeared after deployment`,
    });
  }

  if (input.errorCountAfter > input.errorCountBefore) {
    signals.push({
      type: 'error_rate',
      message: `Error count increased from ${input.errorCountBefore} to ${input.errorCountAfter}`,
    });
  }

  if (input.p95LatencyAfterMs > input.p95LatencyBeforeMs * 1.5 && input.p95LatencyAfterMs >= 200) {
    signals.push({
      type: 'latency',
      message: `p95 latency increased from ${Math.round(
        input.p95LatencyBeforeMs,
      )}ms to ${Math.round(input.p95LatencyAfterMs)}ms`,
    });
  }

  if (signals.length === 0) {
    signals.push({
      type: 'deployment',
      message: 'No significant error or latency regression detected in the comparison window',
    });
  }

  return signals;
}
