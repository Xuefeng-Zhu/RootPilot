'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { DeploymentImpactResponse, ErrorGroup, TimelineEvent } from '@rootpilot/shared';
import { apiClient } from '../../../lib/api';
import { formatMs, formatNumber, formatTimestamp } from '../../../lib/format';
import {
  EmptyState,
  ErrorState,
  PageTitle,
  Panel,
  StatCard,
  StatusBadge,
} from '../../../components/ui';

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
        <PageTitle title="Deployment Impact" description="Loading deployment analysis..." />
        <Panel>
          <div className="p-8 text-center text-sm text-slate-400">Loading deployment impact...</div>
        </Panel>
      </div>
    );
  }

  if (error || !state) {
    return (
      <div className="space-y-6">
        <PageTitle title="Deployment Impact" />
        <ErrorState message={error ?? 'Deployment not found'} />
      </div>
    );
  }

  const { impact } = state;
  const deployment = impact.deployment;

  return (
    <div className="space-y-5">
      <PageTitle
        title="Deployment Impact"
        description={`${deployment.service_name} ${deployment.version} · ${deployment.environment} · ${formatTimestamp(deployment.timestamp)}`}
        actions={
          <Link
            href={`/services/${encodeURIComponent(deployment.service_name)}?environment=${encodeURIComponent(
              deployment.environment,
            )}`}
            className="rp-button rp-button-primary"
          >
            Open Service
          </Link>
        }
      />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Risk"
          value={<StatusBadge status={impact.summary.risk_level} />}
          tone={
            impact.summary.risk_level === 'high'
              ? 'bad'
              : impact.summary.risk_level === 'medium'
                ? 'warn'
                : 'good'
          }
        />
        <StatCard
          label="Errors Before / After"
          value={`${formatNumber(impact.summary.error_count_before)} -> ${formatNumber(
            impact.summary.error_count_after,
          )}`}
          tone="bad"
        />
        <StatCard
          label="p95 Before / After"
          value={`${formatMs(impact.summary.p95_latency_before_ms)} -> ${formatMs(
            impact.summary.p95_latency_after_ms,
          )}`}
          tone="warn"
        />
        <StatCard
          label="New Error Groups"
          value={formatNumber(impact.summary.new_error_groups)}
          tone="purple"
        />
      </div>

      <Panel className="p-5">
        <h2 className="text-lg font-semibold text-white mb-4">Correlation Signals</h2>
        <div className="space-y-3">
          {impact.signals.map((signal) => (
            <div key={`${signal.type}-${signal.message}`} className="flex gap-3">
              <span className={`mt-1.5 w-2 h-2 rounded-full ${signalDot(signal.type)}`} />
              <p className="text-sm text-gray-200">{signal.message}</p>
            </div>
          ))}
        </div>
      </Panel>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <Panel className="p-5">
          <h2 className="text-lg font-semibold text-white mb-4">New Error Groups</h2>
          {state.errorGroups.length === 0 ? (
            <EmptyState title="No new error groups in the analyzed window" />
          ) : (
            <div className="space-y-3">
              {state.errorGroups.map((group) => (
                <Link
                  key={group.id}
                  href={`/error-groups/${encodeURIComponent(group.id)}`}
                  className="block rounded border border-surface-border bg-surface-subtle p-3 hover:border-red-400/50"
                >
                  <p className="text-sm font-medium text-red-300">
                    {group.error_type ?? group.normalized_message}
                  </p>
                  <p className="text-xs text-gray-400 mt-1 truncate">{group.example_message}</p>
                </Link>
              ))}
            </div>
          )}
        </Panel>

        <Panel className="p-5">
          <h2 className="text-lg font-semibold text-white mb-4">Example Traces</h2>
          {impact.example_trace_ids.length === 0 ? (
            <EmptyState title="No example traces were attached to this impact" />
          ) : (
            <div className="space-y-2">
              {impact.example_trace_ids.map((traceId) => (
                <Link
                  key={traceId}
                  href={`/traces/${encodeURIComponent(traceId)}`}
                  className="block rounded border border-surface-border bg-surface-subtle p-3 text-sm text-cyan-300 hover:border-purple-400/50 hover:text-white"
                >
                  {traceId}
                </Link>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <Panel className="p-5">
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
        </Panel>

        <Panel className="p-5">
          <h2 className="text-lg font-semibold text-white mb-4">Related Logs</h2>
          <div className="space-y-2">
            {state.logs.map((log) => (
              <div
                key={log.id}
                className="rounded border border-surface-border bg-surface-subtle p-3"
              >
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
        </Panel>
      </div>
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
