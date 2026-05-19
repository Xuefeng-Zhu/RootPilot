'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { apiClient, ApiError } from '../../lib/api';

interface TraceSummary {
  trace_id: string;
  root_service: string;
  root_operation: string;
  duration_ms: number;
  span_count: number;
  status: string;
  timestamp: string;
}

interface TraceListResponse {
  data: TraceSummary[];
  pagination: {
    cursor: string | null;
    hasMore: boolean;
  };
}

const TIME_RANGE_OPTIONS = [
  { label: '15m', value: '15m', ms: 15 * 60 * 1000 },
  { label: '1h', value: '1h', ms: 60 * 60 * 1000 },
  { label: '6h', value: '6h', ms: 6 * 60 * 60 * 1000 },
  { label: '24h', value: '24h', ms: 24 * 60 * 60 * 1000 },
  { label: '7d', value: '7d', ms: 7 * 24 * 60 * 60 * 1000 },
];

const DEFAULT_TIME_RANGE = '1h';

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  // Filter state
  const [timeRange, setTimeRange] = useState(() =>
    getInitialRange(searchParams as URLSearchParams),
  );
  const [customFrom, setCustomFrom] = useState(() => searchParams.get('from') ?? '');
  const [customTo, setCustomTo] = useState(() => searchParams.get('to') ?? '');
  const [service, setService] = useState(
    () => searchParams.get('service') ?? searchParams.get('service_name') ?? '',
  );
  const [environment, setEnvironment] = useState(() => searchParams.get('environment') ?? '');
  const [minDuration, setMinDuration] = useState(() => searchParams.get('minDuration') ?? '');

  const timeWindow = useMemo(
    () => getTimeWindow(timeRange, customFrom, customTo),
    [customFrom, customTo, timeRange],
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

        const params: Record<string, string | number | boolean | undefined> = {
          from: timeWindow.from,
          to: timeWindow.to,
          limit: 50,
        };

        if (service) {
          params.service = service;
        }

        if (environment) {
          params.environment = environment;
        }

        if (minDuration && Number(minDuration) > 0) {
          params.minDuration = Number(minDuration);
        }

        if (paginationCursor) {
          params.cursor = paginationCursor;
        }

        const response = await apiClient<TraceListResponse>('/v1/traces', { params });

        if (paginationCursor) {
          setTraces((prev) => [...prev, ...response.data]);
        } else {
          setTraces(response.data);
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
    [environment, minDuration, service, timeWindow.from, timeWindow.to],
  );

  useEffect(() => {
    fetchTraces();
  }, [fetchTraces]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (timeRange === 'custom') {
      if (customFrom) params.set('from', customFrom);
      if (customTo) params.set('to', customTo);
    } else {
      params.set('range', timeRange);
    }
    if (service) params.set('service', service);
    if (environment) params.set('environment', environment);
    if (minDuration) params.set('minDuration', minDuration);

    const nextUrl = params.toString() ? `/traces?${params.toString()}` : '/traces';
    router.replace(nextUrl, { scroll: false });
  }, [customFrom, customTo, environment, minDuration, router, service, timeRange]);

  function selectTimeRange(nextRange: string) {
    setTimeRange(nextRange);
    setCustomFrom('');
    setCustomTo('');
  }

  function handleLoadMore() {
    if (cursor) {
      fetchTraces(cursor);
    }
  }

  function formatDuration(ms: number): string {
    if (ms < 1) return '<1ms';
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  }

  function formatTimestamp(ts: string): string {
    const date = new Date(ts);
    return date.toLocaleString();
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-white mb-6">Traces</h1>

      {/* Filter Controls */}
      <div className="flex flex-wrap items-center gap-4 mb-6">
        {/* Time Range */}
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-400">Time Range</label>
          <div className="flex rounded-lg overflow-hidden border border-surface-border">
            {TIME_RANGE_OPTIONS.map((opt) => (
              <button
                key={opt.label}
                onClick={() => selectTimeRange(opt.value)}
                className={`px-3 py-1.5 text-sm transition-colors ${
                  timeRange === opt.value
                    ? 'bg-sidebar-active text-white'
                    : 'bg-surface-card text-gray-400 hover:text-white hover:bg-sidebar-hover'
                }`}
              >
                {opt.label}
              </button>
            ))}
            {timeRange === 'custom' && (
              <span className="px-3 py-1.5 text-sm bg-sidebar-active text-white">Custom</span>
            )}
          </div>
        </div>

        {/* Service Filter */}
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-400">Service</label>
          <input
            type="text"
            value={service}
            onChange={(e) => setService(e.target.value)}
            placeholder="All services"
            className="px-3 py-1.5 text-sm bg-surface-card border border-surface-border rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
          />
        </div>

        {/* Environment Filter */}
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-400">Environment</label>
          <input
            type="text"
            value={environment}
            onChange={(e) => setEnvironment(e.target.value)}
            placeholder="All environments"
            className="px-3 py-1.5 text-sm bg-surface-card border border-surface-border rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
          />
        </div>

        {/* Min Duration Filter */}
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-400">Min Duration (ms)</label>
          <input
            type="number"
            value={minDuration}
            onChange={(e) => setMinDuration(e.target.value)}
            placeholder="0"
            min="0"
            max="999999"
            className="px-3 py-1.5 text-sm bg-surface-card border border-surface-border rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 w-28"
          />
        </div>
      </div>

      {/* Error State */}
      {error && (
        <div className="mb-4 p-4 bg-red-900/30 border border-red-700 rounded-lg text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* Loading State */}
      {loading && <div className="text-gray-400 text-sm py-8 text-center">Loading traces...</div>}

      {/* Empty State */}
      {!loading && !error && traces.length === 0 && (
        <div className="text-center py-12">
          <p className="text-gray-400 text-sm">No traces match the current filters.</p>
          <p className="text-gray-500 text-xs mt-1">Try adjusting the time range or filters.</p>
        </div>
      )}

      {/* Trace List Table */}
      {!loading && traces.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-border text-left">
                <th className="pb-3 pr-4 text-gray-400 font-medium">Trace ID</th>
                <th className="pb-3 pr-4 text-gray-400 font-medium">Root Service</th>
                <th className="pb-3 pr-4 text-gray-400 font-medium">Root Operation</th>
                <th className="pb-3 pr-4 text-gray-400 font-medium">Duration</th>
                <th className="pb-3 pr-4 text-gray-400 font-medium">Spans</th>
                <th className="pb-3 text-gray-400 font-medium">Timestamp</th>
              </tr>
            </thead>
            <tbody>
              {traces.map((trace) => (
                <tr
                  key={trace.trace_id}
                  className="border-b border-surface-border/50 hover:bg-surface-card/50 transition-colors"
                >
                  <td className="py-3 pr-4">
                    <Link
                      href={`/traces/${trace.trace_id}`}
                      className="text-blue-400 hover:text-blue-300 font-mono text-xs"
                    >
                      {trace.trace_id.slice(0, 16)}...
                    </Link>
                  </td>
                  <td className="py-3 pr-4 text-white">{trace.root_service || '—'}</td>
                  <td className="py-3 pr-4 text-gray-300">{trace.root_operation || '—'}</td>
                  <td className="py-3 pr-4 text-white font-mono">
                    {formatDuration(trace.duration_ms)}
                  </td>
                  <td className="py-3 pr-4 text-gray-300">{trace.span_count}</td>
                  <td className="py-3 text-gray-400 text-xs">{formatTimestamp(trace.timestamp)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Load More */}
          {hasMore && (
            <div className="mt-4 text-center">
              <button
                onClick={handleLoadMore}
                disabled={loadingMore}
                className="px-4 py-2 text-sm bg-surface-card border border-surface-border rounded-lg text-gray-300 hover:text-white hover:bg-sidebar-hover transition-colors disabled:opacity-50"
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
