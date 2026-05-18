'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { ServiceSummary } from '@rootpilot/shared';
import { apiClient } from '../../lib/api';
import {
  formatMs,
  formatNumber,
  formatPercent,
  formatTimestamp,
  healthColor,
  healthTextColor,
} from '../../lib/format';

interface ServicesResponse {
  data: ServiceSummary[];
}

const HEALTH_FILTERS = ['healthy', 'warning', 'degraded', 'unknown'] as const;

export default function ServicesPage() {
  const [services, setServices] = useState<ServiceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [serviceFilter, setServiceFilter] = useState('');
  const [environmentFilter, setEnvironmentFilter] = useState('');
  const [healthFilter, setHealthFilter] = useState('');

  useEffect(() => {
    async function fetchServices() {
      try {
        setLoading(true);
        setError(null);
        const response = await apiClient<ServicesResponse>('/v1/services');
        setServices(response.data.map(normalizeServiceSummary));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch services');
      } finally {
        setLoading(false);
      }
    }
    fetchServices();
  }, []);

  const environments = useMemo(
    () => [...new Set(services.map((service) => service.environment).filter(Boolean))].sort(),
    [services],
  );

  const filteredServices = useMemo(() => {
    const normalizedServiceFilter = serviceFilter.trim().toLowerCase();

    return services.filter((service) => {
      const matchesService =
        normalizedServiceFilter.length === 0 ||
        service.service_name.toLowerCase().includes(normalizedServiceFilter);
      const matchesEnvironment =
        environmentFilter.length === 0 || service.environment === environmentFilter;
      const matchesHealth = healthFilter.length === 0 || service.health_status === healthFilter;

      return matchesService && matchesEnvironment && matchesHealth;
    });
  }, [environmentFilter, healthFilter, serviceFilter, services]);

  const hasActiveFilters =
    serviceFilter.trim().length > 0 || environmentFilter.length > 0 || healthFilter.length > 0;

  const clearFilters = () => {
    setServiceFilter('');
    setEnvironmentFilter('');
    setHealthFilter('');
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Service Catalog</h1>
          <p className="text-sm text-gray-400 mt-1">
            Discovered services, health, dependencies, and recent deployment context.
          </p>
        </div>
        <Link
          href="/service-map"
          className="px-3 py-2 text-sm bg-sidebar-active text-white rounded border border-sidebar-active hover:bg-sidebar-active/80"
        >
          Open Service Map
        </Link>
      </div>

      {loading && <div className="text-gray-400">Loading services...</div>}

      {error && (
        <div className="bg-red-900/30 border border-red-700 rounded-lg p-4 text-red-300">
          {error}
        </div>
      )}

      {!loading && !error && services.length === 0 && (
        <div className="bg-surface-card border border-surface-border rounded-lg p-8 text-center">
          <p className="text-gray-400 text-lg">No services found</p>
          <p className="text-gray-500 text-sm mt-2">
            Run the simulator and then `npm run correlations:refresh` to populate service summaries.
          </p>
        </div>
      )}

      {!loading && !error && services.length > 0 && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="text"
              value={serviceFilter}
              onChange={(event) => setServiceFilter(event.target.value)}
              placeholder="Filter services..."
              aria-label="Filter services by name"
              className="w-64 px-3 py-2 text-sm bg-surface-card border border-surface-border rounded text-gray-300 placeholder-gray-500 focus:outline-none focus:border-sidebar-active"
            />

            <select
              value={environmentFilter}
              onChange={(event) => setEnvironmentFilter(event.target.value)}
              aria-label="Filter services by environment"
              className="px-3 py-2 text-sm bg-surface-card border border-surface-border rounded text-gray-300 focus:outline-none focus:border-sidebar-active"
            >
              <option value="">All Environments</option>
              {environments.map((environmentName) => (
                <option key={environmentName} value={environmentName}>
                  {environmentName}
                </option>
              ))}
            </select>

            <select
              value={healthFilter}
              onChange={(event) => setHealthFilter(event.target.value)}
              aria-label="Filter services by health"
              className="px-3 py-2 text-sm bg-surface-card border border-surface-border rounded text-gray-300 focus:outline-none focus:border-sidebar-active"
            >
              <option value="">All Health</option>
              {HEALTH_FILTERS.map((healthLabel) => (
                <option key={healthLabel} value={healthLabel}>
                  {titleCase(healthLabel)}
                </option>
              ))}
            </select>

            {hasActiveFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className="px-3 py-2 text-sm bg-surface-card border border-surface-border rounded text-gray-400 hover:text-white hover:bg-surface-border transition-colors"
              >
                Clear
              </button>
            )}

            <div className="ml-auto text-xs text-gray-500">
              {filteredServices.length} of {services.length} services
            </div>
          </div>

          {filteredServices.length === 0 ? (
            <div className="border border-surface-border rounded p-8 text-center">
              <p className="text-gray-400 text-sm">No services match the current filters.</p>
            </div>
          ) : (
            <div className="overflow-x-auto border border-surface-border rounded-lg">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-gray-400 uppercase border-b border-surface-border bg-surface-card/60">
                  <tr>
                    <th className="px-4 py-3">Service</th>
                    <th className="px-4 py-3">Environment</th>
                    <th className="px-4 py-3">Health</th>
                    <th className="px-4 py-3">Requests</th>
                    <th className="px-4 py-3">Errors</th>
                    <th className="px-4 py-3">Error Rate</th>
                    <th className="px-4 py-3">p95 Latency</th>
                    <th className="px-4 py-3">Deps</th>
                    <th className="px-4 py-3">Latest Deploy</th>
                    <th className="px-4 py-3">Last Seen</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredServices.map((service) => (
                    <tr
                      key={`${service.service_name}-${service.environment}`}
                      className="border-b border-surface-border last:border-b-0 hover:bg-surface-card/50 transition-colors"
                    >
                      <td className="px-4 py-3 font-medium text-white">
                        <Link
                          href={`/services/${encodeURIComponent(service.service_name)}?environment=${encodeURIComponent(service.environment)}`}
                          className="hover:text-sidebar-active"
                        >
                          {service.service_name}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-0.5 rounded text-xs bg-surface-card border border-surface-border text-gray-300">
                          {service.environment}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="flex items-center gap-2">
                          <span
                            className={`w-2 h-2 rounded-full ${healthColor(service.health_status)}`}
                          />
                          <span className={healthTextColor(service.health_status)}>
                            {titleCase(service.health_status)}
                          </span>
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-300">
                        {formatNumber(service.request_count)}
                      </td>
                      <td className="px-4 py-3 text-gray-300">
                        {formatNumber(service.error_count)}
                      </td>
                      <td className="px-4 py-3 text-gray-400">
                        {formatPercent(service.error_count, service.request_count)}
                      </td>
                      <td className="px-4 py-3 text-gray-400">
                        {formatMs(service.p95_latency_ms)}
                      </td>
                      <td className="px-4 py-3 text-gray-400">
                        {formatNumber(service.dependency_count)}
                      </td>
                      <td className="px-4 py-3 text-gray-400">
                        {service.latest_version ? (
                          <code className="text-xs bg-surface-card px-1.5 py-0.5 rounded">
                            {service.latest_version}
                          </code>
                        ) : (
                          '-'
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-400">
                        {formatTimestamp(service.last_seen_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function normalizeServiceSummary(service: ServiceSummary): ServiceSummary {
  return {
    ...service,
    first_seen_at: service.first_seen_at ?? service.last_seen,
    last_seen_at: service.last_seen_at ?? service.last_seen,
    health_status: service.health_status ?? 'unknown',
    source_signals: service.source_signals ?? {
      logs: service.log_count > 0,
      traces: service.span_count > 0,
      metrics: service.metric_count > 0,
      deployments: false,
    },
    latest_version: service.latest_version ?? null,
    latest_deployment_id: service.latest_deployment_id ?? null,
    request_count: service.request_count ?? service.span_count ?? 0,
    error_count: service.error_count ?? 0,
    deployment_count: service.deployment_count ?? 0,
    dependency_count: service.dependency_count ?? 0,
    avg_latency_ms: service.avg_latency_ms ?? 0,
    p95_latency_ms: service.p95_latency_ms ?? 0,
    updated_at: service.updated_at ?? service.last_seen,
  };
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
