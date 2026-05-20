'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import type {
  CanonicalLog,
  LogAroundResponse,
  LogFacetCollection,
  LogFacetName,
  LogGroup,
  LogGroupsResponse,
  LogQueryResponse,
  LogSummary,
} from '@rootpilot/shared';
import { SelectControl } from '../../components/select-control';
import { apiClient, ApiError } from '../../lib/api';

type LogEntry = CanonicalLog;

interface ServiceEntry {
  service_name: string;
  environment: string;
}

interface ServicesResponse {
  data: ServiceEntry[];
}

interface AttributeFilter {
  key: string;
  value: string;
}

interface SavedQueryFilters {
  timeRange: string;
  customFrom: string;
  customTo: string;
  service: string;
  environment: string;
  severity: string;
  traceId: string;
  spanId: string;
  errorType: string;
  fingerprint: string;
  version: string;
  search: string;
  attributeFilters: AttributeFilter[];
}

interface SavedLogQuery {
  id: string;
  name: string;
  filters: SavedQueryFilters;
}

const TIME_RANGE_OPTIONS = [
  { label: '15m', value: '15m', ms: 15 * 60 * 1000 },
  { label: '30m', value: '30m', ms: 30 * 60 * 1000 },
  { label: '1h', value: '1h', ms: 60 * 60 * 1000 },
  { label: '6h', value: '6h', ms: 6 * 60 * 60 * 1000 },
  { label: '24h', value: '24h', ms: 24 * 60 * 60 * 1000 },
  { label: '7d', value: '7d', ms: 7 * 24 * 60 * 60 * 1000 },
] as const;

const SEVERITY_OPTIONS = ['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'] as const;
const PAGE_SIZE = 50;
const SAVED_QUERIES_KEY = 'rootpilot.logs.savedQueries.v1';

const EMPTY_FACETS: LogFacetCollection = {
  services: [],
  severities: [],
  environments: [],
  error_types: [],
  http_routes: [],
  fingerprints: [],
  versions: [],
};

const SEVERITY_COLORS: Record<string, string> = {
  TRACE: 'bg-gray-700 text-gray-200',
  DEBUG: 'bg-blue-950 text-blue-300',
  INFO: 'bg-green-950 text-green-300',
  WARN: 'bg-yellow-950 text-yellow-300',
  ERROR: 'bg-red-950 text-red-300',
  FATAL: 'bg-purple-950 text-purple-300',
};

const DEFAULT_SAVED_QUERIES: SavedLogQuery[] = [
  {
    id: 'default-checkout-errors',
    name: 'Checkout errors last 30m',
    filters: makeEmptyFilters({ timeRange: '30m', service: 'checkout-service', severity: 'ERROR' }),
  },
  {
    id: 'default-payment-timeouts',
    name: 'Payment timeouts',
    filters: makeEmptyFilters({ timeRange: '1h', search: 'timeout', errorType: 'PaymentTimeout' }),
  },
  {
    id: 'default-trace-id',
    name: 'Logs for trace ID',
    filters: makeEmptyFilters({ timeRange: '1h', traceId: 'trace_123' }),
  },
];

export default function LogsExplorerPage() {
  return (
    <Suspense
      fallback={<div className="text-gray-400 text-sm py-8 text-center">Loading logs...</div>}
    >
      <LogsExplorerContent />
    </Suspense>
  );
}

function LogsExplorerContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [timeRange, setTimeRange] = useState(() =>
    searchParams.get('from') || searchParams.get('to')
      ? 'custom'
      : (searchParams.get('range') ?? '1h'),
  );
  const [customFrom, setCustomFrom] = useState(() =>
    toDatetimeLocalValue(searchParams.get('from')),
  );
  const [customTo, setCustomTo] = useState(() => toDatetimeLocalValue(searchParams.get('to')));
  const [service, setService] = useState(() => searchParams.get('service_name') ?? '');
  const [environment, setEnvironment] = useState(() => searchParams.get('environment') ?? '');
  const [severity, setSeverity] = useState(() => searchParams.get('severity')?.toUpperCase() ?? '');
  const [traceId, setTraceId] = useState(() => searchParams.get('trace_id') ?? '');
  const [spanId, setSpanId] = useState(() => searchParams.get('span_id') ?? '');
  const [errorType, setErrorType] = useState(() => searchParams.get('error_type') ?? '');
  const [fingerprint, setFingerprint] = useState(() => searchParams.get('fingerprint') ?? '');
  const [version, setVersion] = useState(() => searchParams.get('version') ?? '');
  const [search, setSearch] = useState(() => searchParams.get('search') ?? '');
  const [searchInput, setSearchInput] = useState(() => searchParams.get('search') ?? '');
  const [attributeFilters, setAttributeFilters] = useState<AttributeFilter[]>(() =>
    parseAttributeFilters(searchParams.get('attribute_filters')),
  );

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [groups, setGroups] = useState<LogGroup[]>([]);
  const [summary, setSummary] = useState<LogSummary | null>(null);
  const [facets, setFacets] = useState<LogFacetCollection>(EMPTY_FACETS);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nearbyLabel, setNearbyLabel] = useState<string | null>(null);

  const [services, setServices] = useState<ServiceEntry[]>([]);
  const [environments, setEnvironments] = useState<string[]>([]);
  const [selectedLog, setSelectedLog] = useState<LogEntry | null>(null);
  const [viewMode, setViewMode] = useState<'logs' | 'groups'>('logs');
  const [live, setLive] = useState(false);
  const [savedQueries, setSavedQueries] = useState<SavedLogQuery[]>(DEFAULT_SAVED_QUERIES);
  const [saveName, setSaveName] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const logScrollRef = useRef<HTMLDivElement | null>(null);
  const infiniteLoaderRef = useRef<HTMLDivElement | null>(null);
  const loadingMoreRef = useRef(false);

  const filterSnapshot = useMemo(
    (): SavedQueryFilters => ({
      timeRange,
      customFrom,
      customTo,
      service,
      environment,
      severity,
      traceId,
      spanId,
      errorType,
      fingerprint,
      version,
      search,
      attributeFilters,
    }),
    [
      attributeFilters,
      customFrom,
      customTo,
      environment,
      errorType,
      fingerprint,
      search,
      service,
      severity,
      spanId,
      timeRange,
      traceId,
      version,
    ],
  );

  const activeFilters = useMemo(
    () =>
      buildActiveFilters(filterSnapshot, {
        setService,
        setEnvironment,
        setSeverity,
        setTraceId,
        setSpanId,
        setErrorType,
        setFingerprint,
        setVersion,
        setSearch,
        setSearchInput,
        setAttributeFilters,
      }),
    [filterSnapshot],
  );

  const selectedTimeRangeLabel = useMemo(() => {
    if (timeRange === 'custom') {
      return `${customFrom || 'custom start'} to ${customTo || 'now'}`;
    }
    return TIME_RANGE_OPTIONS.find((option) => option.value === timeRange)?.label ?? '1h';
  }, [customFrom, customTo, timeRange]);

  const getTimeRange = useCallback((): { from: string; to: string } => {
    if (timeRange === 'custom') {
      return {
        from: customFrom
          ? new Date(customFrom).toISOString()
          : new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        to: customTo ? new Date(customTo).toISOString() : new Date().toISOString(),
      };
    }
    const option = TIME_RANGE_OPTIONS.find((entry) => entry.value === timeRange);
    const ms = option?.ms ?? 60 * 60 * 1000;
    const now = new Date();
    return {
      from: new Date(now.getTime() - ms).toISOString(),
      to: now.toISOString(),
    };
  }, [customFrom, customTo, timeRange]);

  const buildLogParams = useCallback(
    (pageCursor?: string | null): Record<string, string | number | boolean | undefined> => {
      const { from, to } = getTimeRange();
      const params: Record<string, string | number | boolean | undefined> = {
        from,
        to,
        limit: PAGE_SIZE,
      };

      if (service) params.service_name = service;
      if (environment) params.environment = environment;
      if (severity) params.severity = severity;
      if (search) params.search = search;
      if (traceId) params.trace_id = traceId;
      if (spanId) params.span_id = spanId;
      if (errorType) params.error_type = errorType;
      if (fingerprint) params.fingerprint = fingerprint;
      if (version) params.version = version;
      if (attributeFilters.length > 0) params.attribute_filters = JSON.stringify(attributeFilters);
      if (pageCursor) params.cursor = pageCursor;

      return params;
    },
    [
      attributeFilters,
      environment,
      errorType,
      fingerprint,
      getTimeRange,
      search,
      service,
      severity,
      spanId,
      traceId,
      version,
    ],
  );

  const fetchLogs = useCallback(
    async (append = false, pageCursor?: string | null) => {
      if (append && loadingMoreRef.current) return;

      if (append) {
        loadingMoreRef.current = true;
        setLoadingMore(true);
      } else {
        setLoading(true);
        setNearbyLabel(null);
      }
      setError(null);

      try {
        const response = await apiClient<LogQueryResponse>('/v1/logs', {
          params: buildLogParams(append ? pageCursor : null),
        });

        setLogs((previous) => (append ? [...previous, ...response.data] : response.data));
        setGroups([]);
        setCursor(response.pagination.cursor);
        setHasMore(response.pagination.hasMore);
        setSummary(response.summary ?? null);
        setFacets(response.facets ?? EMPTY_FACETS);
      } catch (err) {
        const message =
          err instanceof ApiError ? err.message : 'Failed to fetch logs. Please try again.';
        setError(message);
      } finally {
        setLoading(false);
        setLoadingMore(false);
        loadingMoreRef.current = false;
      }
    },
    [buildLogParams],
  );

  const fetchGroups = useCallback(async () => {
    setLoading(true);
    setNearbyLabel(null);
    setError(null);

    try {
      const params = buildLogParams(null);
      params.limit = 100;

      const response = await apiClient<LogGroupsResponse>('/v1/logs/groups', { params });
      setGroups(response.data);
      setLogs([]);
      setHasMore(false);
      setCursor(null);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to fetch log groups.';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [buildLogParams]);

  const fetchLiveLogs = useCallback(async () => {
    if (viewMode !== 'logs') return;

    try {
      const response = await apiClient<LogQueryResponse>('/v1/logs', {
        params: buildLogParams(null),
      });
      setLogs((previous) => {
        const existingIds = new Set(previous.map((log) => log.id));
        const newRows = response.data.filter((log) => !existingIds.has(log.id));
        return [...newRows, ...previous].slice(0, 500);
      });
      setSummary(response.summary ?? null);
      setFacets(response.facets ?? EMPTY_FACETS);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to refresh live logs.';
      setError(message);
    }
  }, [buildLogParams, viewMode]);

  useEffect(() => {
    async function fetchServices() {
      try {
        const response = await apiClient<ServicesResponse>('/v1/services');
        setServices(response.data);
        setEnvironments([
          ...new Set(response.data.map((entry) => entry.environment).filter(Boolean)),
        ]);
      } catch {
        setServices([]);
      }
    }

    fetchServices();
  }, []);

  useEffect(() => {
    const stored = loadSavedQueries();
    if (stored.length > 0) {
      setSavedQueries(stored);
    }
  }, []);

  useEffect(() => {
    if (viewMode === 'groups') {
      fetchGroups();
      return;
    }
    fetchLogs(false);
  }, [fetchGroups, fetchLogs, viewMode]);

  useEffect(() => {
    if (!live || viewMode !== 'logs') return;

    const interval = window.setInterval(() => {
      fetchLiveLogs();
    }, 5000);

    return () => window.clearInterval(interval);
  }, [fetchLiveLogs, live, viewMode]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (timeRange !== 'custom') {
      params.set('range', timeRange);
    }
    if (timeRange === 'custom') {
      if (customFrom) params.set('from', new Date(customFrom).toISOString());
      if (customTo) params.set('to', new Date(customTo).toISOString());
    }
    if (service) params.set('service_name', service);
    if (environment) params.set('environment', environment);
    if (severity) params.set('severity', severity);
    if (traceId) params.set('trace_id', traceId);
    if (spanId) params.set('span_id', spanId);
    if (errorType) params.set('error_type', errorType);
    if (fingerprint) params.set('fingerprint', fingerprint);
    if (version) params.set('version', version);
    if (search) params.set('search', search);
    if (attributeFilters.length > 0)
      params.set('attribute_filters', JSON.stringify(attributeFilters));

    const nextUrl = params.toString() ? `/logs?${params.toString()}` : '/logs';
    router.replace(nextUrl, { scroll: false });
  }, [
    attributeFilters,
    customFrom,
    customTo,
    environment,
    errorType,
    fingerprint,
    router,
    search,
    service,
    severity,
    spanId,
    timeRange,
    traceId,
    version,
  ]);

  useEffect(
    () => () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    },
    [],
  );

  const loadMoreLogs = useCallback(() => {
    if (hasMore && cursor) {
      fetchLogs(true, cursor);
    }
  }, [cursor, fetchLogs, hasMore]);

  useEffect(() => {
    const loader = infiniteLoaderRef.current;
    if (!loader || !hasMore || loading || loadingMore || viewMode !== 'logs') return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          loadMoreLogs();
        }
      },
      {
        root: logScrollRef.current,
        rootMargin: '240px 0px',
        threshold: 0,
      },
    );

    observer.observe(loader);
    return () => observer.disconnect();
  }, [hasMore, loadMoreLogs, loading, loadingMore, viewMode]);

  function handleSearchChange(value: string) {
    setSearchInput(value);
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    searchTimeoutRef.current = setTimeout(() => {
      setSearch(value);
      searchTimeoutRef.current = null;
    }, 350);
  }

  function cancelPendingSearchDebounce() {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
      searchTimeoutRef.current = null;
    }
  }

  function handleTimeRangeChange(value: string) {
    setTimeRange(value);
    if (value === 'custom') setAdvancedOpen(true);
  }

  function addAttributeFilter(filter: AttributeFilter = { key: '', value: '' }) {
    setAttributeFilters((previous) => [...previous, filter]);
  }

  function updateAttributeFilter(index: number, patch: Partial<AttributeFilter>) {
    setAttributeFilters((previous) =>
      previous.map((filter, filterIndex) =>
        filterIndex === index ? { ...filter, ...patch } : filter,
      ),
    );
  }

  function removeAttributeFilter(index: number) {
    setAttributeFilters((previous) => previous.filter((_, filterIndex) => filterIndex !== index));
  }

  function applyFacet(facet: LogFacetName, value: string) {
    setViewMode('logs');
    setNearbyLabel(null);
    if (facet === 'services') setService(value);
    if (facet === 'severities') setSeverity(value);
    if (facet === 'environments') setEnvironment(value);
    if (facet === 'error_types') setErrorType(value);
    if (facet === 'http_routes') {
      setAttributeFilters((previous) => upsertAttributeFilter(previous, 'http.route', value));
    }
    if (facet === 'fingerprints') setFingerprint(value);
    if (facet === 'versions') setVersion(value);
  }

  function clearFilters() {
    cancelPendingSearchDebounce();
    setService('');
    setEnvironment('');
    setSeverity('');
    setTraceId('');
    setSpanId('');
    setErrorType('');
    setFingerprint('');
    setVersion('');
    setSearch('');
    setSearchInput('');
    setAttributeFilters([]);
    setNearbyLabel(null);
    setViewMode('logs');
  }

  function applySavedQuery(query: SavedLogQuery) {
    cancelPendingSearchDebounce();
    setTimeRange(query.filters.timeRange);
    setCustomFrom(query.filters.customFrom);
    setCustomTo(query.filters.customTo);
    setService(query.filters.service);
    setEnvironment(query.filters.environment);
    setSeverity(query.filters.severity);
    setTraceId(query.filters.traceId);
    setSpanId(query.filters.spanId);
    setErrorType(query.filters.errorType);
    setFingerprint(query.filters.fingerprint);
    setVersion(query.filters.version);
    setSearch(query.filters.search);
    setSearchInput(query.filters.search);
    setAttributeFilters(query.filters.attributeFilters);
    setViewMode('logs');
  }

  function saveCurrentQuery() {
    const trimmedName = saveName.trim();
    if (!trimmedName) return;

    const nextQueries = [
      ...savedQueries,
      {
        id: `query-${Date.now()}`,
        name: trimmedName,
        filters: filterSnapshot,
      },
    ];
    setSavedQueries(nextQueries);
    persistSavedQueries(nextQueries);
    setSaveName('');
  }

  function deleteSavedQuery(id: string) {
    const nextQueries = savedQueries.filter((query) => query.id !== id);
    setSavedQueries(nextQueries);
    persistSavedQueries(nextQueries);
  }

  async function handleViewNearby(log: LogEntry) {
    setLoading(true);
    setError(null);
    setSelectedLog(null);
    setViewMode('logs');

    try {
      const response = await apiClient<LogAroundResponse>('/v1/logs/around', {
        params: {
          log_id: log.id,
          trace_id: log.trace_id || undefined,
          before_seconds: 300,
          after_seconds: 300,
        },
      });
      setLogs(response.data);
      setGroups([]);
      setHasMore(false);
      setCursor(null);
      setNearbyLabel(`Nearby logs around ${formatTimestamp(log.timestamp)}`);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to fetch nearby logs.';
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex h-full min-h-[calc(100vh-6.5rem)] flex-col overflow-hidden">
      <div className="shrink-0 pb-4">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-white">Logs Explorer</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
              {live && <span className="font-medium text-emerald-300">Live tail active</span>}
              {nearbyLabel && <span className="text-cyan-300">{nearbyLabel}</span>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setAdvancedOpen((open) => !open)}
              className={`rp-button h-9 px-3 text-xs ${
                advancedOpen ? 'border-cyan-400/50 bg-cyan-400/10 text-cyan-100' : ''
              }`}
              aria-expanded={advancedOpen}
            >
              Advanced filters
            </button>
            <label className="rp-button h-9 cursor-pointer gap-2 px-3 text-xs">
              <input
                type="checkbox"
                checked={live}
                onChange={(event) => setLive(event.target.checked)}
                className="h-3.5 w-3.5 accent-cyan-400"
              />
              Live
            </label>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <SelectControl
            value={timeRange}
            onChange={handleTimeRangeChange}
            aria-label="Select log time range"
            triggerClassName="min-w-44"
            options={[
              ...TIME_RANGE_OPTIONS.map((option) => ({
                label: `Last ${option.label}`,
                value: option.value,
              })),
              { label: 'Custom range', value: 'custom' },
            ]}
          />

          <SelectControl
            value={service}
            onChange={setService}
            aria-label="Select log service"
            triggerClassName="min-w-40"
            options={[
              { label: 'All Services', value: '' },
              ...[...new Set(services.map((entry) => entry.service_name))].map((serviceName) => ({
                label: serviceName,
                value: serviceName,
              })),
            ]}
          />

          <SelectControl
            value={environment}
            onChange={setEnvironment}
            aria-label="Select log environment"
            triggerClassName="min-w-32"
            options={[
              { label: 'All Environments', value: '' },
              ...environments.map((env) => ({
                label: env,
                value: env,
              })),
            ]}
          />

          <SelectControl
            value={severity}
            onChange={setSeverity}
            aria-label="Select log severity"
            triggerClassName="min-w-36"
            options={[
              { label: 'All Severities', value: '' },
              ...SEVERITY_OPTIONS.map((option) => ({
                label: option,
                value: option,
              })),
            ]}
          />

          <div className="relative min-w-64 flex-1">
            <input
              type="text"
              placeholder="Search logs..."
              value={searchInput}
              onChange={(event) => handleSearchChange(event.target.value)}
              className="rp-input h-10 w-full pl-9"
              aria-label="Search logs"
            />
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          </div>
        </div>

        {advancedOpen && (
          <div className="mt-3 rounded-lg border border-surface-border bg-surface-card/70 p-3 shadow-panel">
            <div className="grid gap-3 lg:grid-cols-5">
              <AdvancedField label="Trace ID">
                <input
                  value={traceId}
                  onChange={(event) => setTraceId(event.target.value)}
                  placeholder="trace_id"
                  className="rp-input h-9 w-full text-xs"
                />
              </AdvancedField>
              <AdvancedField label="Span ID">
                <input
                  value={spanId}
                  onChange={(event) => setSpanId(event.target.value)}
                  placeholder="span_id"
                  className="rp-input h-9 w-full text-xs"
                />
              </AdvancedField>
              <AdvancedField label="Error type">
                <input
                  value={errorType}
                  onChange={(event) => setErrorType(event.target.value)}
                  placeholder="error type"
                  className="rp-input h-9 w-full text-xs"
                />
              </AdvancedField>
              <AdvancedField label="Fingerprint">
                <input
                  value={fingerprint}
                  onChange={(event) => setFingerprint(event.target.value)}
                  placeholder="fingerprint"
                  className="rp-input h-9 w-full text-xs"
                />
              </AdvancedField>
              <AdvancedField label="Version">
                <input
                  value={version}
                  onChange={(event) => setVersion(event.target.value)}
                  placeholder="version"
                  className="rp-input h-9 w-full text-xs"
                />
              </AdvancedField>
            </div>

            <div className="mt-3 flex flex-wrap items-end gap-3">
              {timeRange === 'custom' && (
                <>
                  <AdvancedField label="From">
                    <input
                      type="datetime-local"
                      value={customFrom}
                      onChange={(event) => setCustomFrom(event.target.value)}
                      className="rp-input h-9 text-xs"
                    />
                  </AdvancedField>
                  <AdvancedField label="To">
                    <input
                      type="datetime-local"
                      value={customTo}
                      onChange={(event) => setCustomTo(event.target.value)}
                      className="rp-input h-9 text-xs"
                    />
                  </AdvancedField>
                </>
              )}

              <div className="flex flex-wrap items-center gap-2">
                {SEVERITY_OPTIONS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setSeverity((current) => (current === option ? '' : option))}
                    className={`rounded px-2.5 py-1 text-xs font-medium ${
                      severity === option
                        ? SEVERITY_COLORS[option]
                        : 'bg-surface-subtle text-slate-500 hover:text-slate-200'
                    }`}
                  >
                    {option.toLowerCase()}
                  </button>
                ))}
              </div>

              <div className="ml-auto flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setViewMode('logs')}
                  className={`rp-button h-8 px-3 text-xs ${
                    viewMode === 'logs' ? 'border-cyan-400/50 bg-cyan-400/10 text-cyan-100' : ''
                  }`}
                >
                  Logs
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('groups')}
                  className={`rp-button h-8 px-3 text-xs ${
                    viewMode === 'groups' ? 'border-cyan-400/50 bg-cyan-400/10 text-cyan-100' : ''
                  }`}
                >
                  Groups
                </button>
              </div>
            </div>

            <div className="mt-3 space-y-2">
              {attributeFilters.map((filter, index) => (
                <div key={`${index}-${filter.key}`} className="flex flex-wrap items-center gap-2">
                  <input
                    value={filter.key}
                    onChange={(event) => updateAttributeFilter(index, { key: event.target.value })}
                    placeholder="attribute key"
                    className="rp-input h-8 w-48 text-xs"
                  />
                  <span className="text-xs text-slate-500">=</span>
                  <input
                    value={filter.value}
                    onChange={(event) =>
                      updateAttributeFilter(index, { value: event.target.value })
                    }
                    placeholder="attribute value"
                    className="rp-input h-8 w-56 text-xs"
                  />
                  <button
                    type="button"
                    onClick={() => removeAttributeFilter(index)}
                    className="rp-button h-8 px-2 text-xs"
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => addAttributeFilter()}
                className="rp-button h-8 px-3 text-xs"
              >
                Add attribute filter
              </button>
            </div>

            <div className="mt-3 border-t border-surface-border pt-3">
              <SavedQueriesBar
                savedQueries={savedQueries}
                saveName={saveName}
                onSaveNameChange={setSaveName}
                onSave={saveCurrentQuery}
                onApply={applySavedQuery}
                onDelete={deleteSavedQuery}
              />
            </div>
          </div>
        )}

        <SummaryBar
          summary={summary}
          timeRangeLabel={selectedTimeRangeLabel}
          activeFilters={activeFilters}
          nearbyLabel={nearbyLabel}
          onClearNearby={() => fetchLogs(false)}
        />
      </div>

      <div
        className={`grid min-h-0 flex-1 grid-cols-1 overflow-hidden rounded-lg border border-surface-border bg-surface/35 ${
          selectedLog
            ? 'xl:grid-cols-[260px_minmax(0,1fr)_360px]'
            : 'xl:grid-cols-[260px_minmax(0,1fr)]'
        }`}
      >
        <FacetsSidebar facets={facets} onSelect={applyFacet} onClear={clearFilters} />

        <div className="flex min-h-0 flex-col border-l border-surface-border">
          {error && (
            <div className="m-3 rounded border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-200">
              {error}
            </div>
          )}

          <div ref={logScrollRef} className="min-h-0 flex-1 overflow-auto">
            {loading ? (
              <div className="flex items-center justify-center py-16">
                <div className="text-sm text-slate-400">
                  {viewMode === 'groups' ? 'Loading log groups...' : 'Loading logs...'}
                </div>
              </div>
            ) : viewMode === 'groups' ? (
              <LogGroupsTable groups={groups} onSelectFingerprint={setFingerprint} />
            ) : logs.length === 0 && !error ? (
              <div className="flex items-center justify-center py-16">
                <div className="text-center">
                  <p className="text-sm text-slate-300">No results found</p>
                  <p className="mt-1 text-xs text-slate-500">
                    Try adjusting your filters or time range
                  </p>
                </div>
              </div>
            ) : (
              <LogsTable
                logs={logs}
                selectedLogId={selectedLog?.id}
                onSelectLog={setSelectedLog}
                onCopy={copyText}
              />
            )}

            {viewMode === 'logs' && hasMore && (
              <div
                ref={infiniteLoaderRef}
                data-testid="logs-infinite-loader"
                className="flex min-h-14 items-center justify-center py-4"
                aria-live="polite"
              >
                {loadingMore && <div className="text-sm text-slate-400">Loading more logs...</div>}
              </div>
            )}
          </div>
        </div>

        {selectedLog && (
          <LogDetailDrawer
            log={selectedLog}
            onClose={() => setSelectedLog(null)}
            onCopy={copyText}
            onViewNearby={handleViewNearby}
            onSelectFingerprint={(nextFingerprint) => {
              setFingerprint(nextFingerprint);
              setSelectedLog(null);
            }}
          />
        )}
      </div>
    </div>
  );
}

