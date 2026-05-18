'use client';

import { useEffect, useMemo, useState } from 'react';
import { apiClient } from '../../lib/api';

interface Service {
  service_name: string;
  environment: string;
  last_seen: string;
  log_count: number;
  span_count: number;
  metric_count: number;
}

interface ServicesResponse {
  data: Service[];
}

interface LogEntry {
  id: string;
  severity: string;
  service_name: string;
}

interface LogsResponse {
  data: LogEntry[];
  pagination: { cursor: string | null; hasMore: boolean };
}

interface TraceSummary {
  trace_id: string;
  root_service: string;
  root_operation: string;
  duration_ms: number;
  span_count: number;
  status: string;
  timestamp: string;
}

interface TracesResponse {
  data: TraceSummary[];
  pagination: { cursor: string | null; hasMore: boolean };
}

interface HealthInfo {
  label: string;
  color: string;
  errorRate: number | null;
}

interface ServiceWithHealth {
  service: Service;
  health: HealthInfo;
}

const HEALTH_FILTERS = ['Healthy', 'Degraded', 'Unhealthy', 'No Data'] as const;

function computeHealth(
  service: Service,
  errorLogCounts: Map<string, number>,
  errorSpanCounts: Map<string, number>,
): HealthInfo {
  const key = `${service.service_name}:${service.environment}`;
  const errorLogs = errorLogCounts.get(key) ?? 0;
  const errorSpans = errorSpanCounts.get(key) ?? 0;

  const totalSignals = service.log_count + service.span_count;

  if (totalSignals === 0) {
    return { label: 'No Data', color: 'bg-gray-500', errorRate: null };
  }

  const totalErrors = errorLogs + errorSpans;
  const errorRate = totalErrors / totalSignals;

  if (errorRate >= 0.1) {
    return { label: 'Unhealthy', color: 'bg-red-500', errorRate };
  }
  if (errorRate >= 0.01) {
    return { label: 'Degraded', color: 'bg-yellow-500', errorRate };
  }
  return { label: 'Healthy', color: 'bg-green-500', errorRate };
}

function formatTimestamp(ts: string): string {
  try {
    const date = new Date(ts);
    return date.toLocaleString();
  } catch {
    return ts;
  }
}

function formatErrorRate(rate: number | null): string {
  if (rate === null) return '—';
  return `${(rate * 100).toFixed(1)}%`;
}

