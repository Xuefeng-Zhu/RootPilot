'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { apiClient } from '../../lib/api';

// ─── Types ───────────────────────────────────────────────────────────────────

interface MetricDataPoint {
  timestamp: string;
  value: number;
}

interface MetricsResponse {
  metric_name: string | null;
  aggregation: string;
  interval: string | null;
  data: MetricDataPoint[];
}

interface MetricNamesResponse {
  data: string[];
}

interface MetricRow {
  timestamp: string;
  value: number;
  labels: Record<string, string>;
}

interface ServiceEntry {
  service_name: string;
  environment: string;
}

interface ServicesResponse {
  data: ServiceEntry[];
}

// ─── Constants ───────────────────────────────────────────────────────────────

const TIME_RANGES = [
  { label: '15m', value: '15m', ms: 15 * 60 * 1000 },
  { label: '1h', value: '1h', ms: 60 * 60 * 1000 },
  { label: '6h', value: '6h', ms: 6 * 60 * 60 * 1000 },
  { label: '24h', value: '24h', ms: 24 * 60 * 60 * 1000 },
  { label: '7d', value: '7d', ms: 7 * 24 * 60 * 60 * 1000 },
  { label: '30d', value: '30d', ms: 30 * 24 * 60 * 60 * 1000 },
];

/**
 * Auto-select aggregation interval based on time range duration.
 * - 15m–1h → 1m
 * - 1h–6h → 5m
 * - 6h–24h → 15m
 * - 24h–7d → 1h
 * - 7d+ → 1d
 */
function getAutoInterval(rangeMs: number): string {
  if (rangeMs <= 60 * 60 * 1000) return '1m';
  if (rangeMs <= 6 * 60 * 60 * 1000) return '5m';
  if (rangeMs <= 24 * 60 * 60 * 1000) return '15m';
  if (rangeMs <= 7 * 24 * 60 * 60 * 1000) return '1h';
  return '1d';
}

// ─── SVG Line Chart Component ────────────────────────────────────────────────

