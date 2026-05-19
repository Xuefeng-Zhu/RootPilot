'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type {
  CanonicalDeploymentEvent,
  CanonicalLog,
  ErrorGroup,
  ServiceSummary,
} from '@rootpilot/shared';
import { apiClient } from '../lib/api';
import { formatMs, formatPercent, formatTimestamp } from '../lib/format';
import { activeIssues, fallbackServices, overviewSeries } from '../lib/mock-data/overview';
import {
  EmptyState,
  ErrorState,
  HealthBadge,
  LoadingState,
  MiniSparkline,
  PageTitle,
  Panel,
  ServiceHealthBar,
  StatCard,
  StatusBadge,
} from '../components/ui';

interface ListResponse<T> {
  data: T[];
  pagination?: { cursor: string | null; hasMore: boolean };
}

interface DashboardState {
  services: ServiceSummary[];
  deployments: CanonicalDeploymentEvent[];
  errorLogs: CanonicalLog[];
  errorGroups: ErrorGroup[];
}

const DEFAULT_TIME_RANGE_MS = 24 * 60 * 60 * 1000;

export default function OverviewPage() {
  const [state, setState] = useState<DashboardState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      setError(null);

      try {
        const now = new Date();
        const from = new Date(now.getTime() - DEFAULT_TIME_RANGE_MS).toISOString();
        const to = now.toISOString();

        const [servicesRes, deploymentsRes, logsRes, errorGroupsRes] = await Promise.all([
          apiClient<ListResponse<ServiceSummary>>('/v1/services'),
          apiClient<ListResponse<CanonicalDeploymentEvent>>('/v1/deployments', {
            params: { limit: 5, from, to },
          }),
          apiClient<ListResponse<CanonicalLog>>('/v1/logs', {
            params: { severity: 'ERROR', limit: 10, from, to },
          }),
          apiClient<ListResponse<ErrorGroup>>('/v1/error-groups', {
            params: { limit: 8 },
          }).catch(() => ({ data: [] })),
        ]);

        setState({
          services: servicesRes.data.map(normalizeService),
          deployments: deploymentsRes.data,
          errorLogs: logsRes.data,
          errorGroups: errorGroupsRes.data,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load dashboard data');
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, []);

  const services = state?.services.length ? state.services : fallbackServices.map(normalizeService);
  const deployments = state?.deployments ?? [];
  const errorLogs = state?.errorLogs ?? [];
  const issues = useMemo(() => {
    if (!state?.errorGroups.length) return activeIssues;
    return state.errorGroups.slice(0, 3).map((group) => ({
      title: group.error_type ?? group.normalized_message,
      service: group.service_name,
      severity: group.severity === 'ERROR' ? 'P2' : 'P3',
      age: formatTimestamp(group.last_seen_at),
    }));
  }, [state?.errorGroups]);

  const totals = useMemo(() => {
    const requestCount = services.reduce((sum, service) => sum + service.request_count, 0);
    const errorCount = services.reduce((sum, service) => sum + service.error_count, 0);
    const logCount = services.reduce((sum, service) => sum + service.log_count, 0);
    const traceCount = services.reduce((sum, service) => sum + service.span_count, 0);
    const p95 =
      services.length > 0
        ? Math.max(...services.map((service) => service.p95_latency_ms).filter(Number.isFinite))
        : 0;
    const health = {
      healthy: services.filter((service) => service.health_status === 'healthy').length,
      warning: services.filter((service) => service.health_status === 'warning').length,
      critical: services.filter((service) => service.health_status === 'degraded').length,
      unknown: services.filter((service) => service.health_status === 'unknown').length,
    };
    return { requestCount, errorCount, logCount, traceCount, p95, health };
  }, [services]);

  if (loading) {
    return (
      <div className="space-y-5">
        <PageTitle title="Overview" description="Live RootPilot telemetry posture." />
        <LoadingState label="Loading observability overview..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-5">
        <PageTitle title="Overview" description="Live RootPilot telemetry posture." />
        <ErrorState message={error} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageTitle
        title="Overview"
        description="Service health, telemetry volume, latency, deployments, and active issues."
        actions={
          <Link href="/service-map" className="rp-button rp-button-primary">
            Open Service Map
          </Link>
        }
      />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-6">
        <StatCard label="Services" value={services.length} delta="+4.8%" tone="info">
          <MiniSparkline points={[40, 42, 43, 44, 45, services.length + 42]} color="#22d3ee" />
        </StatCard>
        <StatCard
          label="Log Volume"
          value={formatCompact(totals.logCount)}
          delta="+18.2%"
          tone="info"
        >
          <MiniSparkline points={[34, 38, 37, 43, 41, 48, 52]} color="#60a5fa" />
        </StatCard>
        <StatCard
          label="Trace Volume"
          value={formatCompact(totals.traceCount)}
          delta="+7.6%"
          tone="purple"
        >
          <MiniSparkline points={[24, 26, 27, 25, 29, 31, 33]} color="#a78bfa" />
        </StatCard>
        <StatCard
          label="Error Rate"
          value={formatPercent(totals.errorCount, Math.max(totals.requestCount, 1))}
          delta="+0.73 pp"
          tone="bad"
        >
          <MiniSparkline points={[5, 4, 8, 6, 10, 12, 11]} color="#f87171" />
        </StatCard>
        <StatCard label="P95 Latency" value={formatMs(totals.p95)} delta="+78 ms" tone="warn">
          <MiniSparkline points={[230, 250, 255, 278, 286, totals.p95]} color="#f59e0b" />
        </StatCard>
        <StatCard
          label="Recent Deployments"
          value={deployments.length || 3}
          delta="last 24h"
          tone="good"
        >
          <div className="space-y-1.5 text-xs text-slate-400">
            {(deployments.length ? deployments : fallbackDeployments())
              .slice(0, 3)
              .map((deployment) => (
                <div key={deployment.deployment_id} className="flex justify-between gap-2">
                  <span className="truncate">{deployment.service_name}</span>
                  <span className="text-slate-500">{deployment.version}</span>
                </div>
              ))}
          </div>
        </StatCard>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_360px]">
        <div className="grid grid-cols-1 gap-5 2xl:grid-cols-2">
          <Panel title="Requests Over Time">
            <div className="h-72 p-4">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={overviewSeries}>
                  <defs>
                    <linearGradient id="requestsGradient" x1="0" x2="0" y1="0" y2="1">
                      <stop offset="0%" stopColor="#22d3ee" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#22d3ee" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#1d2a3a" strokeDasharray="3 3" />
                  <XAxis dataKey="time" stroke="#64748b" tickLine={false} axisLine={false} />
                  <YAxis
                    stroke="#64748b"
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={formatCompact}
                  />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Area
                    type="monotone"
                    dataKey="requests"
                    stroke="#22d3ee"
                    strokeWidth={2}
                    fill="url(#requestsGradient)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Panel>

          <Panel title="Errors Over Time">
            <div className="h-72 p-4">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={overviewSeries}>
                  <CartesianGrid stroke="#1d2a3a" strokeDasharray="3 3" />
                  <XAxis dataKey="time" stroke="#64748b" tickLine={false} axisLine={false} />
                  <YAxis stroke="#64748b" tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Line
                    type="monotone"
                    dataKey="errors"
                    stroke="#f87171"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Panel>
        </div>

        <div className="space-y-5">
          <Panel title="Active Issues">
            <div className="space-y-3 p-4">
              {issues.map((issue) => (
                <Link
                  key={`${issue.title}-${issue.service}`}
                  href={`/error-groups?service=${encodeURIComponent(issue.service)}`}
                  className="block rounded-md border border-surface-border bg-surface-subtle p-3 transition-colors hover:border-amber-400/40"
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-medium text-slate-100">{issue.title}</p>
                    <StatusBadge status={issue.severity} />
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {issue.service} · {issue.age}
                  </p>
                </Link>
              ))}
            </div>
          </Panel>

          <Panel title="Recent Deployments">
            {deployments.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  title="No deployment events in this window"
                  description="Run npm run simulate:bad-deploy to generate deployment impact data."
                />
              </div>
            ) : (
              <div className="divide-y divide-surface-border">
                {deployments.slice(0, 5).map((deployment) => (
                  <Link
                    key={deployment.deployment_id}
                    href={`/deployments/${encodeURIComponent(deployment.deployment_id)}`}
                    className="block px-4 py-3 hover:bg-surface-raised/40"
                  >
                    <div className="flex justify-between gap-3 text-sm">
                      <span className="font-medium text-white">{deployment.service_name}</span>
                      <span className="text-slate-500">{deployment.version}</span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {deployment.deployed_by || 'unknown'} ·{' '}
                      {formatTimestamp(deployment.timestamp)}
                    </p>
                  </Link>
                ))}
              </div>
            )}
          </Panel>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[360px_1fr]">
        <Panel title="Service Health">
          <div className="p-4">
            <ServiceHealthBar {...totals.health} />
          </div>
        </Panel>

        <Panel
          title="Key Services"
          action={
            <Link href="/services" className="text-xs text-cyan-300 hover:text-white">
              View all services
            </Link>
          }
        >
          <div className="overflow-x-auto">
            <table className="rp-table">
              <thead>
                <tr>
                  <th>Service</th>
                  <th>Status</th>
                  <th>P95 Latency</th>
                  <th>Error Rate</th>
                  <th>Requests/min</th>
                </tr>
              </thead>
              <tbody>
                {services.slice(0, 6).map((service) => (
                  <tr key={`${service.service_name}-${service.environment}`}>
                    <td>
                      <Link
                        href={`/services/${encodeURIComponent(service.service_name)}?environment=${encodeURIComponent(service.environment)}`}
                        className="font-medium text-white hover:text-cyan-300"
                      >
                        {service.service_name}
                      </Link>
                    </td>
                    <td>
                      <HealthBadge status={service.health_status} />
                    </td>
                    <td>{formatMs(service.p95_latency_ms)}</td>
                    <td>{formatPercent(service.error_count, service.request_count)}</td>
                    <td>{formatCompact(Math.round(service.request_count / 60))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      <Panel title="Recent Errors">
        {errorLogs.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title="No error-severity log entries found"
              description="Try widening the time range or run npm run simulate:bad-deploy."
            />
          </div>
        ) : (
          <div className="divide-y divide-surface-border">
            {errorLogs.slice(0, 5).map((log) => (
              <Link
                key={log.id}
                href={log.trace_id ? `/traces/${encodeURIComponent(log.trace_id)}` : '/logs'}
                className="block px-4 py-3 hover:bg-surface-raised/40"
              >
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <StatusBadge status={log.severity} />
                  <span>{log.service_name}</span>
                  <span>{formatTimestamp(log.timestamp)}</span>
                </div>
                <p className="mt-2 truncate text-sm text-slate-200">{log.message}</p>
              </Link>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

const tooltipStyle = {
  background: '#0d1520',
  border: '1px solid #1d2a3a',
  borderRadius: '8px',
  color: '#e2e8f0',
};

function normalizeService(service: Partial<ServiceSummary>): ServiceSummary {
  return {
    id: service.id ?? `${service.service_name ?? 'unknown'}-${service.environment ?? 'unknown'}`,
    service_name: service.service_name ?? 'unknown-service',
    environment: service.environment ?? 'production',
    first_seen_at: service.first_seen_at ?? service.last_seen_at ?? service.last_seen ?? '',
    last_seen_at: service.last_seen_at ?? service.last_seen ?? '',
    last_seen: service.last_seen ?? service.last_seen_at ?? '',
    source_signals: service.source_signals ?? {
      logs: true,
      traces: true,
      metrics: true,
      deployments: Boolean(service.latest_deployment_id),
    },
    latest_version: service.latest_version ?? null,
    latest_deployment_id: service.latest_deployment_id ?? null,
    request_count: service.request_count ?? service.span_count ?? 0,
    error_count: service.error_count ?? 0,
    log_count: service.log_count ?? 0,
    span_count: service.span_count ?? 0,
    metric_count: service.metric_count ?? 0,
    deployment_count: service.deployment_count ?? 0,
    dependency_count: service.dependency_count ?? 0,
    avg_latency_ms: service.avg_latency_ms ?? 0,
    p95_latency_ms: service.p95_latency_ms ?? 0,
    health_status:
      service.health_status ?? inferHealth(service.error_count ?? 0, service.span_count ?? 0),
    updated_at: service.updated_at ?? service.last_seen_at ?? service.last_seen ?? '',
  };
}

function inferHealth(errorCount: number, requestCount: number): ServiceSummary['health_status'] {
  if (requestCount <= 0) return 'unknown';
  const errorRate = errorCount / requestCount;
  if (errorRate >= 0.03) return 'degraded';
  if (errorRate >= 0.01) return 'warning';
  return 'healthy';
}

function formatCompact(value: number): string {
  if (!Number.isFinite(value)) return '0';
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return Math.round(value).toLocaleString();
}

function fallbackDeployments(): CanonicalDeploymentEvent[] {
  return [
    {
      deployment_id: 'deploy_checkout_demo',
      tenant_id: 'demo',
      project_id: 'demo',
      timestamp: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
      service_name: 'checkout-service',
      environment: 'production',
      version: 'v2.14.3',
      git_sha: 'a1b2c3d',
      deployed_by: 'deploy-bot',
      provider: 'github-actions',
      metadata: {},
    },
    {
      deployment_id: 'deploy_payment_demo',
      tenant_id: 'demo',
      project_id: 'demo',
      timestamp: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
      service_name: 'payment-service',
      environment: 'production',
      version: 'v0.8.7',
      git_sha: 'f1e2d3c',
      deployed_by: 'deploy-bot',
      provider: 'github-actions',
      metadata: {},
    },
  ];
}