export default function ServicesPage() {
  const [services, setServices] = useState<Service[]>([]);
  const [errorLogCounts, setErrorLogCounts] = useState<Map<string, number>>(new Map());
  const [errorSpanCounts, setErrorSpanCounts] = useState<Map<string, number>>(new Map());
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

        // Fetch services list
        const servicesResponse = await apiClient<ServicesResponse>('/v1/services');
        setServices(servicesResponse.data);

        // Fetch recent error-severity logs to derive health indicator
        const logCounts = new Map<string, number>();
        const spanCounts = new Map<string, number>();

        try {
          // Get recent error logs (last 1h is the default)
          const errorLogs = await apiClient<LogsResponse>('/v1/logs', {
            params: { severity: 'ERROR', limit: 1000 },
          });
          for (const log of errorLogs.data) {
            // Count by service_name across all environments
            const currentCount = logCounts.get(log.service_name) ?? 0;
            logCounts.set(log.service_name, currentCount + 1);
          }

          // Also count FATAL logs
          const fatalLogs = await apiClient<LogsResponse>('/v1/logs', {
            params: { severity: 'FATAL', limit: 1000 },
          });
          for (const log of fatalLogs.data) {
            const currentCount = logCounts.get(log.service_name) ?? 0;
            logCounts.set(log.service_name, currentCount + 1);
          }
        } catch {
          // Non-critical: if log query fails, health indicator will use "No Data"
        }

        try {
          // Get recent traces to check for ERROR status spans
          const recentTraces = await apiClient<TracesResponse>('/v1/traces', {
            params: { limit: 200 },
          });
          for (const trace of recentTraces.data) {
            if (trace.status === 'ERROR') {
              const currentCount = spanCounts.get(trace.root_service) ?? 0;
              spanCounts.set(trace.root_service, currentCount + 1);
            }
          }
        } catch {
          // Non-critical: if trace query fails, health indicator will use log data only
        }

        // Map counts to service keys (service_name:environment)
        const errorLogsByKey = new Map<string, number>();
        const errorSpansByKey = new Map<string, number>();

        for (const service of servicesResponse.data) {
          const key = `${service.service_name}:${service.environment}`;
          // Assign error logs to matching services
          const logErrors = logCounts.get(service.service_name) ?? 0;
          errorLogsByKey.set(key, logErrors);
          // Assign error spans to matching services
          const spanErrors = spanCounts.get(service.service_name) ?? 0;
          errorSpansByKey.set(key, spanErrors);
        }

        setErrorLogCounts(errorLogsByKey);
        setErrorSpanCounts(errorSpansByKey);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch services');
      } finally {
        setLoading(false);
      }
    }
    fetchServices();
  }, []);

  const servicesWithHealth = useMemo<ServiceWithHealth[]>(
    () =>
      services.map((service) => ({
        service,
        health: computeHealth(service, errorLogCounts, errorSpanCounts),
      })),
    [errorLogCounts, errorSpanCounts, services],
  );

  const environments = useMemo(
    () => [...new Set(services.map((service) => service.environment).filter(Boolean))].sort(),
    [services],
  );

  const filteredServices = useMemo(() => {
    const normalizedServiceFilter = serviceFilter.trim().toLowerCase();

    return servicesWithHealth.filter(({ service, health }) => {
      const matchesService =
        normalizedServiceFilter.length === 0 ||
        service.service_name.toLowerCase().includes(normalizedServiceFilter);
      const matchesEnvironment =
        environmentFilter.length === 0 || service.environment === environmentFilter;
      const matchesHealth = healthFilter.length === 0 || health.label === healthFilter;

      return matchesService && matchesEnvironment && matchesHealth;
    });
  }, [environmentFilter, healthFilter, serviceFilter, servicesWithHealth]);

  const hasActiveFilters =
    serviceFilter.trim().length > 0 || environmentFilter.length > 0 || healthFilter.length > 0;

  const clearFilters = () => {
    setServiceFilter('');
    setEnvironmentFilter('');
    setHealthFilter('');
  };

  return (
    <div>
      <h1 className="text-2xl font-bold text-white mb-6">Service Catalog</h1>

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
            Services will appear here once they start sending telemetry data.
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
                  {healthLabel}
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
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-gray-400 uppercase border-b border-surface-border">
                  <tr>
                    <th className="px-4 py-3">Service Name</th>
                    <th className="px-4 py-3">Environment</th>
                    <th className="px-4 py-3">Last Seen</th>
                    <th className="px-4 py-3">Health</th>
                    <th className="px-4 py-3">Error Rate</th>
                    <th className="px-4 py-3">Logs</th>
                    <th className="px-4 py-3">Spans</th>
                    <th className="px-4 py-3">Metrics</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredServices.map(({ service, health }) => (
                    <tr
                      key={`${service.service_name}-${service.environment}`}
                      className="border-b border-surface-border hover:bg-surface-card/50 transition-colors"
                    >
                      <td className="px-4 py-3 font-medium text-white">{service.service_name}</td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-0.5 rounded text-xs bg-surface-card border border-surface-border text-gray-300">
                          {service.environment}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-400">
                        {formatTimestamp(service.last_seen)}
                      </td>
                      <td className="px-4 py-3">
                        <span className="flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full ${health.color}`} />
                          <span className="text-gray-300">{health.label}</span>
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-400">
                        {formatErrorRate(health.errorRate)}
                      </td>
                      <td className="px-4 py-3 text-gray-400">
                        {service.log_count.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-gray-400">
                        {service.span_count.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-gray-400">
                        {service.metric_count.toLocaleString()}
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
