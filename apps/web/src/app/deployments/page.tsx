'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { DeploymentImpactResponse } from '@rootpilot/shared';
import { apiClient } from '../../lib/api';
import { formatMs, formatNumber, formatTimestamp } from '../../lib/format';
import {
  EmptyState,
  ErrorState,
  PageTitle,
  Panel,
  StatCard,
  StatusBadge,
} from '../../components/ui';

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
      <PageTitle
        title="Deployments"
        description="Deployment events with deterministic before and after impact analysis."
      />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <StatCard label="Deployments" value={deployments.length} tone="info" />
        <StatCard
          label="High Impact"
          value={deployments.filter((item) => item.impact?.summary.risk_level === 'high').length}
          tone="bad"
        />
        <StatCard
          label="Services Changed"
          value={new Set(deployments.map((item) => item.service_name)).size}
          tone="purple"
        />
      </div>

      <div className="flex flex-wrap gap-3">
        <input
          value={service}
          onChange={(event) => setService(event.target.value)}
          placeholder="Filter service..."
          aria-label="Filter deployments by service"
          className="rp-input w-64"
        />
        <select
          value={environment}
          onChange={(event) => setEnvironment(event.target.value)}
          aria-label="Filter deployments by environment"
          className="rp-input"
        >
          <option value="">All Environments</option>
          {environments.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </div>

      {loading && (
        <Panel>
          <div className="p-8 text-center text-sm text-slate-400">Loading deployments...</div>
        </Panel>
      )}

      {error && <ErrorState message={error} />}

      {!loading && !error && deployments.length === 0 && (
        <EmptyState
          title="No deployment events found"
          description="Run npm run simulate:bad-deploy and npm run correlations:refresh."
        />
      )}

      {!loading && !error && deployments.length > 0 && (
        <Panel className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="rp-table">
              <thead>
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
                  <tr key={deployment.deployment_id}>
                    <td className="font-medium text-white">
                      <Link
                        href={`/deployments/${encodeURIComponent(deployment.deployment_id)}`}
                        className="hover:text-cyan-300"
                      >
                        {deployment.service_name}
                      </Link>
                    </td>
                    <td>{deployment.version}</td>
                    <td>{deployment.environment}</td>
                    <td>
                      <StatusBadge status={deployment.impact?.summary.risk_level ?? 'unknown'} />
                    </td>
                    <td>{formatNumber(deployment.impact?.summary.error_count_after)}</td>
                    <td>{formatMs(deployment.impact?.summary.p95_latency_after_ms)}</td>
                    <td>
                      <code className="text-xs">{deployment.git_sha || '-'}</code>
                    </td>
                    <td>{deployment.deployed_by || 'unknown'}</td>
                    <td>{formatTimestamp(deployment.timestamp)}</td>
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
