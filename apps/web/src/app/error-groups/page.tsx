'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import type { ErrorGroup } from '@rootpilot/shared';
import { apiClient } from '../../lib/api';
import { formatNumber, formatTimestamp } from '../../lib/format';
import { EmptyState, ErrorState, PageTitle, Panel, StatusBadge } from '../../components/ui';

interface ErrorGroupsResponse {
  data: ErrorGroup[];
}

export default function ErrorGroupsPage() {
  return (
    <Suspense fallback={<div className="text-gray-400">Loading error groups...</div>}>
      <ErrorGroupsContent />
    </Suspense>
  );
}

function ErrorGroupsContent() {
  const searchParams = useSearchParams();
  const initialService = searchParams.get('service') ?? '';
  const [groups, setGroups] = useState<ErrorGroup[]>([]);
  const [service, setService] = useState(initialService);
  const [environment, setEnvironment] = useState('');
  const [onlyNew, setOnlyNew] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchGroups() {
      try {
        setLoading(true);
        setError(null);
        const response = await apiClient<ErrorGroupsResponse>('/v1/error-groups', {
          params: {
            service: service || undefined,
            environment: environment || undefined,
            is_new: onlyNew || undefined,
            limit: 200,
          },
        });
        setGroups(response.data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch error groups');
      } finally {
        setLoading(false);
      }
    }

    fetchGroups();
  }, [environment, onlyNew, service]);

  const environments = useMemo(
    () => [...new Set(groups.map((group) => group.environment).filter(Boolean))].sort(),
    [groups],
  );

  return (
    <div className="space-y-5">
      <PageTitle
        title="Error Groups"
        description="Deterministic fingerprints from error logs and failed spans."
      />

      <div className="flex flex-wrap gap-3">
        <input
          value={service}
          onChange={(event) => setService(event.target.value)}
          placeholder="Filter service..."
          aria-label="Filter error groups by service"
          className="rp-input w-64"
        />
        <select
          value={environment}
          onChange={(event) => setEnvironment(event.target.value)}
          aria-label="Filter error groups by environment"
          className="rp-input"
        >
          <option value="">All Environments</option>
          {environments.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <label className="inline-flex items-center gap-2 rounded-md border border-surface-border bg-surface-subtle px-3 py-2 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={onlyNew}
            onChange={(event) => setOnlyNew(event.target.checked)}
            className="accent-sidebar-active"
          />
          New only
        </label>
      </div>

      {loading && (
        <Panel>
          <div className="p-8 text-center text-sm text-slate-400">Loading error groups...</div>
        </Panel>
      )}

      {error && <ErrorState message={error} />}

      {!loading && !error && groups.length === 0 && (
        <EmptyState
          title="No error groups found"
          description="Run a failure scenario, then npm run correlations:refresh."
        />
      )}

      {!loading && !error && groups.length > 0 && (
        <Panel className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="rp-table">
              <thead>
                <tr>
                  <th>Group</th>
                  <th>Service</th>
                  <th>Environment</th>
                  <th>Severity</th>
                  <th>Count</th>
                  <th>Traces</th>
                  <th>First Seen</th>
                  <th>Last Seen</th>
                  <th>Example Trace</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((group) => (
                  <tr key={group.id}>
                    <td className="min-w-[320px]">
                      <Link
                        href={`/error-groups/${encodeURIComponent(group.id)}`}
                        className="font-medium text-red-300 hover:text-red-100"
                      >
                        {group.error_type ?? group.normalized_message}
                      </Link>
                      <p className="max-w-[420px] truncate text-xs text-gray-500">
                        {group.example_message}
                      </p>
                    </td>
                    <td className="text-white">
                      <Link
                        href={`/services/${encodeURIComponent(group.service_name)}?environment=${encodeURIComponent(group.environment)}`}
                        className="hover:text-cyan-300"
                      >
                        {group.service_name}
                      </Link>
                    </td>
                    <td>{group.environment}</td>
                    <td>
                      <StatusBadge status={group.severity} />
                    </td>
                    <td>{formatNumber(group.count)}</td>
                    <td>{formatNumber(group.affected_traces_count)}</td>
                    <td>{formatTimestamp(group.first_seen_at)}</td>
                    <td>{formatTimestamp(group.last_seen_at)}</td>
                    <td>
                      {group.example_trace_id ? (
                        <Link
                          href={`/traces/${encodeURIComponent(group.example_trace_id)}`}
                          className="text-cyan-300 hover:text-white"
                        >
                          Open trace
                        </Link>
                      ) : (
                        <span className="text-gray-500">-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  );
}
