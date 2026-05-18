'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { DeploymentImpactResponse, ErrorGroup, TimelineEvent } from '@rootpilot/shared';
import { apiClient } from '../../../lib/api';
import { formatMs, formatNumber, formatTimestamp } from '../../../lib/format';

interface ListResponse<T> {
  data: T[];
}

interface LogEntry {
  id: string;
  timestamp: string;
  severity: string;
  message: string;
  trace_id: string;
}

interface PageState {
  impact: DeploymentImpactResponse;
  errorGroups: ErrorGroup[];
  timeline: TimelineEvent[];
  logs: LogEntry[];
}

export default function DeploymentImpactPage() {
  const params = useParams<{ deploymentId: string }>();
  const deploymentId = decodeURIComponent(params.deploymentId);
  const [state, setState] = useState<PageState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchDeployment() {
      try {
        setLoading(true);
        setError(null);
        const impact = await apiClient<DeploymentImpactResponse>(
          `/v1/deployments/${encodeURIComponent(deploymentId)}/impact`,
        );
        const [errorGroups, timeline, logs] = await Promise.all([
          apiClient<ListResponse<ErrorGroup>>('/v1/error-groups', {
            params: {
              service: impact.deployment.service_name,
              environment: impact.deployment.environment,
              is_new: true,
              limit: 5,
            },
          }),
          apiClient<ListResponse<TimelineEvent>>(
            `/v1/services/${encodeURIComponent(impact.deployment.service_name)}/timeline`,
            { params: { environment: impact.deployment.environment } },
          ),
          apiClient<ListResponse<LogEntry>>('/v1/logs', {
            params: {
              service_name: impact.deployment.service_name,
              environment: impact.deployment.environment,
              limit: 8,
            },
          }),
        ]);

        setState({
          impact,
          errorGroups: errorGroups.data,
          timeline: timeline.data,
          logs: logs.data,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch deployment impact');
      } finally {
        setLoading(false);
      }
    }

    fetchDeployment();
  }, [deploymentId]);

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-white">Deployment Impact</h1>
        <div className="text-gray-400">Loading deployment impact...</div>
      </div>
    );
  }

  if (error || !state) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-white">Deployment Impact</h1>
        <div className="bg-red-900/30 border border-red-700 rounded-lg p-4 text-red-300">
          {error ?? 'Deployment not found'}
        </div>
      </div>
    );
  }

  const { impact } = state;
  const deployment = impact.deployment;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Deployment Impact</h1>
          <p className="text-sm text-gray-400 mt-1">
            {deployment.service_name} {deployment.version} · {deployment.environment} ·{' '}
            {formatTimestamp(deployment.timestamp)}
          </p>
        </div>
        <Link
          href={`/services/${encodeURIComponent(deployment.service_name)}?environment=${encodeURIComponent(
            deployment.environment,
          )}`}
          className="px-3 py-2 text-sm bg-surface-card border border-surface-border rounded text-gray-300 hover:text-white"
        >
          Open Service
        </Link>
      </div>

      <section className="bg-surface-card border border-surface-border rounded-lg p-5">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          <ImpactStat
            label="Risk"
            value={impact.summary.risk_level.toUpperCase()}
            tone={impact.summary.risk_level}
          />
          <ImpactStat
            label="Errors Before / After"
            value={`${formatNumber(impact.summary.error_count_before)} -> ${formatNumber(
              impact.summary.error_count_after,
            )}`}
          />
          <ImpactStat
            label="p95 Before / After"
            value={`${formatMs(impact.summary.p95_latency_before_ms)} -> ${formatMs(
              impact.summary.p95_latency_after_ms,
            )}`}
          />
          <ImpactStat
            label="New Error Groups"
            value={formatNumber(impact.summary.new_error_groups)}
          />
        </div>
      </section>

      <section className="bg-surface-card border border-surface-border rounded-lg p-5">
        <h2 className="text-lg font-semibold text-white mb-4">Correlation Signals</h2>
        <div className="space-y-3">
          {impact.signals.map((signal) => (
            <div key={`${signal.type}-${signal.message}`} className="flex gap-3">
              <span className={`mt-1.5 w-2 h-2 rounded-full ${signalDot(signal.type)}`} />
              <p className="text-sm text-gray-200">{signal.message}</p>
            </div>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <section className="bg-surface-card border border-surface-border rounded-lg p-5">
          <h2 className="text-lg font-semibold text-white mb-4">New Error Groups</h2>
          {state.errorGroups.length === 0 ? (
            <p className="text-sm text-gray-400">No new error groups in the analyzed window.</p>
          ) : (
            <div className="space-y-3">
              {state.errorGroups.map((group) => (
                <Link
                  key={group.id}
                  href={`/error-groups?service=${encodeURIComponent(group.service_name)}`}
                  className="block border border-surface-border rounded p-3 hover:border-sidebar-active"
                >
                  <p className="text-sm font-medium text-red-300">
                    {group.error_type ?? group.normalized_message}
                  </p>
                  <p className="text-xs text-gray-400 mt-1 truncate">{group.example_message}</p>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="bg-surface-card border border-surface-border rounded-lg p-5">
          <h2 className="text-lg font-semibold text-white mb-4">Example Traces</h2>
          {impact.example_trace_ids.length === 0 ? (
            <p className="text-sm text-gray-400">No example traces were attached to this impact.</p>
          ) : (
            <div className="space-y-2">
              {impact.example_trace_ids.map((traceId) => (
                <Link
                  key={traceId}
                  href={`/traces/${encodeURIComponent(traceId)}`}
                  className="block border border-surface-border rounded p-3 text-sm text-sidebar-active hover:text-white hover:border-sidebar-active"
                >
                  {traceId}
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <section className="bg-surface-card border border-surface-border rounded-lg p-5">
          <h2 className="text-lg font-semibold text-white mb-4">Service Timeline</h2>
          <div className="space-y-3">
            {state.timeline.slice(0, 8).map((event) => (
              <div key={`${event.type}-${event.timestamp}-${event.title}`} className="flex gap-3">
                <span className={`mt-1.5 w-2 h-2 rounded-full ${timelineDot(event.severity)}`} />
                <div>
                  <p className="text-sm text-white">{event.title}</p>
                  <p className="text-xs text-gray-500">{formatTimestamp(event.timestamp)}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="bg-surface-card border border-surface-border rounded-lg p-5">
          <h2 className="text-lg font-semibold text-white mb-4">Related Logs</h2>
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
        </section>
      </div>
    </div>
  );
}

function ImpactStat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  const toneClass =
    tone === 'high'
      ? 'text-red-300'
      : tone === 'medium'
        ? 'text-amber-300'
        : tone === 'low'
          ? 'text-emerald-300'
          : 'text-white';
  return (
    <div>
      <p className="text-sm text-gray-400">{label}</p>
      <p className={`text-xl font-semibold mt-1 ${toneClass}`}>{value}</p>
    </div>
  );
}

function signalDot(type: string): string {
  if (type === 'latency') return 'bg-amber-400';
  if (type === 'deployment') return 'bg-sidebar-active';
  return 'bg-red-500';
}

function timelineDot(severity: string): string {
  if (severity === 'error') return 'bg-red-500';
  if (severity === 'warning') return 'bg-amber-400';
  return 'bg-sidebar-active';
}
