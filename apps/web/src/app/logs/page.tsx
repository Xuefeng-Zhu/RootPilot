'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient, ApiError } from '../../lib/api';

// ─── Types ───────────────────────────────────────────────────────────────────

interface LogEntry {
  id: string;
  tenant_id: string;
  project_id: string;
  timestamp: string;
  received_at: string;
  service_name: string;
  environment: string;
  source: string;
  resource_attributes: Record<string, string>;
  attributes: Record<string, string>;
  severity: string;
  message: string;
  trace_id: string;
  span_id: string;
  fingerprint: string;
}

interface LogsResponse {
  data: LogEntry[];
  pagination: {
    cursor: string | null;
    hasMore: boolean;
  };
}

interface ServiceEntry {
  service_name: string;
  environment: string;
}

interface ServicesResponse {
  data: ServiceEntry[];
}

// ─── Constants ───────────────────────────────────────────────────────────────

const TIME_RANGE_OPTIONS = [
  { label: '15m', value: '15m', ms: 15 * 60 * 1000 },
  { label: '1h', value: '1h', ms: 60 * 60 * 1000 },
  { label: '6h', value: '6h', ms: 6 * 60 * 60 * 1000 },
  { label: '24h', value: '24h', ms: 24 * 60 * 60 * 1000 },
  { label: '7d', value: '7d', ms: 7 * 24 * 60 * 60 * 1000 },
] as const;

const SEVERITY_OPTIONS = ['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'] as const;

const SEVERITY_COLORS: Record<string, string> = {
  TRACE: 'bg-gray-600 text-gray-200',
  DEBUG: 'bg-blue-900 text-blue-300',
  INFO: 'bg-green-900 text-green-300',
  WARN: 'bg-yellow-900 text-yellow-300',
  ERROR: 'bg-red-900 text-red-300',
  FATAL: 'bg-purple-900 text-purple-300',
};

const PAGE_SIZE = 50;

// ─── Component ───────────────────────────────────────────────────────────────

