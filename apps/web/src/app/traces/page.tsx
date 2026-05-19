'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import type { TraceLatencyBucket, TraceListResponse, TraceSummary } from '@rootpilot/shared';
import { apiClient, ApiError } from '../../lib/api';

interface ServiceEntry {
  service_name: string;
  environment: string;
}

interface ServicesResponse {
  data: ServiceEntry[];
}

const TIME_RANGE_OPTIONS = [
  { label: '15m', value: '15m', ms: 15 * 60 * 1000 },
  { label: '1h', value: '1h', ms: 60 * 60 * 1000 },
  { label: '6h', value: '6h', ms: 6 * 60 * 60 * 1000 },
  { label: '24h', value: '24h', ms: 24 * 60 * 60 * 1000 },
  { label: '7d', value: '7d', ms: 7 * 24 * 60 * 60 * 1000 },
];

const DEFAULT_BUCKETS: TraceLatencyBucket[] = [
  { bucket: '<100ms', count: 0 },
  { bucket: '100-300ms', count: 0 },
  { bucket: '300-1000ms', count: 0 },
  { bucket: '1-3s', count: 0 },
  { bucket: '>3s', count: 0 },
];

const DEFAULT_TIME_RANGE = '1h';
const PAGE_SIZE = 50;

function getInitialRange(searchParams: URLSearchParams): string {
  if (searchParams.get('from') || searchParams.get('to')) return 'custom';
  const range = searchParams.get('range');
  return TIME_RANGE_OPTIONS.some((option) => option.value === range) ? range! : DEFAULT_TIME_RANGE;
}

function isValidDate(value: string): boolean {
  return value.length > 0 && !Number.isNaN(new Date(value).getTime());
}

function getTimeWindow(timeRange: string, customFrom: string, customTo: string) {
  const now = new Date();
  if (timeRange === 'custom') {
    const to = isValidDate(customTo) ? new Date(customTo) : now;
    const from = isValidDate(customFrom)
      ? new Date(customFrom)
      : new Date(to.getTime() - 60 * 60 * 1000);
    return { from: from.toISOString(), to: to.toISOString() };
  }

  const option =
    TIME_RANGE_OPTIONS.find((currentOption) => currentOption.value === timeRange) ??
    TIME_RANGE_OPTIONS[1]!;
  return {
    from: new Date(now.getTime() - option.ms).toISOString(),
    to: now.toISOString(),
  };
}

function TracesFallback() {
  return <div className="text-gray-400 text-sm py-8 text-center">Loading traces...</div>;
}

function formatDuration(ms: number): string {
  if (ms < 1) return '<1ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatTimestamp(ts: string): string {
  return new Date(ts).toLocaleString();
}

function statusClass(status: string): string {
  return status === 'ERROR'
    ? 'bg-red-950 text-red-300 border-red-800'
    : 'bg-green-950 text-green-300 border-green-800';
}

export default function TracesPage() {
  return (
    <Suspense fallback={<TracesFallback />}>
      <TracesContent />
    </Suspense>
  );
}

function TracesContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [traces, setTraces] = useState<TraceSummary[]>([]);
  const [services, setServices] = useState<ServiceEntry[]>([]);
  const [latencyBuckets, setLatencyBuckets] = useState<TraceLatencyBucket[]>(DEFAULT_BUCKETS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const [timeRange, setTimeRange] = useState(() =>
    getInitialRange(searchParams as URLSearchParams),
  );
  const [customFrom, setCustomFrom] = useState(() => searchParams.get('from') ?? '');
  const [customTo, setCustomTo] = useState(() => searchParams.get('to') ?? '');
  const [service, setService] = useState(
    () => searchParams.get('service') ?? searchParams.get('service_name') ?? '',
  );
  const [environment, setEnvironment] = useState(() => searchParams.get('environment') ?? '');
  const [operation, setOperation] = useState(() => searchParams.get('operation') ?? '');
  const [status, setStatus] = useState(() => searchParams.get('status')?.toUpperCase() ?? '');
  const [minDuration, setMinDuration] = useState(() => searchParams.get('minDuration') ?? '');
  const [maxDuration, setMaxDuration] = useState(() => searchParams.get('maxDuration') ?? '');
  const [traceId, setTraceId] = useState(() => searchParams.get('trace_id') ?? '');
  const [rootService, setRootService] = useState(() => searchParams.get('root_service') ?? '');
  const [httpRoute, setHttpRoute] = useState(() => searchParams.get('http_route') ?? '');
  const [errorOnly, setErrorOnly] = useState(() => searchParams.get('error_only') === 'true');

  const timeWindow = useMemo(
    () => getTimeWindow(timeRange, customFrom, customTo),
    [customFrom, customTo, timeRange],
  );

  const serviceOptions = useMemo(
    () => [...new Set(services.map((entry) => entry.service_name).filter(Boolean))].sort(),
    [services],
  );

  const environmentOptions = useMemo(
    () => [...new Set(services.map((entry) => entry.environment).filter(Boolean))].sort(),
    [services],
  );

  const currentUrlParams = useMemo(() => {
    const params = new URLSearchParams();
    if (timeRange === 'custom') {
      if (customFrom) params.set('from', customFrom);
      if (customTo) params.set('to', customTo);
    } else {
      params.set('range', timeRange);
    }
    if (service) params.set('service', service);
    if (environment) params.set('environment', environment);
    if (operation) params.set('operation', operation);
    if (status) params.set('status', status);
    if (minDuration) params.set('minDuration', minDuration);
    if (maxDuration) params.set('maxDuration', maxDuration);
    if (traceId) params.set('trace_id', traceId);
    if (rootService) params.set('root_service', rootService);
    if (httpRoute) params.set('http_route', httpRoute);
    if (errorOnly) params.set('error_only', 'true');
    return params;
  }, [
    customFrom,
    customTo,
    environment,
    errorOnly,
    httpRoute,
    maxDuration,
    minDuration,
    operation,
    rootService,
    service,
    status,
    timeRange,
    traceId,
  ]);

  const buildApiParams = useCallback(
    (paginationCursor?: string): Record<string, string | number | boolean | undefined> => ({
      from: timeWindow.from,
      to: timeWindow.to,
      service: service || undefined,
      environment: environment || undefined,
      operation: operation || undefined,
      status: status || undefined,
      minDuration: minDuration || undefined,
      maxDuration: maxDuration || undefined,
      trace_id: traceId || undefined,
      root_service: rootService || undefined,
      http_route: httpRoute || undefined,
      error_only: errorOnly || undefined,
      cursor: paginationCursor,
      limit: PAGE_SIZE,
    }),
    [
      environment,
      errorOnly,
      httpRoute,
      maxDuration,
      minDuration,
      operation,
      rootService,
      service,
      status,
      timeWindow.from,
      timeWindow.to,
      traceId,
    ],
  );

  const fetchTraces = useCallback(
    async (paginationCursor?: string) => {
      try {
        if (paginationCursor) {
          setLoadingMore(true);
        } else {
          setLoading(true);
          setError(null);
        }

        const response = await apiClient<TraceListResponse>('/v1/traces', {
          params: buildApiParams(paginationCursor),
        });

        if (paginationCursor) {
          setTraces((prev) => [...prev, ...response.data]);
        } else {
          setTraces(response.data);
          setLatencyBuckets(response.summary?.latency_buckets ?? DEFAULT_BUCKETS);
        }

        setCursor(response.pagination.cursor);
        setHasMore(response.pagination.hasMore);
      } catch (err) {
        const message = err instanceof ApiError ? err.message : 'Failed to fetch traces';
        setError(message);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [buildApiParams],
  );

  useEffect(() => {
    async function fetchServices() {
      try {
        const response = await apiClient<ServicesResponse>('/v1/services');
        setServices(response.data);
      } catch {
        setServices([]);
      }
    }
    fetchServices();
  }, []);

  useEffect(() => {
    fetchTraces();
  }, [fetchTraces]);

  useEffect(() => {
    const nextUrl = currentUrlParams.toString()
      ? `/traces?${currentUrlParams.toString()}`
      : '/traces';
    router.replace(nextUrl, { scroll: false });
  }, [currentUrlParams, router]);

  function selectTimeRange(nextRange: string) {
    setTimeRange(nextRange);
    setCustomFrom('');
    setCustomTo('');
  }

  function detailHref(trace: TraceSummary) {
    const params = new URLSearchParams(currentUrlParams);
    params.set('from', timeWindow.from);
    params.set('to', timeWindow.to);
    params.delete('range');
    return `/traces/${encodeURIComponent(trace.trace_id)}?${params.toString()}`;
  }

  const maxBucketCount = Math.max(1, ...latencyBuckets.map((bucket) => bucket.count));

  return (
    <div className="min-h-[calc(100vh-5rem)]">
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-white">Trace Explorer</h1>
        <p className="text-sm text-gray-400">
          Search traces, inspect latency, and drill into spans.
        </p>
      </div>

      <div className="mb-5 grid gap-3 rounded-lg border border-surface-border bg-surface-card/40 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="space-y-1 text-xs text-gray-400">
            Time range
            <div className="flex overflow-hidden rounded border border-surface-border">
              {TIME_RANGE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => selectTimeRange(option.value)}
                  className={`px-3 py-2 text-xs transition-colors ${
                    timeRange === option.value
                      ? 'bg-sidebar-active text-white'
                      : 'bg-surface-card text-gray-400 hover:bg-sidebar-hover hover:text-white'
                  }`}
                >
                  {option.label}
                </button>
              ))}
              {timeRange === 'custom' && (
                <span className="bg-sidebar-active px-3 py-2 text-xs text-white">Custom</span>
              )}
            </div>
          </label>

          <label className="space-y-1 text-xs text-gray-400">
            Service
            <input
              list="trace-service-options"
              value={service}
              onChange={(event) => setService(event.target.value)}
              placeholder="Any service"
              className="w-44 rounded border border-surface-border bg-surface px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
            />
          </label>
          <datalist id="trace-service-options">
            {serviceOptions.map((option) => (
              <option key={option} value={option} />
            ))}
          </datalist>

          <label className="space-y-1 text-xs text-gray-400">
            Environment
            <input
              list="trace-environment-options"
              value={environment}
              onChange={(event) => setEnvironment(event.target.value)}
              placeholder="Any env"
              className="w-36 rounded border border-surface-border bg-surface px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
            />
          </label>
          <datalist id="trace-environment-options">
            {environmentOptions.map((option) => (
              <option key={option} value={option} />
            ))}
          </datalist>

          <label className="space-y-1 text-xs text-gray-400">
            Operation
            <input
              value={operation}
              onChange={(event) => setOperation(event.target.value)}
              placeholder="contains..."
              className="w-44 rounded border border-surface-border bg-surface px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
            />
          </label>

          <label className="space-y-1 text-xs text-gray-400">
            Status
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              className="w-28 rounded border border-surface-border bg-surface px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
            >
              <option value="">Any</option>
              <option value="OK">OK</option>
              <option value="ERROR">ERROR</option>
            </select>
          </label>

          <label className="flex items-center gap-2 rounded border border-surface-border bg-surface px-3 py-2 text-sm text-gray-300">
            <input
              type="checkbox"
              checked={errorOnly}
              onChange={(event) => setErrorOnly(event.target.checked)}
              className="h-4 w-4 accent-red-500"
            />
            Errors only
          </label>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <label className="space-y-1 text-xs text-gray-400">
            Min duration
            <input
              type="number"
              min="0"
              value={minDuration}
              onChange={(event) => setMinDuration(event.target.value)}
              placeholder="ms"
              className="w-28 rounded border border-surface-border bg-surface px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
            />
          </label>
          <label className="space-y-1 text-xs text-gray-400">
            Max duration
            <input
              type="number"
              min="0"
              value={maxDuration}
              onChange={(event) => setMaxDuration(event.target.value)}
              placeholder="ms"
              className="w-28 rounded border border-surface-border bg-surface px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
            />
          </label>
          <label className="space-y-1 text-xs text-gray-400">
            Trace ID
            <input
              value={traceId}
              onChange={(event) => setTraceId(event.target.value)}
              placeholder="trace_123"
              className="w-44 rounded border border-surface-border bg-surface px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
            />
          </label>
          <label className="space-y-1 text-xs text-gray-400">
            Root service
            <input
              value={rootService}
              onChange={(event) => setRootService(event.target.value)}
              placeholder="checkout-service"
              className="w-44 rounded border border-surface-border bg-surface px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
            />
          </label>
          <label className="space-y-1 text-xs text-gray-400">
            HTTP route
            <input
              value={httpRoute}
              onChange={(event) => setHttpRoute(event.target.value)}
              placeholder="/api/checkout"
              className="w-44 rounded border border-surface-border bg-surface px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
            />
          </label>
        </div>
      </div>

      <div className="mb-5 rounded-lg border border-surface-border bg-surface-card/30 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">Latency distribution</h2>
          <span className="text-xs text-gray-500">Current result set</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-5">
          {latencyBuckets.map((bucket) => (
            <div key={bucket.bucket} className="space-y-2">
              <div className="h-16 rounded border border-surface-border bg-surface p-2">
                <div className="flex h-full items-end">
                  <div
                    className="w-full rounded-sm bg-blue-500/70"
                    style={{ height: `${Math.max(6, (bucket.count / maxBucketCount) * 100)}%` }}
                  />
                </div>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-400">{bucket.bucket}</span>
                <span className="font-mono text-white">{bucket.count}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-700 bg-red-900/30 p-4 text-sm text-red-300">
          {error}
        </div>
      )}

      {loading && <div className="py-8 text-center text-sm text-gray-400">Loading traces...</div>}

      {!loading && !error && traces.length === 0 && (
        <div className="py-12 text-center">
          <p className="text-sm text-gray-400">No traces match the current filters.</p>
          <p className="mt-1 text-xs text-gray-500">Try widening the time range or filters.</p>
        </div>
      )}

      {!loading && traces.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-surface-border">
          <table className="w-full text-sm">
            <thead className="bg-surface-card text-left">
              <tr className="border-b border-surface-border">
                <th className="px-3 py-3 font-medium text-gray-400">Start time</th>
                <th className="px-3 py-3 font-medium text-gray-400">Trace ID</th>
                <th className="px-3 py-3 font-medium text-gray-400">Root service</th>
                <th className="px-3 py-3 font-medium text-gray-400">Root operation</th>
                <th className="px-3 py-3 font-medium text-gray-400">Duration</th>
                <th className="px-3 py-3 font-medium text-gray-400">Spans</th>
                <th className="px-3 py-3 font-medium text-gray-400">Errors</th>
                <th className="px-3 py-3 font-medium text-gray-400">Services involved</th>
                <th className="px-3 py-3 font-medium text-gray-400">Status</th>
              </tr>
            </thead>
            <tbody>
              {traces.map((trace) => (
                <tr
                  key={trace.trace_id}
                  className="border-b border-surface-border/50 hover:bg-surface-card/50"
                >
                  <td className="whitespace-nowrap px-3 py-3 text-xs text-gray-400">
                    {formatTimestamp(trace.start_time ?? trace.timestamp)}
                  </td>
                  <td className="px-3 py-3">
                    <Link
                      href={detailHref(trace)}
                      className="font-mono text-xs text-blue-400 hover:text-blue-300"
                    >
                      {trace.trace_id.slice(0, 16)}...
                    </Link>
                    {trace.near_deployment && trace.deployment_id && (
                      <Link
                        href={`/deployments/${trace.deployment_id}`}
                        className="ml-2 rounded border border-yellow-800 bg-yellow-950 px-2 py-0.5 text-[10px] text-yellow-300"
                      >
                        Near deployment
                      </Link>
                    )}
                  </td>
                  <td className="px-3 py-3 text-white">{trace.root_service || '—'}</td>
                  <td className="max-w-[260px] truncate px-3 py-3 text-gray-300">
                    {trace.root_operation || '—'}
                  </td>
                  <td className="px-3 py-3 font-mono text-white">
                    {formatDuration(trace.duration_ms)}
                  </td>
                  <td className="px-3 py-3 text-gray-300">{trace.span_count}</td>
                  <td className="px-3 py-3 text-gray-300">{trace.error_count}</td>
                  <td className="max-w-[260px] px-3 py-3 text-xs text-gray-400">
                    {trace.services?.length ? trace.services.join(', ') : '—'}
                  </td>
                  <td className="px-3 py-3">
                    <span
                      className={`rounded border px-2 py-1 text-xs ${statusClass(trace.status)}`}
                    >
                      {trace.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {hasMore && (
            <div className="border-t border-surface-border p-4 text-center">
              <button
                type="button"
                onClick={() => cursor && fetchTraces(cursor)}
                disabled={loadingMore}
                className="rounded-lg border border-surface-border bg-surface-card px-4 py-2 text-sm text-gray-300 transition-colors hover:bg-sidebar-hover hover:text-white disabled:opacity-50"
              >
                {loadingMore ? 'Loading...' : 'Load More'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
