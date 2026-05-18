'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { DeploymentImpactResponse } from '@rootpilot/shared';
import { apiClient } from '../../lib/api';
import { formatMs, formatNumber, formatTimestamp } from '../../lib/format';

interface DeploymentEvent {
  deployment_id: string;
  timestamp: string;
  service_name: string;
  environment: string;
  version: string;
  git_sha: string;
  deployed_by: string;
  provider: string;
}

interface DeploymentListResponse {
  data: DeploymentEvent[];
  pagination: { cursor: string | null; hasMore: boolean };
}

interface DeploymentWithImpact extends DeploymentEvent {
  impact?: DeploymentImpactResponse;
}

export default function DeploymentsPage() {
  const [deployments, setDeployments] = useState<DeploymentWithImpact[]>([]);
  const [environment, setEnvironment] = useState('');
  const [service, setService] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchDeployments() {
      try {
        setLoading(true);
        setError(null);
        const response = await apiClient<DeploymentListResponse>('/v1/deployments', {
          params: {
            environment: environment || undefined,
            service: service || undefined,
            limit: 50,
          },
        });
        const withImpact = await Promise.all(
          response.data.map(async (deployment) => {
            try {
              const impact = await apiClient<DeploymentImpactResponse>(
                `/v1/deployments/${encodeURIComponent(deployment.deployment_id)}/impact`,
              );
              return { ...deployment, impact };
            } catch {
              return deployment;
            }
          }),
        );
        setDeployments(withImpact);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch deployments');
      } finally {
        setLoading(false);
      }
    }

    fetchDeployments();
  }, [environment, service]);

  const environments = [...new Set(deployments.map((deployment) => deployment.environment))].sort();

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-white">Deployments</h1>
        <p className="text-sm text-gray-400 mt-1">
          Deployment events with deterministic before and after impact analysis.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <input
          value={service}
          onChange={(event) => setService(event.target.value)}
          placeholder="Filter service..."
          aria-label="Filter deployments by service"
          className="w-64 px-3 py-2 text-sm bg-surface-card border border-surface-border rounded text-gray-300 placeholder-gray-500 focus:outline-none focus:border-sidebar-active"
        />
        <select
          value={environment}
          onChange={(event) => setEnvironment(event.target.value)}
          aria-label="Filter deployments by environment"
          className="px-3 py-2 text-sm bg-surface-card border border-surface-border rounded text-gray-300 focus:outline-none focus:border-sidebar-active"
        >
          <option value="">All Environments</option>
          {environments.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </div>

      {loading && <div className="text-gray-400">Loading deployments...</div>}

      {error && (
        <div className="bg-red-900/30 border border-red-700 rounded-lg p-4 text-red-300">
          {error}
        </div>
      )}

      {!loading && !error && deployments.length === 0 && (
        <div className="bg-surface-card border border-surface-border rounded-lg p-8 text-center">
          <p className="text-gray-400">No deployment events found.</p>
          <p className="text-gray-500 text-sm mt-2">
            Run `npm run simulate:bad-deploy` and `npm run correlations:refresh`.
          </p>
        </div>
      )}

      {!loading && !error && deployments.length > 0 && (
        <div className="overflow-x-auto border border-surface-border rounded-lg">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-gray-400 uppercase border-b border-surface-border bg-surface-card/60">
              <tr>
                <th className="px-4 py-3">Service</th>
                <th className="px-4 py-3">Version</th>
                <th className="px-4 py-3">Environment</th>
                <th className="px-4 py-3">Impact</th>
                <th className="px-4 py-3">Errors After</th>
                <th className="px-4 py-3">p95 After</th>
                <th className="px-4 py-3">Git SHA</th>
                <th className="px-4 py-3">Deployed By</th>
                <th className="px-4 py-3">Time</th>
              </tr>
            </thead>
            <tbody>
              {deployments.map((deployment) => (
                <tr
                  key={deployment.deployment_id}
                  className="border-b border-surface-border last:border-b-0 hover:bg-surface-card/50"
                >
                  <td className="px-4 py-3 font-medium text-white">
                    <Link
                      href={`/deployments/${encodeURIComponent(deployment.deployment_id)}`}
                      className="hover:text-sidebar-active"
                    >
                      {deployment.service_name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-gray-300">{deployment.version}</td>
                  <td className="px-4 py-3 text-gray-400">{deployment.environment}</td>
                  <td className="px-4 py-3">
                    <ImpactBadge risk={deployment.impact?.summary.risk_level ?? 'unknown'} />
                  </td>
                  <td className="px-4 py-3 text-gray-400">
                    {formatNumber(deployment.impact?.summary.error_count_after)}
                  </td>
                  <td className="px-4 py-3 text-gray-400">
                    {formatMs(deployment.impact?.summary.p95_latency_after_ms)}
                  </td>
                  <td className="px-4 py-3 text-gray-400">
                    <code className="text-xs">{deployment.git_sha || '-'}</code>
                  </td>
                  <td className="px-4 py-3 text-gray-400">{deployment.deployed_by || 'unknown'}</td>
                  <td className="px-4 py-3 text-gray-400">
                    {formatTimestamp(deployment.timestamp)}
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

function ImpactBadge({ risk }: { risk: string }) {
  const colors =
    risk === 'high'
      ? 'bg-red-900/40 text-red-300 border-red-700'
      : risk === 'medium'
        ? 'bg-amber-900/30 text-amber-300 border-amber-700'
        : risk === 'low'
          ? 'bg-emerald-900/30 text-emerald-300 border-emerald-700'
          : 'bg-gray-800 text-gray-400 border-gray-700';
  return (
    <span className={`px-2 py-0.5 rounded text-xs border ${colors}`}>
      {risk.charAt(0).toUpperCase() + risk.slice(1)}
    </span>
  );
}
