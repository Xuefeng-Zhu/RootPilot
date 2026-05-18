'use client';

import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import type {
  ErrorGroup,
  ServiceDependency,
  ServiceSummary,
  TimelineEvent,
} from '@rootpilot/shared';
import { apiClient } from '../../../lib/api';
import {
  formatMs,
  formatNumber,
  formatPercent,
  formatTimestamp,
  healthColor,
  healthTextColor,
} from '../../../lib/format';

interface DataResponse<T> {
  data: T;
}

interface ListResponse<T> {
  data: T[];
}

interface DeploymentEvent {
  deployment_id: string;
  timestamp: string;
  service_name: string;
  environment: string;
  version: string;
  git_sha: string;
  deployed_by: string;
}

interface TraceSummary {
  trace_id: string;
  root_operation: string;
  duration_ms: number;
  span_count: number;
  status: string;
  timestamp: string;
}

interface LogEntry {
  id: string;
  timestamp: string;
  severity: string;
  message: string;
  trace_id: string;
}

interface PageState {
  service: ServiceSummary;
  upstream: ServiceDependency[];
  downstream: ServiceDependency[];
  deployments: DeploymentEvent[];
  errorGroups: ErrorGroup[];
  timeline: TimelineEvent[];
  traces: TraceSummary[];
  logs: LogEntry[];
}

export default function ServiceDetailPage() {
  return (
    <Suspense fallback={<div className="text-gray-400">Loading service details...</div>}>
      <ServiceDetailContent />
    </Suspense>
  );
}

