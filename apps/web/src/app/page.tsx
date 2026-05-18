'use client';

import { useEffect, useState } from 'react';
import { apiClient } from '../lib/api';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ServiceEntry {
  service_name: string;
  environment: string;
  last_seen: string;
  log_count: number;
  span_count: number;
  metric_count: number;
}

interface ServiceListResponse {
  data: ServiceEntry[];
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

interface DeploymentListResponse {
  data: DeploymentEvent[];
  pagination: { cursor: string | null; hasMore: boolean };
}

interface LogEntry {
  id: string;
  timestamp: string;
  service_name: string;
  severity: string;
  message: string;
}

interface LogQueryResponse {
  data: LogEntry[];
  pagination: { cursor: string | null; hasMore: boolean };
}

interface SummaryData {
  serviceCount: number;
  logCount: number;
  traceCount: number;
  metricCount: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

/** Default time range for the overview dashboard: 24 hours in milliseconds */
const DEFAULT_TIME_RANGE_MS = 24 * 60 * 60 * 1000;

// ─── Component ───────────────────────────────────────────────────────────────

export default function OverviewPage() {
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [deployments, setDeployments] = useState<DeploymentEvent[] | null>(null);
  const [errorLogs, setErrorLogs] = useState<LogEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      setError(null);

      try {
        // Default time range: last 24 hours
        const now = new Date();
        const from = new Date(now.getTime() - DEFAULT_TIME_RANGE_MS).toISOString();
        const to = now.toISOString();

        const [servicesRes, deploymentsRes, logsRes] = await Promise.all([
          apiClient<ServiceListResponse>('/v1/services'),
          apiClient<DeploymentListResponse>('/v1/deployments', {
            params: { limit: 5, from, to },
          }),
          apiClient<LogQueryResponse>('/v1/logs', {
            params: { severity: 'ERROR', limit: 10, from, to },
          }),
        ]);

        // Compute summary from services data
        const services = servicesRes.data;
        const uniqueServices = new Set(services.map((s) => `${s.service_name}:${s.environment}`));
        const totalLogs = services.reduce((sum, s) => sum + s.log_count, 0);
        const totalTraces = services.reduce((sum, s) => sum + s.span_count, 0);
        const totalMetrics = services.reduce((sum, s) => sum + s.metric_count, 0);

        setSummary({
          serviceCount: uniqueServices.size,
          logCount: totalLogs,
          traceCount: totalTraces,
          metricCount: totalMetrics,
        });

        setDeployments(deploymentsRes.data);
        setErrorLogs(logsRes.data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load dashboard data');
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-white">Overview</h1>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div
              key={i}
              className="bg-surface-card border border-surface-border rounded-lg p-5 animate-pulse"
            >
              <div className="h-4 bg-surface-border rounded w-24 mb-3" />
              <div className="h-8 bg-surface-border rounded w-16" />
            </div>
          ))}
        </div>
        <div className="bg-surface-card border border-surface-border rounded-lg p-5 animate-pulse">
          <div className="h-5 bg-surface-border rounded w-48 mb-4" />
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-4 bg-surface-border rounded w-full" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-white">Overview</h1>
        <div className="bg-red-900/20 border border-red-800 rounded-lg p-4">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">Overview</h1>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard label="Services" value={summary?.serviceCount ?? 0} icon={<ServiceIcon />} />
        <SummaryCard label="Logs" value={summary?.logCount ?? 0} icon={<LogIcon />} />
        <SummaryCard label="Traces" value={summary?.traceCount ?? 0} icon={<TraceIcon />} />
        <SummaryCard label="Metrics" value={summary?.metricCount ?? 0} icon={<MetricIcon />} />
      </div>

      {/* Recent Deployments */}
      <section className="bg-surface-card border border-surface-border rounded-lg p-5">
        <h2 className="text-lg font-semibold text-white mb-4">Recent Deployments</h2>
        {deployments && deployments.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-400 border-b border-surface-border">
                  <th className="pb-2 pr-4 font-medium">Service</th>
                  <th className="pb-2 pr-4 font-medium">Version</th>
                  <th className="pb-2 pr-4 font-medium">Environment</th>
                  <th className="pb-2 pr-4 font-medium">Deployed By</th>
                  <th className="pb-2 font-medium">Time</th>
                </tr>
              </thead>
              <tbody className="text-gray-300">
                {deployments.map((d) => (
                  <tr
                    key={d.deployment_id}
                    className="border-b border-surface-border/50 last:border-0"
                  >
                    <td className="py-2.5 pr-4 font-medium text-white">{d.service_name}</td>
                    <td className="py-2.5 pr-4">
                      <code className="text-xs bg-surface-border/50 px-1.5 py-0.5 rounded">
                        {d.version}
                      </code>
                    </td>
                    <td className="py-2.5 pr-4">{d.environment}</td>
                    <td className="py-2.5 pr-4">{d.deployed_by || '—'}</td>
                    <td className="py-2.5 text-gray-400">{formatTimestamp(d.timestamp)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-gray-400 text-sm">
            No deployment events recorded for the selected time range.
          </p>
        )}
      </section>

      {/* Recent Error Logs */}
      <section className="bg-surface-card border border-surface-border rounded-lg p-5">
        <h2 className="text-lg font-semibold text-white mb-4">Recent Errors</h2>
        {errorLogs && errorLogs.length > 0 ? (
          <div className="space-y-2">
            {errorLogs.map((log) => (
              <div
                key={log.id}
                className="flex items-start gap-3 p-3 rounded-md bg-red-900/10 border border-red-900/30"
              >
                <span className="shrink-0 mt-0.5 inline-block w-2 h-2 rounded-full bg-red-500" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-xs text-gray-400 mb-1">
                    <span className="font-medium text-red-400">ERROR</span>
                    <span>·</span>
                    <span>{log.service_name}</span>
                    <span>·</span>
                    <span>{formatTimestamp(log.timestamp)}</span>
                  </div>
                  <p className="text-sm text-gray-200 truncate">{log.message}</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-gray-400 text-sm">
            No error-severity log entries found for the selected time range.
          </p>
        )}
      </section>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function SummaryCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
}) {
  return (
    <div className="bg-surface-card border border-surface-border rounded-lg p-5">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-gray-400">{label}</span>
        <span className="text-gray-500">{icon}</span>
      </div>
      <p className="text-2xl font-bold text-white">{value.toLocaleString()}</p>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatTimestamp(ts: string): string {
  try {
    const date = new Date(ts);
    if (isNaN(date.getTime())) return ts;
    return date.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return ts;
  }
}

// ─── Icons ───────────────────────────────────────────────────────────────────

function ServiceIcon() {
  return (
    <svg
      className="w-5 h-5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9"
      />
    </svg>
  );
}

function LogIcon() {
  return (
    <svg
      className="w-5 h-5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 0 1 0 3.75H5.625a1.875 1.875 0 0 1 0-3.75Z"
      />
    </svg>
  );
}

function TraceIcon() {
  return (
    <svg
      className="w-5 h-5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5"
      />
    </svg>
  );
}

function MetricIcon() {
  return (
    <svg
      className="w-5 h-5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z"
      />
    </svg>
  );
}
