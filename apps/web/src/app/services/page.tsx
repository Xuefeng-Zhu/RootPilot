'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { ServiceSummary } from '@rootpilot/shared';
import { apiClient } from '../../lib/api';
import { formatMs, formatNumber, formatPercent, formatTimestamp } from '../../lib/format';
import {
  EmptyState,
  ErrorState,
  HealthBadge,
  PageTitle,
  Panel,
  ServiceHealthBar,
  StatCard,
} from '../../components/ui';

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

  const healthCounts = {
    healthy: services.filter((service) => service.health_status === 'healthy').length,
    warning: services.filter((service) => service.health_status === 'warning').length,
    critical: services.filter((service) => service.health_status === 'degraded').length,
    unknown: services.filter((service) => service.health_status === 'unknown').length,
  };

  return (
    <div className="space-y-5">
      <PageTitle
        title="Services"
        description="Discovered services, health, dependencies, and deployment context."
        actions={
          <Link href="/service-map" className="rp-button rp-button-primary">
            Open Service Map
          </Link>
        }
      />

      {loading && (
        <Panel>
          <div className="p-8 text-center text-sm text-slate-400">Loading services...</div>
        </Panel>
      )}

      {error && <ErrorState message={error} />}

      {!loading && !error && services.length === 0 && (
        <EmptyState
          title="No services found"
          description="Run the simulator and then npm run correlations:refresh to populate service summaries."
        />
      )}

      {!loading && !error && services.length > 0 && (
        <>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
            <StatCard label="Total Services" value={services.length} tone="info" />
            <StatCard label="Healthy" value={healthCounts.healthy} tone="good" />
            <StatCard label="Warning" value={healthCounts.warning} tone="warn" />
            <StatCard label="Critical" value={healthCounts.critical} tone="bad" />
            <Panel className="p-4 md:col-span-2 xl:col-span-1">
              <ServiceHealthBar {...healthCounts} />
            </Panel>
          </div>

          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <input
                type="text"
                value={serviceFilter}
                onChange={(event) => setServiceFilter(event.target.value)}
                placeholder="Filter services..."
                aria-label="Filter services by name"
                className="rp-input w-64"
              />

              <select
                value={environmentFilter}
                onChange={(event) => setEnvironmentFilter(event.target.value)}
                aria-label="Filter services by environment"
                className="rp-input"
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
                className="rp-input"
              >
                <option value="">All Health</option>
                {HEALTH_FILTERS.map((healthLabel) => (
                  <option key={healthLabel} value={healthLabel}>
                    {titleCase(healthLabel)}
                  </option>
                ))}
              </select>

              {hasActiveFilters && (
                <button type="button" onClick={clearFilters} className="rp-button">
                  Clear
                </button>
              )}

              <div className="ml-auto text-xs text-gray-500">
                {filteredServices.length} of {services.length} services
              </div>
            </div>

            {filteredServices.length === 0 ? (
              <EmptyState title="No services match the current filters" />
            ) : (
              <Panel className="overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="rp-table">
                    <thead>
                      <tr>
                        <th>Service</th>
                        <th>Environment</th>
                        <th>Health</th>
                        <th>Requests</th>
                        <th>Errors</th>
                        <th>Error Rate</th>
                        <th>p95 Latency</th>
                        <th>Deps</th>
                        <th>Latest Deploy</th>
                        <th>Last Seen</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredServices.map((service) => (
                        <tr key={`${service.service_name}-${service.environment}`}>
                          <td className="font-medium text-white">
                            <Link
                              href={`/services/${encodeURIComponent(service.service_name)}?environment=${encodeURIComponent(service.environment)}`}
                              className="hover:text-cyan-300"
                            >
                              {service.service_name}
                            </Link>
                          </td>
                          <td>
                            <span className="rounded border border-surface-border bg-surface-subtle px-2 py-0.5 text-xs text-slate-300">
                              {service.environment}
                            </span>
                          </td>
                          <td>
                            <HealthBadge status={service.health_status} />
                          </td>
                          <td>{formatNumber(service.request_count)}</td>
                          <td>{formatNumber(service.error_count)}</td>
                          <td>{formatPercent(service.error_count, service.request_count)}</td>
                          <td>{formatMs(service.p95_latency_ms)}</td>
                          <td>{formatNumber(service.dependency_count)}</td>
                          <td>
                            {service.latest_version ? (
                              <code className="rounded bg-surface-subtle px-1.5 py-0.5 text-xs">
                                {service.latest_version}
                              </code>
                            ) : (
                              '-'
                            )}
                          </td>
                          <td>{formatTimestamp(service.last_seen_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>
            )}
          </div>
        </>
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