function FacetsSidebar({
  facets,
  onSelect,
  onClear,
}: {
  facets: LogFacetCollection;
  onSelect: (facet: LogFacetName, value: string) => void;
  onClear: () => void;
}) {
  const [serviceFacetSearch, setServiceFacetSearch] = useState('');
  const sections: Array<{ key: LogFacetName; label: string }> = [
    { key: 'services', label: 'Services' },
    { key: 'severities', label: 'Severities' },
    { key: 'environments', label: 'Environments' },
    { key: 'error_types', label: 'Error types' },
    { key: 'fingerprints', label: 'Fingerprints' },
    { key: 'http_routes', label: 'HTTP routes' },
    { key: 'versions', label: 'Versions' },
  ];

  return (
    <aside className="min-h-0 overflow-auto bg-surface-card/45 p-4">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-200">Facets</h2>
        <button type="button" onClick={onClear} className="text-xs text-cyan-300 hover:text-white">
          Clear all
        </button>
      </div>
      <div className="space-y-5">
        {sections.map((section) => {
          const values =
            section.key === 'services' && serviceFacetSearch
              ? facets[section.key].filter((facet) =>
                  facet.value.toLowerCase().includes(serviceFacetSearch.toLowerCase()),
                )
              : facets[section.key];

          return (
            <div key={section.key}>
              <p className="mb-2 text-xs font-semibold text-slate-300">
                {section.key === 'services' ? 'Service' : section.label}
              </p>
              {section.key === 'services' && (
                <div className="relative mb-3">
                  <input
                    value={serviceFacetSearch}
                    onChange={(event) => setServiceFacetSearch(event.target.value)}
                    placeholder="Search values"
                    className="rp-input h-9 w-full pl-8 text-xs"
                  />
                  <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
                </div>
              )}
              <div className="space-y-1.5">
                {values.length === 0 ? (
                  <p className="px-2 py-1 text-xs text-slate-600">No values</p>
                ) : (
                  values.map((facet) => (
                    <button
                      key={`${section.key}-${facet.value}`}
                      onClick={() => onSelect(section.key, facet.value)}
                      className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left text-sm text-slate-400 hover:bg-surface-raised/70 hover:text-white"
                    >
                      <span className="flex min-w-0 items-center gap-2 truncate">
                        {section.key === 'severities' && (
                          <span
                            className={`h-3.5 w-3.5 rounded ${severityDotClass(facet.value)}`}
                          />
                        )}
                        <span className="truncate">{facet.value}</span>
                      </span>
                      <span className="shrink-0 font-mono text-xs text-slate-500">
                        {formatFacetCount(facet.count)}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

function AdvancedField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="space-y-1 text-xs text-slate-500">
      <span>{label}</span>
      {children}
    </label>
  );
}

function SummaryBar({
  summary,
  timeRangeLabel,
  activeFilters,
  nearbyLabel,
  onClearNearby,
}: {
  summary: LogSummary | null;
  timeRangeLabel: string;
  activeFilters: Array<{ key: string; label: string; onRemove: () => void }>;
  nearbyLabel: string | null;
  onClearNearby: () => void;
}) {
  return (
    <div className="mt-3 rounded-md border border-surface-border/80 bg-surface-subtle/45 px-3 py-2">
      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
        <span>
          <span className="font-semibold text-white">{summary?.total ?? 0}</span> matching logs
        </span>
        <span>
          <span className="font-semibold text-red-300">{summary?.error_count ?? 0}</span> errors
        </span>
        <span>
          <span className="font-semibold text-amber-300">{summary?.warning_count ?? 0}</span>{' '}
          warnings
        </span>
        <span>{timeRangeLabel}</span>
        {nearbyLabel && (
          <button onClick={onClearNearby} className="text-blue-300 hover:text-blue-200">
            Clear nearby results
          </button>
        )}
      </div>
      {activeFilters.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {activeFilters.map((filter) => (
            <button
              key={filter.key}
              onClick={filter.onRemove}
              className="max-w-full truncate rounded bg-surface-raised px-2 py-1 text-xs text-slate-300 hover:text-white"
              title="Remove filter"
            >
              {filter.label} ×
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SavedQueriesBar({
  savedQueries,
  saveName,
  onSaveNameChange,
  onSave,
  onApply,
  onDelete,
}: {
  savedQueries: SavedLogQuery[];
  saveName: string;
  onSaveNameChange: (value: string) => void;
  onSave: () => void;
  onApply: (query: SavedLogQuery) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        value={saveName}
        onChange={(event) => onSaveNameChange(event.target.value)}
        placeholder="Saved query name"
        className="rp-input h-8 min-w-44 text-xs"
      />
      <button
        onClick={onSave}
        disabled={!saveName.trim()}
        className="rp-button h-8 px-3 text-xs disabled:opacity-50"
      >
        Save current
      </button>
      {savedQueries.map((query) => (
        <span
          key={query.id}
          className="inline-flex items-center gap-1 rounded-md border border-surface-border bg-surface-subtle px-2 py-1 text-xs"
        >
          <button onClick={() => onApply(query)} className="text-gray-300 hover:text-white">
            {query.name}
          </button>
          <button
            onClick={() => onDelete(query.id)}
            className="text-gray-500 hover:text-red-300"
            aria-label={`Delete ${query.name}`}
          >
            ×
          </button>
        </span>
      ))}
    </div>
  );
}

function LogsTable({
  logs,
  selectedLogId,
  onSelectLog,
  onCopy,
}: {
  logs: LogEntry[];
  selectedLogId?: string;
  onSelectLog: (log: LogEntry) => void;
  onCopy: (value: string) => void;
}) {
  return (
    <table className="w-full min-w-[820px] text-sm">
      <thead className="sticky top-0 z-10 border-b border-surface-border bg-surface-raised/80 backdrop-blur">
        <tr>
          {[
            'Timestamp',
            'Severity',
            'Service',
            'Message',
            'Trace ID',
            'Environment',
            'Span',
            'Fingerprint',
            'Attributes',
            '',
          ].map((heading) => (
            <th
              key={heading}
              className={`px-4 py-3 text-left text-xs font-medium text-slate-400 ${
                ['Environment', 'Span', 'Fingerprint', 'Attributes', ''].includes(heading)
                  ? 'hidden 2xl:table-cell'
                  : ''
              }`}
            >
              {heading}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-surface-border/80">
        {logs.map((log) => (
          <tr
            key={log.id}
            onClick={() => onSelectLog(log)}
            className={`cursor-pointer transition-colors hover:bg-surface-raised/45 ${
              selectedLogId === log.id ? 'bg-cyan-400/5' : ''
            }`}
          >
            <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-slate-400">
              {formatTimestamp(log.timestamp)}
            </td>
            <td className="px-4 py-3">
              <SeverityBadge severity={log.severity} />
            </td>
            <td className="max-w-[150px] truncate px-4 py-3 text-sm text-slate-300">
              {log.service_name || '—'}
            </td>
            <td className="max-w-[420px] truncate px-4 py-3 text-sm text-slate-300">
              {log.message || '—'}
            </td>
            <td className="px-4 py-3 font-mono text-xs">
              <LinkedId
                href={log.trace_id ? `/traces/${log.trace_id}` : ''}
                value={log.trace_id}
                onCopy={onCopy}
              />
            </td>
            <td className="hidden max-w-[110px] truncate px-4 py-3 text-xs text-slate-400 2xl:table-cell">
              {log.environment || '—'}
            </td>
            <td className="hidden px-4 py-3 font-mono text-xs 2xl:table-cell">
              <LinkedId
                href={
                  log.trace_id && log.span_id
                    ? `/traces/${log.trace_id}?span_id=${log.span_id}`
                    : ''
                }
                value={log.span_id}
                onCopy={onCopy}
              />
            </td>
            <td
              className="hidden max-w-[160px] truncate px-4 py-3 font-mono text-xs text-slate-400 2xl:table-cell"
              title={log.fingerprint}
            >
              {shortId(log.fingerprint)}
            </td>
            <td className="hidden max-w-[220px] truncate px-4 py-3 text-xs text-slate-400 2xl:table-cell">
              <AttributesPreview attributes={log.attributes} />
            </td>
            <td className="hidden px-4 py-3 2xl:table-cell">
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  onCopy(JSON.stringify(log, null, 2));
                }}
                className="rounded bg-surface-subtle px-2 py-1 text-xs text-slate-400 hover:text-white"
              >
                Copy JSON
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function LogGroupsTable({
  groups,
  onSelectFingerprint,
}: {
  groups: LogGroup[];
  onSelectFingerprint: (fingerprint: string) => void;
}) {
  if (groups.length === 0) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="text-center">
          <p className="text-gray-400 text-sm">No log groups found</p>
          <p className="text-gray-500 text-xs mt-1">Try a broader time range or fewer filters</p>
        </div>
      </div>
    );
  }

  return (
    <table className="w-full min-w-[900px] text-sm">
      <thead className="sticky top-0 bg-surface-card border-b border-surface-border">
        <tr>
          {[
            'Fingerprint',
            'Service',
            'Severity',
            'Count',
            'First seen',
            'Last seen',
            'Example',
          ].map((heading) => (
            <th
              key={heading}
              className="px-3 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-gray-400"
            >
              {heading}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-surface-border">
        {groups.map((group) => (
          <tr
            key={`${group.fingerprint}-${group.service_name}-${group.severity}`}
            className="hover:bg-surface-card/50"
          >
            <td className="px-3 py-2 text-xs font-mono">
              <button
                onClick={() => onSelectFingerprint(group.fingerprint)}
                className="text-blue-300 hover:text-blue-200"
                title={group.fingerprint}
              >
                {shortId(group.fingerprint)}
              </button>
            </td>
            <td className="px-3 py-2 text-xs text-gray-300">{group.service_name}</td>
            <td className="px-3 py-2">
              <SeverityBadge severity={group.severity} />
            </td>
            <td className="px-3 py-2 text-xs font-mono text-white">{group.count}</td>
            <td className="px-3 py-2 text-xs text-gray-400">
              {formatTimestamp(group.first_seen_at)}
            </td>
            <td className="px-3 py-2 text-xs text-gray-400">
              {formatTimestamp(group.last_seen_at)}
            </td>
            <td className="px-3 py-2 text-xs text-gray-300 max-w-[320px] truncate">
              {group.example_message}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function LinkedId({
  href,
  value,
  onCopy,
}: {
  href: string;
  value: string;
  onCopy: (value: string) => void;
}) {
  if (!value) return <span className="text-gray-600">—</span>;

  return (
    <span className="inline-flex items-center gap-1">
      {href ? (
        <Link
          href={href}
          onClick={(event) => event.stopPropagation()}
          className="text-blue-300 hover:text-blue-200"
        >
          {shortId(value)}
        </Link>
      ) : (
        <span className="text-gray-300">{shortId(value)}</span>
      )}
      <button
        onClick={(event) => {
          event.stopPropagation();
          onCopy(value);
        }}
        className="text-gray-500 hover:text-white"
        aria-label={`Copy ${value}`}
      >
        Copy
      </button>
    </span>
  );
}

function LogDetailDrawer({
  log,
  onClose,
  onCopy,
  onViewNearby,
  onSelectFingerprint,
}: {
  log: LogEntry;
  onClose: () => void;
  onCopy: (value: string) => void;
  onViewNearby: (log: LogEntry) => void;
  onSelectFingerprint: (fingerprint: string) => void;
}) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <aside className="flex min-h-0 flex-col border-l border-surface-border bg-surface-card/65">
      <div className="flex items-center justify-between border-b border-surface-border px-5 py-4">
        <h2 className="text-xl font-semibold tracking-tight text-white">Log Detail</h2>
        <button
          onClick={onClose}
          className="text-slate-400 hover:text-white"
          aria-label="Close drawer"
        >
          <CloseIcon className="h-5 w-5" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-5">
        <div className="space-y-5 border-b border-surface-border pb-5">
          <DetailValue label="Timestamp" value={formatTimestamp(log.timestamp)} mono />
          <DetailValue label="Severity" value={log.severity} severity={log.severity} />
          <DetailValue
            label="Service"
            value={log.service_name || '—'}
            linkHref={serviceHref(log)}
          />
          <DetailValue
            label="Trace ID"
            value={log.trace_id || '—'}
            mono
            linkHref={traceHref(log)}
          />
          <DetailValue label="Span ID" value={log.span_id || '—'} mono />
          <DetailValue
            label="Host"
            value={resourceValue(log, 'host.name') || resourceValue(log, 'host') || '—'}
          />
          <DetailValue label="Environment" value={log.environment || '—'} />
        </div>

        <section className="border-b border-surface-border py-5">
          <p className="mb-3 text-sm font-semibold text-slate-200">Message</p>
          <pre className="whitespace-pre-wrap break-words rounded-md border border-surface-border bg-surface-subtle/70 p-3 font-mono text-sm leading-6 text-slate-200">
            {log.message || '—'}
          </pre>
        </section>

        <div className="space-y-5 py-5">
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => onCopy(JSON.stringify(log, null, 2))}
              className="rp-button h-8 px-3 text-xs"
            >
              Copy log JSON
            </button>
            {log.trace_id && (
              <>
                <button onClick={() => onCopy(log.trace_id)} className="rp-button h-8 px-3 text-xs">
                  Copy trace_id
                </button>
                <Link
                  href={`/traces/${log.trace_id}`}
                  className="rp-button h-8 px-3 text-xs text-cyan-200"
                >
                  View trace
                </Link>
              </>
            )}
            {log.span_id && (
              <button onClick={() => onCopy(log.span_id)} className="rp-button h-8 px-3 text-xs">
                Copy span_id
              </button>
            )}
            <button onClick={() => onViewNearby(log)} className="rp-button h-8 px-3 text-xs">
              View logs around this event
            </button>
            {log.fingerprint && (
              <button
                onClick={() => onSelectFingerprint(log.fingerprint)}
                className="rp-button h-8 px-3 text-xs"
              >
                Same fingerprint
              </button>
            )}
          </div>

          <AttributesSection title="Resource attributes" attributes={log.resource_attributes} />
          <AttributesSection title="Custom attributes" attributes={log.attributes} />
        </div>
      </div>
    </aside>
  );
}

function DetailValue({
  label,
  value,
  mono = false,
  severity,
  linkHref,
}: {
  label: string;
  value: string;
  mono?: boolean;
  severity?: string;
  linkHref?: string;
}) {
  const content = severity ? (
    <SeverityBadge severity={severity} />
  ) : linkHref && value !== '—' ? (
    <Link href={linkHref} className="break-all text-cyan-300 hover:text-white">
      {value}
    </Link>
  ) : (
    value
  );

  return (
    <div className="grid grid-cols-[80px_minmax(0,1fr)] gap-4 text-sm">
      <p className="text-slate-400">{label}</p>
      <p className={`break-words text-slate-200 ${mono ? 'font-mono text-xs' : ''}`}>{content}</p>
    </div>
  );
}

function AttributesSection({
  title,
  attributes,
}: {
  title: string;
  attributes: Record<string, string>;
}) {
  const entries = Object.entries(attributes);
  return (
    <section>
      <p className="mb-2 text-xs font-medium uppercase tracking-wider text-gray-500">{title}</p>
      {entries.length === 0 ? (
        <p className="text-xs text-gray-600">No attributes</p>
      ) : (
        <div className="divide-y divide-surface-border overflow-hidden rounded border border-surface-border">
          {entries.map(([key, value]) => (
            <div key={key} className="grid grid-cols-[180px_minmax(0,1fr)] gap-3 px-3 py-2 text-xs">
              <span className="font-mono text-gray-500">{key}</span>
              <span className="break-words font-mono text-gray-300">{String(value)}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function serviceHref(log: LogEntry): string | undefined {
  if (!log.service_name) return undefined;
  const params = new URLSearchParams();
  if (log.environment) params.set('environment', log.environment);
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return `/services/${encodeURIComponent(log.service_name)}${suffix}`;
}

function traceHref(log: LogEntry): string | undefined {
  if (!log.trace_id) return undefined;
  return `/traces/${encodeURIComponent(log.trace_id)}`;
}

function resourceValue(log: LogEntry, key: string): string {
  return String(log.resource_attributes[key] ?? log.attributes[key] ?? '');
}

function SeverityBadge({ severity }: { severity: string }) {
  const colorClass = SEVERITY_COLORS[severity] ?? 'bg-gray-700 text-gray-300';
  return (
    <span
      className={`inline-block rounded-md border border-current/20 px-2 py-0.5 text-xs font-semibold ${colorClass}`}
    >
      {severity}
    </span>
  );
}

function severityDotClass(severity: string): string {
  if (severity === 'ERROR' || severity === 'FATAL') return 'bg-red-400';
  if (severity === 'WARN') return 'bg-amber-400';
  if (severity === 'INFO') return 'bg-blue-400';
  if (severity === 'DEBUG') return 'bg-emerald-400';
  return 'bg-slate-500';
}

function formatFacetCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(count >= 10_000_000 ? 0 : 1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(count >= 10_000 ? 0 : 1)}K`;
  return String(count);
}

function AttributesPreview({ attributes }: { attributes: Record<string, string> }) {
  const entries = Object.entries(attributes).slice(0, 3);
  if (entries.length === 0) return <span className="text-gray-600">—</span>;
  return <span>{entries.map(([key, value]) => `${key}=${value}`).join(' · ')}</span>;
}

function buildActiveFilters(
  filters: SavedQueryFilters,
  setters: {
    setService: (value: string) => void;
    setEnvironment: (value: string) => void;
    setSeverity: (value: string) => void;
    setTraceId: (value: string) => void;
    setSpanId: (value: string) => void;
    setErrorType: (value: string) => void;
    setFingerprint: (value: string) => void;
    setVersion: (value: string) => void;
    setSearch: (value: string) => void;
    setSearchInput: (value: string) => void;
    setAttributeFilters: Dispatch<SetStateAction<AttributeFilter[]>>;
  },
) {
  const active: Array<{ key: string; label: string; onRemove: () => void }> = [];
  if (filters.service)
    active.push({
      key: 'service',
      label: `service=${filters.service}`,
      onRemove: () => setters.setService(''),
    });
  if (filters.environment)
    active.push({
      key: 'environment',
      label: `env=${filters.environment}`,
      onRemove: () => setters.setEnvironment(''),
    });
  if (filters.severity)
    active.push({
      key: 'severity',
      label: `severity=${filters.severity.toLowerCase()}`,
      onRemove: () => setters.setSeverity(''),
    });
  if (filters.traceId)
    active.push({
      key: 'trace',
      label: `trace_id=${shortId(filters.traceId)}`,
      onRemove: () => setters.setTraceId(''),
    });
  if (filters.spanId)
    active.push({
      key: 'span',
      label: `span_id=${shortId(filters.spanId)}`,
      onRemove: () => setters.setSpanId(''),
    });
  if (filters.errorType)
    active.push({
      key: 'errorType',
      label: `error_type=${filters.errorType}`,
      onRemove: () => setters.setErrorType(''),
    });
  if (filters.fingerprint)
    active.push({
      key: 'fingerprint',
      label: `fingerprint=${shortId(filters.fingerprint)}`,
      onRemove: () => setters.setFingerprint(''),
    });
  if (filters.version)
    active.push({
      key: 'version',
      label: `version=${filters.version}`,
      onRemove: () => setters.setVersion(''),
    });
  if (filters.search) {
    active.push({
      key: 'search',
      label: `message contains "${filters.search}"`,
      onRemove: () => {
        setters.setSearch('');
        setters.setSearchInput('');
      },
    });
  }
  filters.attributeFilters.forEach((filter, index) => {
    if (!filter.key && !filter.value) return;
    active.push({
      key: `attribute-${index}`,
      label: `${filter.key || 'attribute'}=${filter.value || '*'}`,
      onRemove: () =>
        setters.setAttributeFilters((previous) =>
          previous.filter((_, filterIndex) => filterIndex !== index),
        ),
    });
  });
  return active;
}

function makeEmptyFilters(overrides: Partial<SavedQueryFilters> = {}): SavedQueryFilters {
  return {
    timeRange: '1h',
    customFrom: '',
    customTo: '',
    service: '',
    environment: '',
    severity: '',
    traceId: '',
    spanId: '',
    errorType: '',
    fingerprint: '',
    version: '',
    search: '',
    attributeFilters: [],
    ...overrides,
  };
}

function upsertAttributeFilter(
  filters: AttributeFilter[],
  key: string,
  value: string,
): AttributeFilter[] {
  const index = filters.findIndex((filter) => filter.key === key);
  if (index === -1) return [...filters, { key, value }];
  return filters.map((filter, filterIndex) => (filterIndex === index ? { key, value } : filter));
}

function parseAttributeFilters(value: string | null): AttributeFilter[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is AttributeFilter =>
        typeof item === 'object' &&
        item !== null &&
        typeof item.key === 'string' &&
        typeof item.value === 'string',
    );
  } catch {
    return [];
  }
}

function loadSavedQueries(): SavedLogQuery[] {
  try {
    const stored = window.localStorage.getItem(SAVED_QUERIES_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistSavedQueries(queries: SavedLogQuery[]) {
  window.localStorage.setItem(SAVED_QUERIES_KEY, JSON.stringify(queries));
}

function toDatetimeLocalValue(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (isNaN(date.getTime())) return '';
  const offsetMs = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function formatTimestamp(timestamp: string): string {
  try {
    const date = new Date(timestamp);
    return date.toISOString().replace('T', ' ').replace('Z', '').slice(0, 23);
  } catch {
    return timestamp;
  }
}

function shortId(value: string): string {
  if (!value) return '—';
  if (value.length <= 16) return value;
  return `${value.slice(0, 12)}…`;
}

async function copyText(value: string) {
  if (!value) return;
  await navigator.clipboard?.writeText(value);
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
      />
    </svg>
  );
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
    </svg>
  );
}