function LineChart({ data }: { data: MetricDataPoint[] }) {
  if (data.length === 0) return null;

  const width = 800;
  const height = 300;
  const padding = { top: 20, right: 20, bottom: 40, left: 60 };

  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  const timestamps = data.map((d) => new Date(d.timestamp).getTime());
  const values = data.map((d) => d.value);

  const minTime = Math.min(...timestamps);
  const maxTime = Math.max(...timestamps);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);

  const valueRange = maxValue - minValue || 1;
  const timeRange = maxTime - minTime || 1;

  const scaleX = (t: number) =>
    padding.left + ((t - minTime) / timeRange) * chartWidth;
  const scaleY = (v: number) =>
    padding.top + chartHeight - ((v - minValue) / valueRange) * chartHeight;

  const points = data.map((d) => {
    const x = scaleX(new Date(d.timestamp).getTime());
    const y = scaleY(d.value);
    return `${x},${y}`;
  });

  const polylinePoints = points.join(' ');

  // Generate Y-axis labels (5 ticks)
  const yTicks = Array.from({ length: 5 }, (_, i) => {
    const value = minValue + (valueRange * i) / 4;
    return { value, y: scaleY(value) };
  });

  // Generate X-axis labels (5 ticks)
  const xTicks = Array.from({ length: 5 }, (_, i) => {
    const time = minTime + (timeRange * i) / 4;
    return { time, x: scaleX(time) };
  });

  function formatTime(ms: number): string {
    const d = new Date(ms);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function formatValue(v: number): string {
    if (Math.abs(v) >= 1000000) return `${(v / 1000000).toFixed(1)}M`;
    if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(1)}K`;
    return v.toFixed(v % 1 === 0 ? 0 : 2);
  }

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full h-auto max-h-[300px]"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Metric values line chart"
    >
      {/* Grid lines */}
      {yTicks.map((tick, i) => (
        <line
          key={`grid-y-${i}`}
          x1={padding.left}
          y1={tick.y}
          x2={width - padding.right}
          y2={tick.y}
          stroke="#2a2a3e"
          strokeWidth="1"
        />
      ))}

      {/* Y-axis labels */}
      {yTicks.map((tick, i) => (
        <text
          key={`label-y-${i}`}
          x={padding.left - 8}
          y={tick.y + 4}
          textAnchor="end"
          fill="#8892a4"
          fontSize="11"
        >
          {formatValue(tick.value)}
        </text>
      ))}

      {/* X-axis labels */}
      {xTicks.map((tick, i) => (
        <text
          key={`label-x-${i}`}
          x={tick.x}
          y={height - 8}
          textAnchor="middle"
          fill="#8892a4"
          fontSize="11"
        >
          {formatTime(tick.time)}
        </text>
      ))}

      {/* Area fill */}
      <polygon
        points={`${scaleX(timestamps[0]!)},${padding.top + chartHeight} ${polylinePoints} ${scaleX(timestamps[timestamps.length - 1]!)},${padding.top + chartHeight}`}
        fill="rgba(59, 130, 246, 0.1)"
      />

      {/* Line */}
      <polyline
        points={polylinePoints}
        fill="none"
        stroke="#3b82f6"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {/* Data points (only if fewer than 50 to avoid clutter) */}
      {data.length <= 50 &&
        data.map((d, i) => (
          <circle
            key={i}
            cx={scaleX(new Date(d.timestamp).getTime())}
            cy={scaleY(d.value)}
            r="3"
            fill="#3b82f6"
          />
        ))}
    </svg>
  );
}

// ─── Main Page Component ─────────────────────────────────────────────────────

export default function MetricsExplorerPage() {
  // Filter state
  const [selectedMetric, setSelectedMetric] = useState<string>('');
  const [metricSearch, setMetricSearch] = useState('');
  const [showMetricDropdown, setShowMetricDropdown] = useState(false);
  const [timeRange, setTimeRange] = useState('1h');
  const [service, setService] = useState('');
  const [environment, setEnvironment] = useState('');

  // Data state
  const [availableMetrics, setAvailableMetrics] = useState<string[]>([]);
  const [availableServices, setAvailableServices] = useState<string[]>([]);
  const [availableEnvironments, setAvailableEnvironments] = useState<string[]>([]);
  const [chartData, setChartData] = useState<MetricDataPoint[]>([]);
  const [tableData, setTableData] = useState<MetricRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dropdownRef = useRef<HTMLDivElement>(null);

  // ─── Fetch available metric names and services ─────────────────────

  useEffect(() => {
    async function fetchMetricNames() {
      try {
        const response = await apiClient<MetricNamesResponse>('/v1/metrics/names');
        setAvailableMetrics(response.data);
      } catch {
        // Fallback: try fetching from /v1/metrics with broad time range
        try {
          const response = await apiClient<MetricsResponse>('/v1/metrics', {
            params: {
              from: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
              to: new Date().toISOString(),
            },
          });
          if (response.metric_name) {
            setAvailableMetrics([response.metric_name]);
          }
        } catch {
          setAvailableMetrics([]);
        }
      }
    }

    async function fetchServices() {
      try {
        const response = await apiClient<ServicesResponse>('/v1/services');
        const serviceNames = [...new Set(response.data.map((s) => s.service_name))];
        const envNames = [...new Set(response.data.map((s) => s.environment).filter(Boolean))];
        setAvailableServices(serviceNames);
        setAvailableEnvironments(envNames);
      } catch {
        setAvailableServices([]);
        setAvailableEnvironments([]);
      }
    }

    fetchMetricNames();
    fetchServices();
  }, []);

  // ─── Fetch metric data when filters change ─────────────────────────

  const fetchMetricData = useCallback(async () => {
    if (!selectedMetric) {
      setChartData([]);
      setTableData([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const rangeConfig = TIME_RANGES.find((r) => r.value === timeRange);
      const rangeMs = rangeConfig?.ms ?? 60 * 60 * 1000;
      const now = new Date();
      const from = new Date(now.getTime() - rangeMs);
      const interval = getAutoInterval(rangeMs);

      const params: Record<string, string | undefined> = {
        metric_name: selectedMetric,
        from: from.toISOString(),
        to: now.toISOString(),
        interval,
        aggregation: 'avg',
      };

      if (service) params.service = service;
      if (environment) params.environment = environment;

      const response = await apiClient<MetricsResponse>('/v1/metrics', {
        params,
      });

      setChartData(response.data);

      // For the table, fetch raw data (most recent 100 points)
      const rawParams: Record<string, string | undefined> = {
        metric_name: selectedMetric,
        from: from.toISOString(),
        to: now.toISOString(),
      };

      if (service) rawParams.service = service;
      if (environment) rawParams.environment = environment;

      const rawResponse = await apiClient<MetricsResponse>('/v1/metrics', {
        params: rawParams,
      });

      // Take most recent 100 points (data is ordered ascending, so take last 100)
      const recentPoints = rawResponse.data.slice(-100);
      setTableData(
        recentPoints.map((point) => ({
          timestamp: point.timestamp,
          value: point.value,
          labels: {},
        }))
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to fetch metric data';
      setError(message);
      setChartData([]);
      setTableData([]);
    } finally {
      setLoading(false);
    }
  }, [selectedMetric, timeRange, service, environment]);

  // Refresh data within 2 seconds of filter change (debounced at 300ms)
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchMetricData();
    }, 300);

    return () => clearTimeout(timer);
  }, [fetchMetricData]);

  // ─── Close dropdown on outside click ───────────────────────────────

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setShowMetricDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // ─── Filtered metric names for dropdown ────────────────────────────

  const filteredMetrics = availableMetrics.filter((name) =>
    name.toLowerCase().includes(metricSearch.toLowerCase())
  );

  // ─── Format timestamp for display ─────────────────────────────────

  function formatTimestamp(ts: string): string {
    const d = new Date(ts);
    return d.toLocaleString();
  }

  // ─── Render ────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">Metrics Explorer</h1>

      {/* Filter Controls */}
      <div className="flex flex-wrap items-end gap-4">
        {/* Metric Name Searchable Dropdown */}
        <div className="relative" ref={dropdownRef}>
          <label htmlFor="metric-search" className="block text-xs text-gray-400 mb-1">
            Metric
          </label>
          <input
            id="metric-search"
            type="text"
            value={selectedMetric || metricSearch}
            onChange={(e) => {
              setMetricSearch(e.target.value);
              setSelectedMetric('');
              setShowMetricDropdown(true);
            }}
            onFocus={() => setShowMetricDropdown(true)}
            placeholder="Search metrics..."
            className="w-64 px-3 py-2 bg-surface-card border border-surface-border rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
            aria-expanded={showMetricDropdown}
            aria-haspopup="listbox"
            role="combobox"
            aria-controls="metric-listbox"
          />
          {showMetricDropdown && (
            <div
              id="metric-listbox"
              role="listbox"
              className="absolute z-10 mt-1 w-64 max-h-48 overflow-y-auto bg-surface-card border border-surface-border rounded-lg shadow-lg"
            >
              {filteredMetrics.length === 0 ? (
                <div className="px-3 py-2 text-sm text-gray-500">
                  {availableMetrics.length === 0
                    ? 'No metrics available'
                    : 'No matching metrics'}
                </div>
              ) : (
                filteredMetrics.map((name) => (
                  <button
                    key={name}
                    role="option"
                    aria-selected={selectedMetric === name}
                    onClick={() => {
                      setSelectedMetric(name);
                      setMetricSearch('');
                      setShowMetricDropdown(false);
                    }}
                    className="w-full text-left px-3 py-2 text-sm text-gray-200 hover:bg-sidebar-hover transition-colors"
                  >
                    {name}
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        {/* Time Range */}
        <div>
          <label htmlFor="time-range" className="block text-xs text-gray-400 mb-1">
            Time Range
          </label>
          <select
            id="time-range"
            value={timeRange}
            onChange={(e) => setTimeRange(e.target.value)}
            className="px-3 py-2 bg-surface-card border border-surface-border rounded-lg text-sm text-white focus:outline-none focus:border-blue-500"
          >
            {TIME_RANGES.map((range) => (
              <option key={range.value} value={range.value}>
                {range.label}
              </option>
            ))}
          </select>
        </div>

        {/* Service Filter */}
        <div>
          <label htmlFor="service-filter" className="block text-xs text-gray-400 mb-1">
            Service
          </label>
          <select
            id="service-filter"
            value={service}
            onChange={(e) => setService(e.target.value)}
            className="w-40 px-3 py-2 bg-surface-card border border-surface-border rounded-lg text-sm text-white focus:outline-none focus:border-blue-500"
          >
            <option value="">All services</option>
            {availableServices.map((svc) => (
              <option key={svc} value={svc}>
                {svc}
              </option>
            ))}
          </select>
        </div>

        {/* Environment Filter */}
        <div>
          <label htmlFor="env-filter" className="block text-xs text-gray-400 mb-1">
            Environment
          </label>
          <select
            id="env-filter"
            value={environment}
            onChange={(e) => setEnvironment(e.target.value)}
            className="w-40 px-3 py-2 bg-surface-card border border-surface-border rounded-lg text-sm text-white focus:outline-none focus:border-blue-500"
          >
            <option value="">All environments</option>
            {availableEnvironments.map((env) => (
              <option key={env} value={env}>
                {env}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Loading State */}
      {loading && (
        <div className="flex items-center gap-2 text-gray-400 text-sm" aria-live="polite">
          <svg
            className="animate-spin h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
          Loading metrics...
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="bg-red-900/20 border border-red-800 rounded-lg p-4 text-sm text-red-300" role="alert">
          {error}
        </div>
      )}

      {/* Empty State — no metric selected */}
      {!loading && !error && !selectedMetric && (
        <div className="bg-surface-card border border-surface-border rounded-lg p-12 text-center">
          <svg
            className="mx-auto h-12 w-12 text-gray-600"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z"
            />
          </svg>
          <p className="mt-4 text-gray-400">
            Select a metric to visualize time-series data
          </p>
          <p className="mt-1 text-xs text-gray-500">
            Use the search dropdown above to find and select a metric name
          </p>
        </div>
      )}

      {/* Empty State — metric selected but no data */}
      {!loading && !error && selectedMetric && chartData.length === 0 && (
        <div className="bg-surface-card border border-surface-border rounded-lg p-12 text-center">
          <svg
            className="mx-auto h-12 w-12 text-gray-600"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z"
            />
          </svg>
          <p className="mt-4 text-gray-400">
            No data available for the current selection
          </p>
          <p className="mt-1 text-xs text-gray-500">
            Try adjusting the time range or filters
          </p>
        </div>
      )}

      {/* Chart */}
      {!loading && !error && chartData.length > 0 && (
        <div className="bg-surface-card border border-surface-border rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium text-gray-300">
              {selectedMetric}
            </h2>
            <span className="text-xs text-gray-500">
              Interval:{' '}
              {getAutoInterval(
                TIME_RANGES.find((r) => r.value === timeRange)?.ms ?? 3600000
              )}{' '}
              | Aggregation: avg
            </span>
          </div>
          <LineChart data={chartData} />
        </div>
      )}

      {/* Values Table */}
      {!loading && !error && tableData.length > 0 && (
        <div className="bg-surface-card border border-surface-border rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-surface-border">
            <h2 className="text-sm font-medium text-gray-300">
              Recent Values
              <span className="ml-2 text-xs text-gray-500">
                (most recent {tableData.length} points)
              </span>
            </h2>
          </div>
          <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-surface-card">
                <tr className="border-b border-surface-border">
                  <th className="text-left px-4 py-2 text-gray-400 font-medium">
                    Timestamp
                  </th>
                  <th className="text-left px-4 py-2 text-gray-400 font-medium">
                    Value
                  </th>
                  <th className="text-left px-4 py-2 text-gray-400 font-medium">
                    Labels
                  </th>
                </tr>
              </thead>
              <tbody>
                {tableData.map((row, i) => (
                  <tr
                    key={i}
                    className="border-b border-surface-border/50 hover:bg-sidebar-hover/30"
                  >
                    <td className="px-4 py-2 text-gray-300 font-mono text-xs">
                      {formatTimestamp(row.timestamp)}
                    </td>
                    <td className="px-4 py-2 text-white font-mono">
                      {row.value.toFixed(2)}
                    </td>
                    <td className="px-4 py-2 text-gray-400 text-xs">
                      {Object.keys(row.labels).length > 0
                        ? Object.entries(row.labels)
                            .map(([k, v]) => `${k}=${v}`)
                            .join(', ')
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