function ServiceDetailContent() {
  const params = useParams<{ serviceName: string }>();
  const searchParams = useSearchParams();
  const serviceName = decodeURIComponent(params.serviceName);
  const environment = searchParams.get('environment') ?? undefined;
  const [state, setState] = useState<PageState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchService() {
      try {
        setLoading(true);
        setError(null);
        const query = { environment };
        const [service, upstream, downstream, deployments, errorGroups, timeline, traces, logs] =
          await Promise.all([
            apiClient<DataResponse<ServiceSummary>>(
              `/v1/services/${encodeURIComponent(serviceName)}`,
              {
                params: query,
              },
            ),
            apiClient<ListResponse<ServiceDependency>>(
              `/v1/services/${encodeURIComponent(serviceName)}/upstream`,
              { params: query },
            ),
            apiClient<ListResponse<ServiceDependency>>(
              `/v1/services/${encodeURIComponent(serviceName)}/downstream`,
              { params: query },
            ),
            apiClient<ListResponse<DeploymentEvent>>(
              `/v1/services/${encodeURIComponent(serviceName)}/deployments`,
              { params: query },
            ),
            apiClient<ListResponse<ErrorGroup>>(
              `/v1/services/${encodeURIComponent(serviceName)}/error-groups`,
              { params: query },
            ),
            apiClient<ListResponse<TimelineEvent>>(
              `/v1/services/${encodeURIComponent(serviceName)}/timeline`,
              { params: query },
            ),
            apiClient<ListResponse<TraceSummary>>('/v1/traces', {
              params: { service: serviceName, environment, limit: 5 },
            }),
            apiClient<ListResponse<LogEntry>>('/v1/logs', {
              params: { service_name: serviceName, environment, limit: 8 },
            }),
          ]);

        setState({
          service: normalizeService(service.data),
          upstream: upstream.data,
          downstream: downstream.data,
          deployments: deployments.data,
          errorGroups: errorGroups.data,
          timeline: timeline.data,
          traces: traces.data,
          logs: logs.data,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch service details');
      } finally {
        setLoading(false);
      }
    }

    fetchService();
  }, [environment, serviceName]);

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-white">{serviceName}</h1>
        <div className="text-gray-400">Loading service details...</div>
      </div>
    );
  }

  if (error || !state) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-white">{serviceName}</h1>
        <div className="bg-red-900/30 border border-red-700 rounded-lg p-4 text-red-300">
          {error ?? 'Service not found'}
        </div>
      </div>
    );
  }

  const { service } = state;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-white">{service.service_name}</h1>
            <span className={`w-2.5 h-2.5 rounded-full ${healthColor(service.health_status)}`} />
            <span className={healthTextColor(service.health_status)}>
              {titleCase(service.health_status)}
            </span>
          </div>
          <p className="text-sm text-gray-400 mt-1">
            {service.environment} · Last seen {formatTimestamp(service.last_seen_at)}
          </p>
        </div>
        <Link
          href="/service-map"
          className="px-3 py-2 text-sm bg-surface-card border border-surface-border rounded text-gray-300 hover:text-white"
        >
          Back to Service Map
        </Link>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard label="Requests" value={formatNumber(service.request_count)} />
        <StatCard label="Errors" value={formatNumber(service.error_count)} />
        <StatCard
          label="Error Rate"
          value={formatPercent(service.error_count, service.request_count)}
        />
        <StatCard label="p95 Latency" value={formatMs(service.p95_latency_ms)} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <DependencyTable title="Upstream" dependencies={state.upstream} mode="upstream" />
        <DependencyTable title="Downstream" dependencies={state.downstream} mode="downstream" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <section className="bg-surface-card border border-surface-border rounded-lg p-5">
          <h2 className="text-lg font-semibold text-white mb-4">Recent Deployments</h2>
          {state.deployments.length === 0 ? (
            <p className="text-sm text-gray-400">No recent deployments for this service.</p>
          ) : (
            <div className="space-y-3">
              {state.deployments.slice(0, 5).map((deployment) => (
                <Link
                  key={deployment.deployment_id}
                  href={`/deployments/${encodeURIComponent(deployment.deployment_id)}`}
                  className="block border border-surface-border rounded p-3 hover:border-sidebar-active"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-white font-medium">{deployment.version}</span>
                    <span className="text-xs text-gray-500">
                      {formatTimestamp(deployment.timestamp)}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 mt-1">
                    {deployment.git_sha || '-'} · {deployment.deployed_by || 'unknown'}
                  </p>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="bg-surface-card border border-surface-border rounded-lg p-5">
          <h2 className="text-lg font-semibold text-white mb-4">Error Groups</h2>
          {state.errorGroups.length === 0 ? (
            <p className="text-sm text-gray-400">No grouped errors for this service.</p>
          ) : (
            <div className="space-y-3">
              {state.errorGroups.slice(0, 5).map((group) => (
                <Link
                  key={group.id}
                  href={`/error-groups?service=${encodeURIComponent(service.service_name)}`}
                  className="block border border-surface-border rounded p-3 hover:border-sidebar-active"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-red-300 font-medium">
                      {group.error_type ?? group.normalized_message}
                    </span>
                    <span className="text-xs text-gray-500">{formatNumber(group.count)}</span>
                  </div>
                  <p className="text-xs text-gray-400 mt-1 truncate">{group.example_message}</p>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="bg-surface-card border border-surface-border rounded-lg p-5">
        <h2 className="text-lg font-semibold text-white mb-4">Timeline</h2>
        {state.timeline.length === 0 ? (
          <p className="text-sm text-gray-400">No timeline events yet.</p>
        ) : (
          <div className="space-y-3">
            {state.timeline.map((event) => (
              <div key={`${event.type}-${event.timestamp}-${event.title}`} className="flex gap-3">
                <span className={`mt-1.5 w-2 h-2 rounded-full ${timelineDot(event.severity)}`} />
                <div>
                  <p className="text-sm text-white">{event.title}</p>
                  <p className="text-xs text-gray-500">{formatTimestamp(event.timestamp)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <section className="bg-surface-card border border-surface-border rounded-lg p-5">
          <h2 className="text-lg font-semibold text-white mb-4">Example Traces</h2>
          {state.traces.length === 0 ? (
            <p className="text-sm text-gray-400">No recent traces for this service.</p>
          ) : (
            <div className="space-y-2">
              {state.traces.map((trace) => (
                <Link
                  key={trace.trace_id}
                  href={`/traces/${encodeURIComponent(trace.trace_id)}`}
                  className="flex items-center justify-between gap-3 border border-surface-border rounded p-3 hover:border-sidebar-active"
                >
                  <span className="min-w-0">
                    <span className="block text-sm text-white truncate">
                      {trace.root_operation}
                    </span>
                    <span className="block text-xs text-gray-500">{trace.span_count} spans</span>
                  </span>
                  <span className="text-sm text-gray-300">{formatMs(trace.duration_ms)}</span>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="bg-surface-card border border-surface-border rounded-lg p-5">
          <h2 className="text-lg font-semibold text-white mb-4">Recent Logs</h2>
          {state.logs.length === 0 ? (
            <p className="text-sm text-gray-400">No recent logs for this service.</p>
          ) : (
            <div className="space-y-2">
              {state.logs.map((log) => (
                <div key={log.id} className="border border-surface-border rounded p-3">
                  <div className="flex items-center gap-2 text-xs text-gray-500 mb-1">
                    <span className={log.severity === 'ERROR' ? 'text-red-300' : 'text-gray-300'}>
                      {log.severity}
                    </span>
                    <span>{formatTimestamp(log.timestamp)}</span>
                  </div>
                  <p className="text-sm text-gray-200 truncate">{log.message}</p>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function DependencyTable({
  title,
  dependencies,
  mode,
}: {
  title: string;
  dependencies: ServiceDependency[];
  mode: 'upstream' | 'downstream';
}) {
  return (
    <section className="bg-surface-card border border-surface-border rounded-lg p-5">
      <h2 className="text-lg font-semibold text-white mb-4">{title}</h2>
      {dependencies.length === 0 ? (
        <p className="text-sm text-gray-400">No {title.toLowerCase()} dependencies found.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-gray-500 uppercase">
              <tr>
                <th className="pb-2">Service</th>
                <th className="pb-2">Calls</th>
                <th className="pb-2">Errors</th>
                <th className="pb-2">p95</th>
              </tr>
            </thead>
            <tbody>
              {dependencies.map((dependency) => {
                const service =
                  mode === 'upstream' ? dependency.source_service : dependency.target_service;
                return (
                  <tr key={dependency.id} className="border-t border-surface-border">
                    <td className="py-2 pr-3 text-white">{service}</td>
                    <td className="py-2 pr-3 text-gray-300">
                      {formatNumber(dependency.call_count)}
                    </td>
                    <td className="py-2 pr-3 text-gray-300">
                      {formatNumber(dependency.error_count)}
                    </td>
                    <td className="py-2 text-gray-300">{formatMs(dependency.p95_duration_ms)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface-card border border-surface-border rounded-lg p-5">
      <p className="text-sm text-gray-400">{label}</p>
      <p className="text-2xl font-semibold text-white mt-2">{value}</p>
    </div>
  );
}

function normalizeService(service: ServiceSummary): ServiceSummary {
  return {
    ...service,
    health_status: service.health_status ?? 'unknown',
    request_count: service.request_count ?? 0,
    error_count: service.error_count ?? 0,
    avg_latency_ms: service.avg_latency_ms ?? 0,
    p95_latency_ms: service.p95_latency_ms ?? 0,
  };
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function timelineDot(severity: string): string {
  if (severity === 'error') return 'bg-red-500';
  if (severity === 'warning') return 'bg-amber-400';
  return 'bg-sidebar-active';
}