export default function LogsExplorerPage() {
  // Filter state
  const [timeRange, setTimeRange] = useState<string>('1h');
  const [customFrom, setCustomFrom] = useState<string>('');
  const [customTo, setCustomTo] = useState<string>('');
  const [service, setService] = useState<string>('');
  const [environment, setEnvironment] = useState<string>('');
  const [selectedSeverities, setSelectedSeverities] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState<string>('');
  const [searchInput, setSearchInput] = useState<string>('');

  // Data state
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Services for dropdown
  const [services, setServices] = useState<ServiceEntry[]>([]);
  const [environments, setEnvironments] = useState<string[]>([]);

  // Detail drawer
  const [selectedLog, setSelectedLog] = useState<LogEntry | null>(null);

  // Ref for debounce
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const logScrollRef = useRef<HTMLDivElement | null>(null);
  const infiniteLoaderRef = useRef<HTMLDivElement | null>(null);
  const loadingMoreRef = useRef(false);

  // ─── Fetch services for dropdowns ────────────────────────────────────────
  useEffect(() => {
    async function fetchServices() {
      try {
        const res = await apiClient<ServicesResponse>('/v1/services');
        setServices(res.data);
        const envs = [...new Set(res.data.map((s) => s.environment).filter(Boolean))];
        setEnvironments(envs);
      } catch {
        // Silently fail — dropdowns will just be empty
      }
    }
    fetchServices();
  }, []);

  // ─── Compute time range ──────────────────────────────────────────────────
  const getTimeRange = useCallback((): { from: string; to: string } => {
    if (timeRange === 'custom') {
      return {
        from: customFrom || new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        to: customTo || new Date().toISOString(),
      };
    }
    const option = TIME_RANGE_OPTIONS.find((o) => o.value === timeRange);
    const ms = option?.ms ?? 60 * 60 * 1000;
    const now = new Date();
    return {
      from: new Date(now.getTime() - ms).toISOString(),
      to: now.toISOString(),
    };
  }, [timeRange, customFrom, customTo]);

  // ─── Fetch logs ──────────────────────────────────────────────────────────
  const fetchLogs = useCallback(
    async (append = false, pageCursor?: string | null) => {
      if (append && loadingMoreRef.current) {
        return;
      }
      if (append) {
        loadingMoreRef.current = true;
        setLoadingMore(true);
      } else {
        setLoading(true);
      }
      setError(null);

      try {
        const { from, to } = getTimeRange();
        const params: Record<string, string | number | boolean | undefined> = {
          from,
          to,
          limit: PAGE_SIZE,
        };

        if (service) params.service_name = service;
        if (environment) params.environment = environment;
        if (search) params.search = search;
        if (selectedSeverities.size === 1) {
          params.severity = [...selectedSeverities][0];
        }
        if (append && pageCursor) {
          params.cursor = pageCursor;
        }

        const res = await apiClient<LogsResponse>('/v1/logs', { params });

        if (append) {
          setLogs((prev) => [...prev, ...res.data]);
        } else {
          setLogs(res.data);
        }
        setCursor(res.pagination.cursor);
        setHasMore(res.pagination.hasMore);
      } catch (err) {
        const message =
          err instanceof ApiError ? err.message : 'Failed to fetch logs. Please try again.';
        setError(message);
      } finally {
        setLoading(false);
        setLoadingMore(false);
        if (append) {
          loadingMoreRef.current = false;
        }
      }
    },
    [getTimeRange, service, environment, search, selectedSeverities],
  );

  // ─── Initial fetch and refetch on filter change ──────────────────────────
  useEffect(() => {
    fetchLogs(false);
  }, [fetchLogs]);

  // ─── Search debounce ─────────────────────────────────────────────────────
  const handleSearchChange = (value: string) => {
    setSearchInput(value);
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    searchTimeoutRef.current = setTimeout(() => {
      setSearch(value);
    }, 400);
  };

  // ─── Severity toggle ────────────────────────────────────────────────────
  const toggleSeverity = (sev: string) => {
    setSelectedSeverities((prev) => {
      const next = new Set(prev);
      if (next.has(sev)) {
        next.delete(sev);
      } else {
        next.add(sev);
      }
      return next;
    });
  };

  // ─── Infinite loading ───────────────────────────────────────────────────
  const loadMoreLogs = useCallback(() => {
    if (hasMore && cursor) {
      fetchLogs(true, cursor);
    }
  }, [cursor, fetchLogs, hasMore]);

  useEffect(() => {
    const loader = infiniteLoaderRef.current;
    if (!loader || !hasMore || loading || loadingMore) {
      return;
    }

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
  }, [hasMore, loadMoreLogs, loading, loadingMore]);

  // ─── Filter logs client-side for multi-severity ─────────────────────────
  const displayedLogs =
    selectedSeverities.size > 1 ? logs.filter((log) => selectedSeverities.has(log.severity)) : logs;

  // ─── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-white">Logs Explorer</h1>
      </div>

      {/* Filter Controls */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        {/* Time Range */}
        <div className="flex items-center gap-1">
          {TIME_RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setTimeRange(opt.value)}
              className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                timeRange === opt.value
                  ? 'bg-sidebar-active text-white'
                  : 'bg-surface-card text-gray-400 hover:text-white hover:bg-surface-border'
              }`}
            >
              {opt.label}
            </button>
          ))}
          <button
            onClick={() => setTimeRange('custom')}
            className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
              timeRange === 'custom'
                ? 'bg-sidebar-active text-white'
                : 'bg-surface-card text-gray-400 hover:text-white hover:bg-surface-border'
            }`}
          >
            Custom
          </button>
        </div>

        {/* Custom date inputs */}
        {timeRange === 'custom' && (
          <div className="flex items-center gap-2">
            <input
              type="datetime-local"
              value={customFrom}
              onChange={(e) =>
                setCustomFrom(e.target.value ? new Date(e.target.value).toISOString() : '')
              }
              className="px-2 py-1.5 text-xs bg-surface-card border border-surface-border rounded text-gray-300 focus:outline-none focus:border-sidebar-active"
            />
            <span className="text-gray-500 text-xs">to</span>
            <input
              type="datetime-local"
              value={customTo}
              onChange={(e) =>
                setCustomTo(e.target.value ? new Date(e.target.value).toISOString() : '')
              }
              className="px-2 py-1.5 text-xs bg-surface-card border border-surface-border rounded text-gray-300 focus:outline-none focus:border-sidebar-active"
            />
          </div>
        )}

        {/* Service dropdown */}
        <select
          value={service}
          onChange={(e) => setService(e.target.value)}
          className="px-3 py-1.5 text-xs bg-surface-card border border-surface-border rounded text-gray-300 focus:outline-none focus:border-sidebar-active"
        >
          <option value="">All Services</option>
          {[...new Set(services.map((s) => s.service_name))].map((svc) => (
            <option key={svc} value={svc}>
              {svc}
            </option>
          ))}
        </select>

        {/* Environment dropdown */}
        <select
          value={environment}
          onChange={(e) => setEnvironment(e.target.value)}
          className="px-3 py-1.5 text-xs bg-surface-card border border-surface-border rounded text-gray-300 focus:outline-none focus:border-sidebar-active"
        >
          <option value="">All Environments</option>
          {environments.map((env) => (
            <option key={env} value={env}>
              {env}
            </option>
          ))}
        </select>

        {/* Search input */}
        <div className="relative">
          <input
            type="text"
            placeholder="Search messages..."
            value={searchInput}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="pl-8 pr-3 py-1.5 text-xs bg-surface-card border border-surface-border rounded text-gray-300 placeholder-gray-500 focus:outline-none focus:border-sidebar-active w-56"
          />
          <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
        </div>
      </div>

      {/* Severity multi-select */}
      <div className="flex items-center gap-2 mb-4">
        <span className="text-xs text-gray-500">Severity:</span>
        {SEVERITY_OPTIONS.map((sev) => (
          <button
            key={sev}
            onClick={() => toggleSeverity(sev)}
            className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
              selectedSeverities.has(sev)
                ? SEVERITY_COLORS[sev]
                : 'bg-surface-card text-gray-500 hover:text-gray-300'
            }`}
          >
            {sev.toLowerCase()}
          </button>
        ))}
      </div>

      {/* Error state */}
      {error && (
        <div className="mb-4 px-4 py-3 bg-red-900/30 border border-red-800 rounded text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Logs table */}
      <div ref={logScrollRef} className="flex-1 overflow-auto border border-surface-border rounded">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="text-gray-400 text-sm">Loading logs...</div>
          </div>
        ) : displayedLogs.length === 0 && !error ? (
          <div className="flex items-center justify-center py-16">
            <div className="text-center">
              <p className="text-gray-400 text-sm">No results found</p>
              <p className="text-gray-500 text-xs mt-1">Try adjusting your filters or time range</p>
            </div>
          </div>
        ) : (
          <>
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-surface-card border-b border-surface-border">
                <tr>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-400 uppercase tracking-wider w-44">
                    Timestamp
                  </th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-400 uppercase tracking-wider w-36">
                    Service
                  </th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-400 uppercase tracking-wider w-24">
                    Severity
                  </th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-400 uppercase tracking-wider">
                    Message
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-border">
                {displayedLogs.map((log) => (
                  <tr
                    key={log.id}
                    onClick={() => setSelectedLog(log)}
                    className="hover:bg-surface-card/50 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-2 text-xs text-gray-400 font-mono whitespace-nowrap">
                      {formatTimestamp(log.timestamp)}
                    </td>
                    <td className="px-4 py-2 text-xs text-gray-300 truncate max-w-[144px]">
                      {log.service_name}
                    </td>
                    <td className="px-4 py-2">
                      <SeverityBadge severity={log.severity} />
                    </td>
                    <td className="px-4 py-2 text-xs text-gray-300 truncate max-w-md">
                      {log.message}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {hasMore && (
              <div
                ref={infiniteLoaderRef}
                data-testid="logs-infinite-loader"
                className="flex min-h-14 items-center justify-center py-4"
                aria-live="polite"
              >
                {loadingMore && <div className="text-sm text-gray-400">Loading more logs...</div>}
              </div>
            )}
          </>
        )}
      </div>

      {/* Detail Drawer */}
      {selectedLog && <LogDetailDrawer log={selectedLog} onClose={() => setSelectedLog(null)} />}
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function SeverityBadge({ severity }: { severity: string }) {
  const colorClass = SEVERITY_COLORS[severity] ?? 'bg-gray-700 text-gray-300';
  return (
    <span className={`inline-block px-2 py-0.5 text-xs font-medium rounded ${colorClass}`}>
      {severity.toLowerCase()}
    </span>
  );
}

function LogDetailDrawer({ log, onClose }: { log: LogEntry; onClose: () => void }) {
  // Close on escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      {/* Drawer */}
      <div className="fixed top-0 right-0 h-full w-[500px] max-w-[90vw] bg-surface-card border-l border-surface-border z-50 flex flex-col shadow-2xl animate-slide-in">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-border">
          <h2 className="text-sm font-semibold text-white">Log Detail</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors"
            aria-label="Close drawer"
          >
            <CloseIcon className="w-5 h-5" />
          </button>
        </div>
        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">
          <pre className="text-xs text-gray-300 font-mono whitespace-pre-wrap break-words">
            {JSON.stringify(log, null, 2)}
          </pre>
        </div>
      </div>
    </>
  );
}

// ─── Utilities ───────────────────────────────────────────────────────────────

function formatTimestamp(ts: string): string {
  try {
    const date = new Date(ts);
    return date.toISOString().replace('T', ' ').replace('Z', '').slice(0, 23);
  } catch {
    return ts;
  }
}

// ─── Icons ───────────────────────────────────────────────────────────────────

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
