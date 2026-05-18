'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import type { ErrorGroup } from '@rootpilot/shared';
import { apiClient } from '../../lib/api';
import { formatNumber, formatTimestamp } from '../../lib/format';

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
      <div>
        <h1 className="text-2xl font-bold text-white">Error Groups</h1>
        <p className="text-sm text-gray-400 mt-1">
          Deterministic fingerprints from error logs and failed spans.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <input
          value={service}
          onChange={(event) => setService(event.target.value)}
          placeholder="Filter service..."
          aria-label="Filter error groups by service"
          className="w-64 px-3 py-2 text-sm bg-surface-card border border-surface-border rounded text-gray-300 placeholder-gray-500 focus:outline-none focus:border-sidebar-active"
        />
        <select
          value={environment}
          onChange={(event) => setEnvironment(event.target.value)}
          aria-label="Filter error groups by environment"
          className="px-3 py-2 text-sm bg-surface-card border border-surface-border rounded text-gray-300 focus:outline-none focus:border-sidebar-active"
        >
          <option value="">All Environments</option>
          {environments.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <label className="inline-flex items-center gap-2 px-3 py-2 text-sm bg-surface-card border border-surface-border rounded text-gray-300">
          <input
            type="checkbox"
            checked={onlyNew}
            onChange={(event) => setOnlyNew(event.target.checked)}
            className="accent-sidebar-active"
          />
          New only
        </label>
      </div>

      {loading && <div className="text-gray-400">Loading error groups...</div>}

      {error && (
        <div className="bg-red-900/30 border border-red-700 rounded-lg p-4 text-red-300">
          {error}
        </div>
      )}

      {!loading && !error && groups.length === 0 && (
        <div className="bg-surface-card border border-surface-border rounded-lg p-8 text-center">
          <p className="text-gray-400">No error groups found.</p>
          <p className="text-gray-500 text-sm mt-2">
            Run a failure scenario, then `npm run correlations:refresh`.
          </p>
        </div>
      )}

      {!loading && !error && groups.length > 0 && (
        <div className="overflow-x-auto border border-surface-border rounded-lg">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-gray-400 uppercase border-b border-surface-border bg-surface-card/60">
              <tr>
                <th className="px-4 py-3">Group</th>
                <th className="px-4 py-3">Service</th>
                <th className="px-4 py-3">Environment</th>
                <th className="px-4 py-3">Count</th>
                <th className="px-4 py-3">Traces</th>
                <th className="px-4 py-3">First Seen</th>
                <th className="px-4 py-3">Last Seen</th>
                <th className="px-4 py-3">Example Trace</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <tr
                  key={group.id}
                  className="border-b border-surface-border last:border-b-0 hover:bg-surface-card/50"
                >
                  <td className="px-4 py-3 min-w-[320px]">
                    <p className="font-medium text-red-300">
                      {group.error_type ?? group.normalized_message}
                    </p>
                    <p className="text-xs text-gray-500 truncate max-w-[420px]">
                      {group.example_message}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-white">
                    <Link
                      href={`/services/${encodeURIComponent(group.service_name)}?environment=${encodeURIComponent(group.environment)}`}
                      className="hover:text-sidebar-active"
                    >
                      {group.service_name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-gray-400">{group.environment}</td>
                  <td className="px-4 py-3 text-gray-300">{formatNumber(group.count)}</td>
                  <td className="px-4 py-3 text-gray-300">
                    {formatNumber(group.affected_traces_count)}
                  </td>
                  <td className="px-4 py-3 text-gray-400">
                    {formatTimestamp(group.first_seen_at)}
                  </td>
                  <td className="px-4 py-3 text-gray-400">{formatTimestamp(group.last_seen_at)}</td>
                  <td className="px-4 py-3">
                    {group.example_trace_id ? (
                      <Link
                        href={`/traces/${encodeURIComponent(group.example_trace_id)}`}
                        className="text-sidebar-active hover:text-white"
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
      )}
    </div>
  );
}
