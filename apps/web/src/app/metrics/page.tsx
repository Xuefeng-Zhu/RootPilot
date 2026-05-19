'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type {
  MetricAggregation,
  MetricCatalogEntry,
  MetricCatalogResponse,
  MetricDetailResponse,
  MetricSeriesResponse,
  MetricTopServicesResponse,
  MetricTopService,
} from '@rootpilot/shared';
import { apiClient, ApiError } from '../../lib/api';

interface ServiceEntry {
  service_name: string;
  environment: string;
}

interface ServicesResponse {
  data: ServiceEntry[];
}

interface LabelFilter {
  key: string;
  value: string;
}

type ChartType = 'line' | 'bar';

const TIME_RANGES = [
  { label: '15m', value: '15m', ms: 15 * 60 * 1000 },
  { label: '1h', value: '1h', ms: 60 * 60 * 1000 },
  { label: '6h', value: '6h', ms: 6 * 60 * 60 * 1000 },
  { label: '24h', value: '24h', ms: 24 * 60 * 60 * 1000 },
  { label: '7d', value: '7d', ms: 7 * 24 * 60 * 60 * 1000 },
  { label: '30d', value: '30d', ms: 30 * 24 * 60 * 60 * 1000 },
];

const AGGREGATIONS: MetricAggregation[] = [
  'avg',
  'min',
  'max',
  'sum',
  'count',
  'p50',
  'p95',
  'p99',
];
const BASE_GROUP_BY = ['service_name', 'environment', 'route', 'version', 'status_code'];
const SERIES_COLORS = ['#60a5fa', '#34d399', '#fbbf24', '#f87171', '#a78bfa', '#22d3ee', '#fb7185'];

function getAutoInterval(rangeMs: number): string {
  if (rangeMs <= 60 * 60 * 1000) return '1m';
  if (rangeMs <= 6 * 60 * 60 * 1000) return '5m';
  if (rangeMs <= 24 * 60 * 60 * 1000) return '15m';
  if (rangeMs <= 7 * 24 * 60 * 60 * 1000) return '1h';
  return '1d';
}

function getTimeWindow(range: string): { from: string; to: string; rangeMs: number } {
  const option = TIME_RANGES.find((entry) => entry.value === range) ?? TIME_RANGES[1]!;
  const now = new Date();
  return {
    from: new Date(now.getTime() - option.ms).toISOString(),
    to: now.toISOString(),
    rangeMs: option.ms,
  };
}

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatShortTime(value: string): string {
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '0';
  if (Math.abs(value) >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  if (Number.isInteger(value)) return value.toString();
  return value.toFixed(Math.abs(value) < 10 ? 2 : 1);
}

function formatMetricValue(value: number, unit: string): string {
  if (unit === 'ms') return `${formatNumber(value)} ms`;
  if (unit === 'By') {
    if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)} GB`;
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)} MB`;
    if (value >= 1_000) return `${(value / 1_000).toFixed(1)} KB`;
    return `${formatNumber(value)} B`;
  }
  if (unit === 'percent') return `${formatNumber(value)}%`;
  if (unit && unit !== '1') return `${formatNumber(value)} ${unit}`;
  return formatNumber(value);
}

function parseLabelsParam(value: string | null): LabelFilter[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
    return Object.entries(parsed)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      .map(([key, labelValue]) => ({ key, value: labelValue }));
  } catch {
    return [];
  }
}

function labelsToParam(filters: LabelFilter[]): string | undefined {
  const labels = Object.fromEntries(
    filters
      .map((filter) => ({ key: filter.key.trim(), value: filter.value.trim() }))
      .filter((filter) => filter.key && filter.value)
      .map((filter) => [filter.key, filter.value]),
  );
  return Object.keys(labels).length > 0 ? JSON.stringify(labels) : undefined;
}

function buildTelemetryParams(
  window: { from: string; to: string },
  service: string,
  environment: string,
) {
  const params = new URLSearchParams();
  params.set('from', window.from);
  params.set('to', window.to);
  if (service) params.set('service_name', service);
  if (environment) params.set('environment', environment);
  return params.toString();
}

function MetricsExplorerFallback() {
  return <div className="text-gray-400">Loading metrics...</div>;
}

export default function MetricsExplorerPage() {
  return (
    <Suspense fallback={<MetricsExplorerFallback />}>
      <MetricsExplorerContent />
    </Suspense>
  );
}

function MetricsExplorerContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [catalog, setCatalog] = useState<MetricCatalogEntry[]>([]);
  const [selectedMetric, setSelectedMetric] = useState(() => searchParams.get('metric_name') ?? '');
  const [range, setRange] = useState(() => searchParams.get('range') ?? '1h');
  const [service, setService] = useState(() => searchParams.get('service') ?? '');
  const [environment, setEnvironment] = useState(() => searchParams.get('environment') ?? '');
  const [aggregation, setAggregation] = useState<MetricAggregation>(
    () => (searchParams.get('aggregation') as MetricAggregation | null) ?? 'avg',
  );
  const [groupBy, setGroupBy] = useState(() => searchParams.get('group_by') ?? 'service_name');
  const [chartType, setChartType] = useState<ChartType>(
    () => (searchParams.get('chart') as ChartType | null) ?? 'line',
  );
  const [labelFilters, setLabelFilters] = useState<LabelFilter[]>(() =>
    parseLabelsParam(searchParams.get('labels')),
  );

  const [services, setServices] = useState<ServiceEntry[]>([]);
  const [detail, setDetail] = useState<MetricDetailResponse | null>(null);
  const [series, setSeries] = useState<MetricSeriesResponse | null>(null);
  const [topServices, setTopServices] = useState<MetricTopService[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedCatalogEntry = useMemo(
    () => catalog.find((entry) => entry.metric_name === selectedMetric) ?? null,
    [catalog, selectedMetric],
  );

  const timeWindow = useMemo(() => getTimeWindow(range), [range]);
  const interval = useMemo(() => getAutoInterval(timeWindow.rangeMs), [timeWindow.rangeMs]);

  const serviceOptions = useMemo(() => {
    const fromCatalog = catalog.flatMap((entry) => entry.services);
    const fromServices = services.map((entry) => entry.service_name);
    return [...new Set([...fromCatalog, ...fromServices].filter(Boolean))].sort();
  }, [catalog, services]);

  const environmentOptions = useMemo(
    () => [...new Set(services.map((entry) => entry.environment).filter(Boolean))].sort(),
    [services],
  );

  const groupByOptions = useMemo(() => {
    const keys = new Set(BASE_GROUP_BY);
    for (const key of detail?.label_keys ?? selectedCatalogEntry?.label_keys ?? []) {
      keys.add(key);
    }
    return [...keys].sort();
  }, [detail?.label_keys, selectedCatalogEntry?.label_keys]);

  const chartRows = useMemo(() => {
    if (!series) return [];
    const rows = new Map<string, Record<string, string | number | null>>();
    for (const currentSeries of series.series) {
      for (const point of currentSeries.points) {
        const existing =
          rows.get(point.timestamp) ??
          ({
            timestamp: point.timestamp,
            displayTime: formatShortTime(point.timestamp),
          } satisfies Record<string, string | number | null>);
        existing[currentSeries.name] = point.value;
        rows.set(point.timestamp, existing);
      }
    }
    return [...rows.values()].sort(
      (a, b) => new Date(String(a.timestamp)).getTime() - new Date(String(b.timestamp)).getTime(),
    );
  }, [series]);

  const seriesNames = useMemo(() => series?.series.map((entry) => entry.name) ?? [], [series]);

  useEffect(() => {
    async function fetchInitialData() {
      setCatalogLoading(true);
      try {
        const [catalogResponse, servicesResponse] = await Promise.all([
          apiClient<MetricCatalogResponse>('/v1/metrics/catalog'),
          apiClient<ServicesResponse>('/v1/services'),
        ]);
        setCatalog(catalogResponse.data);
        setServices(servicesResponse.data);
        setSelectedMetric((current) => current || catalogResponse.data[0]?.metric_name || '');
      } catch (err) {
        const message = err instanceof ApiError ? err.message : 'Failed to fetch metric catalog.';
        setError(message);
      } finally {
        setCatalogLoading(false);
      }
    }

    fetchInitialData();
  }, []);

  const buildQueryParams = useCallback((): Record<
    string,
    string | number | boolean | undefined
  > => {
    const labels = labelsToParam(labelFilters);
    return {
      from: timeWindow.from,
      to: timeWindow.to,
      interval,
      aggregation,
      group_by: groupBy || undefined,
      service: service || undefined,
      environment: environment || undefined,
      labels,
    };
  }, [
    aggregation,
    environment,
    groupBy,
    interval,
    labelFilters,
    service,
    timeWindow.from,
    timeWindow.to,
  ]);

  useEffect(() => {
    if (!selectedMetric) return;
    const params = new URLSearchParams();
    params.set('metric_name', selectedMetric);
    params.set('range', range);
    params.set('aggregation', aggregation);
    if (groupBy) params.set('group_by', groupBy);
    params.set('chart', chartType);
    if (service) params.set('service', service);
    if (environment) params.set('environment', environment);
    const labels = labelsToParam(labelFilters);
    if (labels) params.set('labels', labels);
    router.replace(`/metrics?${params.toString()}`, { scroll: false });
  }, [
    aggregation,
    chartType,
    environment,
    groupBy,
    labelFilters,
    range,
    router,
    selectedMetric,
    service,
  ]);

  const fetchMetricData = useCallback(async () => {
    if (!selectedMetric) {
      setDetail(null);
      setSeries(null);
      setTopServices([]);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const params = buildQueryParams();
      const [detailResponse, seriesResponse, topServicesResponse] = await Promise.all([
        apiClient<MetricDetailResponse>(`/v1/metrics/${encodeURIComponent(selectedMetric)}`),
        apiClient<MetricSeriesResponse>(
          `/v1/metrics/${encodeURIComponent(selectedMetric)}/series`,
          {
            params,
          },
        ),
        apiClient<MetricTopServicesResponse>(
          `/v1/metrics/${encodeURIComponent(selectedMetric)}/top-services`,
          { params },
        ),
      ]);
      setDetail(detailResponse);
      setSeries(seriesResponse);
      setTopServices(topServicesResponse.data);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to fetch metric data.';
      setError(message);
      setSeries(null);
      setTopServices([]);
    } finally {
      setLoading(false);
    }
  }, [buildQueryParams, selectedMetric]);

  useEffect(() => {
    fetchMetricData();
  }, [fetchMetricData]);

  function selectMetric(metricName: string) {
    setSelectedMetric(metricName);
    setDetail(null);
    setSeries(null);
    setTopServices([]);
  }

  function updateLabelFilter(index: number, patch: Partial<LabelFilter>) {
    setLabelFilters((current) =>
      current.map((filter, currentIndex) =>
        currentIndex === index ? { ...filter, ...patch } : filter,
      ),
    );
  }

  function removeLabelFilter(index: number) {
    setLabelFilters((current) => current.filter((_, currentIndex) => currentIndex !== index));
  }

  const relatedParams = buildTelemetryParams(timeWindow, service, environment);

  return (
    <div className="min-h-[calc(100vh-5rem)]">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Metrics Explorer</h1>
          <p className="text-sm text-gray-400">Catalog, query, compare, and drill into metrics.</p>
        </div>
        {series?.comparison && <AnomalyBadge status={series.comparison.status} />}
      </div>

      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <MetricCatalogSidebar
          catalog={catalog}
          loading={catalogLoading}
          selectedMetric={selectedMetric}
          onSelectMetric={selectMetric}
        />

        <main className="space-y-4">
          <section className="rounded-lg border border-surface-border bg-surface-card p-4">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <label className="space-y-1 text-xs text-gray-400">
                Metric
                <select
                  value={selectedMetric}
                  onChange={(event) => selectMetric(event.target.value)}
                  className="w-full rounded border border-surface-border bg-surface px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
                >
                  <option value="">Select metric</option>
                  {catalog.map((entry) => (
                    <option key={entry.metric_name} value={entry.metric_name}>
                      {entry.metric_name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-xs text-gray-400">
                Time range
                <select
                  value={range}
                  onChange={(event) => setRange(event.target.value)}
                  className="w-full rounded border border-surface-border bg-surface px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
                >
                  {TIME_RANGES.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-xs text-gray-400">
                Service
                <select
                  value={service}
                  onChange={(event) => setService(event.target.value)}
                  className="w-full rounded border border-surface-border bg-surface px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
                >
                  <option value="">All services</option>
                  {serviceOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-xs text-gray-400">
                Environment
                <select
                  value={environment}
                  onChange={(event) => setEnvironment(event.target.value)}
                  className="w-full rounded border border-surface-border bg-surface px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
                >
                  <option value="">All environments</option>
                  {environmentOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-xs text-gray-400">
                Aggregation
                <select
                  value={aggregation}
                  onChange={(event) => setAggregation(event.target.value as MetricAggregation)}
                  className="w-full rounded border border-surface-border bg-surface px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
                >
                  {AGGREGATIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-xs text-gray-400">
                Group by
                <select
                  value={groupBy}
                  onChange={(event) => setGroupBy(event.target.value)}
                  className="w-full rounded border border-surface-border bg-surface px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
                >
                  <option value="">None</option>
                  {groupByOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-xs text-gray-400">
                Chart
                <select
                  value={chartType}
                  onChange={(event) => setChartType(event.target.value as ChartType)}
                  className="w-full rounded border border-surface-border bg-surface px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
                >
                  <option value="line">line</option>
                  <option value="bar">bar</option>
                </select>
              </label>
              <div className="flex items-end gap-2">
                <Link
                  href={`/logs?${relatedParams}`}
                  className="rounded border border-surface-border px-3 py-2 text-xs text-gray-300 hover:text-white"
                >
                  Logs
                </Link>
                <Link
                  href={`/traces?${relatedParams.replace('service_name=', 'service=')}`}
                  className="rounded border border-surface-border px-3 py-2 text-xs text-gray-300 hover:text-white"
                >
                  Traces
                </Link>
                {service && (
                  <Link
                    href={`/services/${encodeURIComponent(service)}`}
                    className="rounded border border-surface-border px-3 py-2 text-xs text-gray-300 hover:text-white"
                  >
                    Service
                  </Link>
                )}
              </div>
            </div>

            <div className="mt-4 space-y-2">
              {labelFilters.map((filter, index) => (
                <div key={`${index}-${filter.key}`} className="flex flex-wrap items-center gap-2">
                  <input
                    value={filter.key}
                    onChange={(event) => updateLabelFilter(index, { key: event.target.value })}
                    placeholder="label key"
                    className="rounded border border-surface-border bg-surface px-3 py-1.5 text-xs text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
                  />
                  <span className="text-xs text-gray-500">=</span>
                  <input
                    value={filter.value}
                    onChange={(event) => updateLabelFilter(index, { value: event.target.value })}
                    placeholder="label value"
                    className="rounded border border-surface-border bg-surface px-3 py-1.5 text-xs text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => removeLabelFilter(index)}
                    className="rounded bg-surface px-2 py-1 text-xs text-gray-400 hover:text-white"
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setLabelFilters((current) => [...current, { key: '', value: '' }])}
                className="rounded border border-surface-border px-3 py-1.5 text-xs text-gray-300 hover:text-white"
              >
                Add label filter
              </button>
            </div>
          </section>

          {error && (
            <div className="rounded-lg border border-red-800 bg-red-900/20 p-4 text-sm text-red-300">
              {error}
            </div>
          )}

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
            <section className="rounded-lg border border-surface-border bg-surface-card p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-white">
                    {selectedMetric || 'Select a metric'}
                  </h2>
                  <p className="text-xs text-gray-500">
                    {series ? `${series.aggregation} · ${series.interval}` : 'No query loaded'}
                  </p>
                </div>
                {series?.comparison && (
                  <div className="max-w-xl text-right text-xs text-gray-300">
                    {series.comparison.summary}
                  </div>
                )}
              </div>

              {loading ? (
                <div className="flex h-[360px] items-center justify-center text-sm text-gray-400">
                  Loading metric data...
                </div>
              ) : !selectedMetric ? (
                <MetricEmptyState message="Select a metric from the catalog." />
              ) : chartRows.length === 0 ? (
                <MetricEmptyState message="No data available for this query." />
              ) : (
                <MetricChart
                  chartType={chartType}
                  rows={chartRows}
                  seriesNames={seriesNames}
                  unit={series?.unit ?? ''}
                />
              )}
            </section>

            <MetricDetailPanel detail={detail} loading={loading} />
          </div>

          {series?.comparison && (
            <BaselineSummary comparison={series.comparison} unit={series.unit} />
          )}

          <TopServicesTable services={topServices} unit={series?.unit ?? detail?.unit ?? ''} />
        </main>
      </div>
    </div>
  );
}

function MetricCatalogSidebar({
  catalog,
  loading,
  selectedMetric,
  onSelectMetric,
}: {
  catalog: MetricCatalogEntry[];
  loading: boolean;
  selectedMetric: string;
  onSelectMetric: (metricName: string) => void;
}) {
  return (
    <aside className="rounded-lg border border-surface-border bg-surface-card">
      <div className="border-b border-surface-border px-4 py-3">
        <h2 className="text-sm font-semibold text-white">Metric Catalog</h2>
        <p className="text-xs text-gray-500">{catalog.length} metrics</p>
      </div>
      <div className="max-h-[calc(100vh-13rem)] overflow-y-auto p-2">
        {loading ? (
          <div className="px-3 py-8 text-center text-sm text-gray-400">Loading catalog...</div>
        ) : catalog.length === 0 ? (
          <div className="px-3 py-8 text-center text-sm text-gray-400">No metrics found.</div>
        ) : (
          catalog.map((entry) => (
            <button
              key={entry.metric_name}
              type="button"
              onClick={() => onSelectMetric(entry.metric_name)}
              className={`mb-2 w-full rounded border p-3 text-left transition-colors ${
                selectedMetric === entry.metric_name
                  ? 'border-blue-500 bg-blue-500/10'
                  : 'border-surface-border bg-surface hover:border-gray-600'
              }`}
            >
              <div className="break-words text-sm font-medium text-white">{entry.metric_name}</div>
              <div className="mt-2 flex flex-wrap gap-1">
                <span className="rounded bg-surface-card px-2 py-0.5 text-[11px] text-gray-300">
                  {entry.metric_type}
                </span>
                {entry.unit && (
                  <span className="rounded bg-surface-card px-2 py-0.5 text-[11px] text-gray-300">
                    {entry.unit}
                  </span>
                )}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-gray-500">
                <span>{formatNumber(entry.sample_count)} samples</span>
                <span>{entry.services.length} services</span>
                <span className="col-span-2">Last {formatTimestamp(entry.last_seen)}</span>
              </div>
              {entry.label_keys.length > 0 && (
                <div className="mt-2 line-clamp-2 text-[11px] text-gray-500">
                  {entry.label_keys.join(', ')}
                </div>
              )}
            </button>
          ))
        )}
      </div>
    </aside>
  );
}

function MetricChart({
  chartType,
  rows,
  seriesNames,
  unit,
}: {
  chartType: ChartType;
  rows: Array<Record<string, string | number | null>>;
  seriesNames: string[];
  unit: string;
}) {
  const Chart = chartType === 'bar' ? BarChart : LineChart;

  return (
    <div className="h-[360px]" data-testid="metric-chart">
      <ResponsiveContainer width="100%" height="100%">
        <Chart data={rows} margin={{ top: 12, right: 24, bottom: 12, left: 4 }}>
          <CartesianGrid stroke="#273244" strokeDasharray="3 3" />
          <XAxis dataKey="displayTime" stroke="#8892a4" tick={{ fontSize: 11 }} />
          <YAxis
            stroke="#8892a4"
            tick={{ fontSize: 11 }}
            tickFormatter={(value) => formatMetricValue(Number(value), unit)}
          />
          <Tooltip
            contentStyle={{
              background: '#111827',
              border: '1px solid #374151',
              borderRadius: 8,
              color: '#e5e7eb',
            }}
            formatter={(value, name) => [formatMetricValue(Number(value), unit), name]}
            labelFormatter={(label) => `Time ${label}`}
          />
          <Legend />
          {seriesNames.map((name, index) =>
            chartType === 'bar' ? (
              <Bar
                key={name}
                dataKey={name}
                fill={SERIES_COLORS[index % SERIES_COLORS.length]}
                radius={[3, 3, 0, 0]}
              />
            ) : (
              <Line
                key={name}
                type="monotone"
                dataKey={name}
                stroke={SERIES_COLORS[index % SERIES_COLORS.length]}
                dot={false}
                strokeWidth={2}
                connectNulls
              />
            ),
          )}
        </Chart>
      </ResponsiveContainer>
    </div>
  );
}

function MetricDetailPanel({
  detail,
  loading,
}: {
  detail: MetricDetailResponse | null;
  loading: boolean;
}) {
  if (loading) {
    return (
      <section className="rounded-lg border border-surface-border bg-surface-card p-4 text-sm text-gray-400">
        Loading details...
      </section>
    );
  }

  if (!detail) {
    return (
      <section className="rounded-lg border border-surface-border bg-surface-card p-4 text-sm text-gray-400">
        No metric selected.
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-surface-border bg-surface-card p-4">
      <h2 className="text-sm font-semibold text-white">Metric Details</h2>
      <p className="mt-2 text-sm text-gray-300">{detail.description}</p>
      <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
        <MetricDetailValue label="Type" value={detail.metric_type} />
        <MetricDetailValue label="Unit" value={detail.unit || 'none'} />
        <MetricDetailValue
          label="Latest"
          value={
            detail.latest_value === null
              ? 'none'
              : formatMetricValue(detail.latest_value, detail.unit)
          }
        />
        <MetricDetailValue
          label="Last seen"
          value={detail.last_seen ? formatTimestamp(detail.last_seen) : 'never'}
        />
        <MetricDetailValue label="Samples" value={formatNumber(detail.sample_count)} />
        <MetricDetailValue label="Services" value={detail.services.join(', ') || 'none'} wide />
        <MetricDetailValue label="Label keys" value={detail.label_keys.join(', ') || 'none'} wide />
        <MetricDetailValue
          label="Example labels"
          value={
            Object.keys(detail.example_labels).length > 0
              ? Object.entries(detail.example_labels)
                  .map(([key, value]) => `${key}=${value}`)
                  .join(', ')
              : 'none'
          }
          wide
        />
      </div>
    </section>
  );
}

function MetricDetailValue({
  label,
  value,
  wide = false,
}: {
  label: string;
  value: string;
  wide?: boolean;
}) {
  return (
    <div className={wide ? 'col-span-2' : undefined}>
      <div className="text-gray-500">{label}</div>
      <div className="mt-1 break-words text-gray-200">{value}</div>
    </div>
  );
}

function BaselineSummary({
  comparison,
  unit,
}: {
  comparison: NonNullable<MetricSeriesResponse['comparison']>;
  unit: string;
}) {
  return (
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {(['avg', 'max', 'p95', 'count'] as const).map((key) => {
        const value = comparison[key];
        return (
          <div key={key} className="rounded-lg border border-surface-border bg-surface-card p-4">
            <div className="text-xs uppercase tracking-wide text-gray-500">{key}</div>
            <div className="mt-2 text-lg font-semibold text-white">
              {key === 'count'
                ? formatNumber(value.current)
                : formatMetricValue(value.current, unit)}
            </div>
            <div className="mt-1 text-xs text-gray-400">
              {value.delta_percent === null
                ? 'from zero'
                : `${value.delta_percent >= 0 ? '+' : ''}${value.delta_percent.toFixed(1)}%`}
            </div>
          </div>
        );
      })}
    </section>
  );
}

function AnomalyBadge({ status }: { status: string }) {
  const className =
    status === 'Large increase'
      ? 'border-red-500/40 bg-red-500/15 text-red-200'
      : status === 'Large decrease'
        ? 'border-blue-500/40 bg-blue-500/15 text-blue-200'
        : 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200';
  return (
    <span className={`rounded-full border px-3 py-1 text-xs font-medium ${className}`}>
      {status}
    </span>
  );
}

function TopServicesTable({ services, unit }: { services: MetricTopService[]; unit: string }) {
  return (
    <section className="rounded-lg border border-surface-border bg-surface-card">
      <div className="border-b border-surface-border px-4 py-3">
        <h2 className="text-sm font-semibold text-white">Top Services</h2>
      </div>
      {services.length === 0 ? (
        <MetricEmptyState message="No service breakdown available." compact />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-border text-left text-xs text-gray-500">
                <th className="px-4 py-2 font-medium">Service</th>
                <th className="px-4 py-2 font-medium">Latest</th>
                <th className="px-4 py-2 font-medium">Average</th>
                <th className="px-4 py-2 font-medium">p95</th>
                <th className="px-4 py-2 font-medium">Max</th>
                <th className="px-4 py-2 font-medium">Last seen</th>
              </tr>
            </thead>
            <tbody>
              {services.map((service) => (
                <tr
                  key={service.service_name}
                  className="border-b border-surface-border/60 hover:bg-sidebar-hover/30"
                >
                  <td className="px-4 py-3 text-white">{service.service_name}</td>
                  <td className="px-4 py-3 text-gray-300">
                    {formatMetricValue(service.latest_value, unit)}
                  </td>
                  <td className="px-4 py-3 text-gray-300">
                    {formatMetricValue(service.average, unit)}
                  </td>
                  <td className="px-4 py-3 text-gray-300">
                    {formatMetricValue(service.p95, unit)}
                  </td>
                  <td className="px-4 py-3 text-gray-300">
                    {formatMetricValue(service.max, unit)}
                  </td>
                  <td className="px-4 py-3 text-gray-400">{formatTimestamp(service.last_seen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function MetricEmptyState({ message, compact = false }: { message: string; compact?: boolean }) {
  return (
    <div
      className={`flex items-center justify-center text-center text-sm text-gray-400 ${
        compact ? 'min-h-28 p-4' : 'h-[360px] p-8'
      }`}
    >
      {message}
    </div>
  );
}
