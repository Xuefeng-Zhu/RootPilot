'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { CanonicalLog, ErrorGroup, ErrorGroupDetailResponse } from '@rootpilot/shared';
import { apiClient } from '../../../lib/api';
import { formatNumber, formatTimestamp } from '../../../lib/format';
import { overviewSeries } from '../../../lib/mock-data/overview';
import { EmptyState, ErrorState, PageTitle, Panel, StatusBadge } from '../../../components/ui';

interface ListResponse<T> {
  data: T[];
}

export default function ErrorGroupDetailPage() {
  const params = useParams<{ id: string }>();
  const id = decodeURIComponent(params.id);
  const [group, setGroup] = useState<ErrorGroup | null>(null);
  const [logs, setLogs] = useState<CanonicalLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchGroup() {
      try {
        setLoading(true);
        setError(null);
        const detail = await apiClient<ErrorGroupDetailResponse>(
          `/v1/error-groups/${encodeURIComponent(id)}`,
        );
        const relatedLogs = await apiClient<ListResponse<CanonicalLog>>('/v1/logs', {
          params: buildRelatedLogQueryParams(detail.data),
        }).catch(() => ({ data: [] }));
        setGroup(detail.data);
        setLogs(relatedLogs.data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch error group');
      } finally {
        setLoading(false);
      }
    }

    fetchGroup();
  }, [id]);

  if (loading) {
    return (
      <div className="space-y-5">
        <PageTitle title="Error Group" description="Loading grouped error details..." />
        <Panel>
          <div className="p-8 text-center text-sm text-slate-400">Loading error group...</div>
        </Panel>
      </div>
    );
  }

  if (error || !group) {
    return (
      <div className="space-y-5">
        <PageTitle title="Error Group" />
        <ErrorState message={error ?? 'Error group not found'} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageTitle
        title={group.error_type ?? 'Error Group'}
        description={group.normalized_message}
        actions={
          <Link
            href={`/services/${encodeURIComponent(group.service_name)}?environment=${encodeURIComponent(group.environment)}`}
            className="rp-button rp-button-primary"
          >
            Open service
          </Link>
        }
      />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
        <Metric label="Count" value={formatNumber(group.count)} />
        <Metric label="Affected Traces" value={formatNumber(group.affected_traces_count)} />
        <Metric label="Severity" value={<StatusBadge status={group.severity} />} />
        <Metric label="First Seen" value={formatTimestamp(group.first_seen_at)} />
        <Metric label="Last Seen" value={formatTimestamp(group.last_seen_at)} />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_360px]">
        <Panel title="Trend Over Time">
          <div className="h-72 p-4">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={overviewSeries}>
                <CartesianGrid stroke="#1d2a3a" strokeDasharray="3 3" />
                <XAxis dataKey="time" stroke="#64748b" tickLine={false} axisLine={false} />
                <YAxis stroke="#64748b" tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{
                    background: '#0d1520',
                    border: '1px solid #1d2a3a',
                    borderRadius: '8px',
                    color: '#e2e8f0',
                  }}
                />
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

        <Panel title="Fingerprint">
          <div className="space-y-4 p-4 text-sm">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Service</p>
              <p className="mt-1 text-white">{group.service_name}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Environment</p>
              <p className="mt-1 text-white">{group.environment}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Fingerprint</p>
              <p className="mt-1 break-all font-mono text-xs text-cyan-200">{group.fingerprint}</p>
            </div>
            {group.example_trace_id && (
              <Link
                href={`/traces/${encodeURIComponent(group.example_trace_id)}`}
                className="rp-button w-full"
              >
                Open example trace
              </Link>
            )}
          </div>
        </Panel>
      </div>

      <Panel title="Example Message">
        <pre className="whitespace-pre-wrap p-4 text-sm text-slate-200">
          {group.example_message}
        </pre>
      </Panel>

      <Panel title="Related Logs">
        {logs.length === 0 ? (
          <div className="p-4">
            <EmptyState title="No related logs found for this fingerprint" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="rp-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Severity</th>
                  <th>Message</th>
                  <th>Trace</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id}>
                    <td>{formatTimestamp(log.timestamp)}</td>
                    <td>
                      <StatusBadge status={log.severity} />
                    </td>
                    <td className="max-w-xl truncate">{log.message}</td>
                    <td>
                      {log.trace_id ? (
                        <Link
                          href={`/traces/${encodeURIComponent(log.trace_id)}`}
                          className="text-cyan-300 hover:text-white"
                        >
                          Open trace
                        </Link>
                      ) : (
                        <span className="text-slate-600">-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

interface RelatedLogQueryParams extends Record<string, string | number> {
  fingerprint: string;
  service_name: string;
  environment: string;
  from: string;
  to: string;
  limit: number;
}

const RELATED_LOG_WINDOW_BUFFER_MS = 5 * 60 * 1000;
const DEFAULT_RELATED_LOG_WINDOW_MS = 60 * 60 * 1000;

function buildRelatedLogQueryParams(group: ErrorGroup): RelatedLogQueryParams {
  const window = getBufferedErrorGroupWindow(group);

  return {
    fingerprint: group.fingerprint,
    service_name: group.service_name,
    environment: group.environment,
    from: window.from,
    to: window.to,
    limit: 25,
  };
}

function getBufferedErrorGroupWindow(group: ErrorGroup): { from: string; to: string } {
  const firstSeen = Date.parse(group.first_seen_at);
  const lastSeen = Date.parse(group.last_seen_at);
  const now = Date.now();
  const baseStart = Number.isFinite(firstSeen) ? firstSeen : now - DEFAULT_RELATED_LOG_WINDOW_MS;
  const baseEnd = Number.isFinite(lastSeen) ? lastSeen : baseStart + DEFAULT_RELATED_LOG_WINDOW_MS;
  const windowStart = Math.min(baseStart, baseEnd);
  const windowEnd = Math.max(baseStart, baseEnd);

  return {
    from: new Date(Math.max(0, windowStart - RELATED_LOG_WINDOW_BUFFER_MS)).toISOString(),
    to: new Date(windowEnd + RELATED_LOG_WINDOW_BUFFER_MS).toISOString(),
  };
}

function Metric({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rp-panel p-4">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <div className="mt-2 text-lg font-semibold text-white">{value}</div>
    </div>
  );
}
