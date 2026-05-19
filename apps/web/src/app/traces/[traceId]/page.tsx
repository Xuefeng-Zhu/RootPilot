'use client';

import { useEffect, useState, useMemo } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import type { LogQueryResponse } from '@rootpilot/shared';
import { apiClient, ApiError } from '../../../lib/api';

interface Span {
  id: string;
  trace_id: string;
  span_id: string;
  parent_span_id: string | null;
  operation_name: string;
  service_name: string;
  duration_ms: number;
  status_code: string;
  status_message: string;
  timestamp: string;
  kind: string;
}

interface RelatedLog {
  id: string;
  span_id: string;
  message: string;
  severity: string;
  timestamp: string;
}

interface TraceDetailResponse {
  data: Span[];
}

interface SpanNode extends Span {
  depth: number;
  children: SpanNode[];
}

function getTraceLogWindow(spans: Span[]): { from: string; to: string } | null {
  const starts = spans
    .map((span) => new Date(span.timestamp).getTime())
    .filter((timestamp) => Number.isFinite(timestamp));
  if (starts.length === 0) return null;

  const ends = spans
    .map((span) => {
      const start = new Date(span.timestamp).getTime();
      if (!Number.isFinite(start)) return null;
      return start + Math.max(span.duration_ms, 0);
    })
    .filter((timestamp): timestamp is number => timestamp !== null && Number.isFinite(timestamp));

  const paddingMs = 60 * 1000;
  const from = Math.min(...starts) - paddingMs;
  const to = Math.max(...(ends.length > 0 ? ends : starts)) + paddingMs;

  return {
    from: new Date(from).toISOString(),
    to: new Date(to).toISOString(),
  };
}

export default function TraceDetailPage() {
  const params = useParams();
  const traceId = params.traceId as string;

  const [spans, setSpans] = useState<Span[]>([]);
  const [relatedLogs, setRelatedLogs] = useState<RelatedLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchTrace() {
      try {
        setLoading(true);
        setError(null);
        setNotFound(false);

        const response = await apiClient<TraceDetailResponse>(`/v1/traces/${traceId}`);
        setSpans(response.data);
        try {
          const traceWindow = getTraceLogWindow(response.data);
          const logsResponse = await apiClient<LogQueryResponse>('/v1/logs', {
            params: {
              trace_id: traceId,
              limit: 200,
              ...traceWindow,
            },
          });
          setRelatedLogs(
            logsResponse.data.map((log) => ({
              id: log.id,
              span_id: log.span_id,
              message: log.message,
              severity: log.severity,
              timestamp: log.timestamp,
            })),
          );
        } catch {
          setRelatedLogs([]);
        }
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          setNotFound(true);
        } else {
          const message = err instanceof ApiError ? err.message : 'Failed to fetch trace details';
          setError(message);
        }
      } finally {
        setLoading(false);
      }
    }

    fetchTrace();
  }, [traceId]);

  // Build the span tree and flatten it in DFS order for waterfall rendering
  const { flatSpans, traceStart, traceDuration } = useMemo(() => {
    if (spans.length === 0) {
      return { flatSpans: [] as SpanNode[], traceStart: 0, traceDuration: 0 };
    }

    // Calculate trace time boundaries
    const timestamps = spans.map((s) => new Date(s.timestamp).getTime());
    const endTimes = spans.map((s) => new Date(s.timestamp).getTime() + s.duration_ms);
    const traceStartMs = Math.min(...timestamps);
    const traceEndMs = Math.max(...endTimes);
    const totalDuration = traceEndMs - traceStartMs || 1; // avoid division by zero

    // Build a map of span_id -> span
    const spanMap = new Map<string, SpanNode>();
    for (const span of spans) {
      spanMap.set(span.span_id, { ...span, depth: 0, children: [] });
    }

    // Build tree structure
    const roots: SpanNode[] = [];
    for (const node of spanMap.values()) {
      if (node.parent_span_id && spanMap.has(node.parent_span_id)) {
        const parent = spanMap.get(node.parent_span_id)!;
        parent.children.push(node);
      } else {
        roots.push(node);
      }
    }

    // Sort children by timestamp
    function sortChildren(node: SpanNode) {
      node.children.sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
      );
      for (const child of node.children) {
        sortChildren(child);
      }
    }
    roots.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    for (const root of roots) {
      sortChildren(root);
    }

    // Flatten tree with DFS, assigning depth
    const flat: SpanNode[] = [];
    function dfs(node: SpanNode, depth: number) {
      node.depth = depth;
      flat.push(node);
      for (const child of node.children) {
        dfs(child, depth + 1);
      }
    }
    for (const root of roots) {
      dfs(root, 0);
    }

    return { flatSpans: flat, traceStart: traceStartMs, traceDuration: totalDuration };
  }, [spans]);

  const logsBySpanId = useMemo(() => {
    const grouped = new Map<string, RelatedLog[]>();
    for (const log of relatedLogs) {
      if (!log.span_id) continue;
      const current = grouped.get(log.span_id) ?? [];
      current.push(log);
      grouped.set(log.span_id, current);
    }
    return grouped;
  }, [relatedLogs]);

  function getStatusColor(status: string): string {
    switch (status) {
      case 'OK':
        return 'bg-green-500';
      case 'ERROR':
        return 'bg-red-500';
      default:
        return 'bg-gray-500';
    }
  }

  function getStatusTextColor(status: string): string {
    switch (status) {
      case 'OK':
        return 'text-green-400';
      case 'ERROR':
        return 'text-red-400';
      default:
        return 'text-gray-400';
    }
  }

  function formatDuration(ms: number): string {
    if (ms < 1) return '<1ms';
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  }

  // Loading state
  if (loading) {
    return (
      <div>
        <div className="mb-6">
          <Link href="/traces" className="text-blue-400 hover:text-blue-300 text-sm">
            ← Back to Traces
          </Link>
        </div>
        <div className="text-gray-400 text-sm py-8 text-center">Loading trace...</div>
      </div>
    );
  }

  // 404 state
  if (notFound) {
    return (
      <div>
        <div className="mb-6">
          <Link href="/traces" className="text-blue-400 hover:text-blue-300 text-sm">
            ← Back to Traces
          </Link>
        </div>
        <div className="text-center py-12">
          <h2 className="text-xl font-semibold text-white mb-2">Trace Not Found</h2>
          <p className="text-gray-400 text-sm">
            The requested trace does not exist or may have expired.
          </p>
          <p className="text-gray-500 text-xs mt-1 font-mono">{traceId}</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div>
        <div className="mb-6">
          <Link href="/traces" className="text-blue-400 hover:text-blue-300 text-sm">
            ← Back to Traces
          </Link>
        </div>
        <div className="p-4 bg-red-900/30 border border-red-700 rounded-lg text-red-300 text-sm">
          {error}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <Link href="/traces" className="text-blue-400 hover:text-blue-300 text-sm">
          ← Back to Traces
        </Link>
      </div>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Trace Detail</h1>
          <p className="text-gray-400 text-xs font-mono mt-1">{traceId}</p>
        </div>
        <div className="text-right">
          <p className="text-sm text-gray-400">
            {spans.length} span{spans.length !== 1 ? 's' : ''} · {formatDuration(traceDuration)}
          </p>
          <p className="text-xs text-gray-500">
            {relatedLogs.length} related log{relatedLogs.length !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      {/* Waterfall Visualization */}
      <div className="border border-surface-border rounded-lg overflow-hidden">
        {/* Header */}
        <div className="flex items-center px-4 py-2 bg-surface-card border-b border-surface-border text-xs text-gray-400">
          <div className="w-[300px] shrink-0">Operation</div>
          <div className="flex-1">Timeline</div>
          <div className="w-[90px] text-right shrink-0">Logs</div>
          <div className="w-[80px] text-right shrink-0">Duration</div>
        </div>

        {/* Span Rows */}
        <div className="divide-y divide-surface-border/30">
          {flatSpans.map((span) => {
            const spanStart = new Date(span.timestamp).getTime() - traceStart;
            const leftPercent = (spanStart / traceDuration) * 100;
            const widthPercent = Math.max(
              (span.duration_ms / traceDuration) * 100,
              0.5, // minimum width for visibility
            );
            const spanLogs = logsBySpanId.get(span.span_id) ?? [];

            return (
              <div
                key={span.span_id}
                className="flex items-center px-4 py-2 hover:bg-surface-card/50 transition-colors group"
              >
                {/* Operation label with indentation */}
                <div className="w-[300px] shrink-0 overflow-hidden">
                  <div
                    className="flex items-center gap-2 truncate"
                    style={{ paddingLeft: `${span.depth * 16}px` }}
                  >
                    <span
                      className={`inline-block w-2 h-2 rounded-full shrink-0 ${getStatusColor(span.status_code)}`}
                    />
                    <span className="truncate text-sm">
                      <span className="text-gray-400">{span.service_name}</span>
                      <span className="text-gray-600 mx-1">·</span>
                      <span className={`${getStatusTextColor(span.status_code)}`}>
                        {span.operation_name}
                      </span>
                    </span>
                  </div>
                </div>

                {/* Timeline bar */}
                <div className="flex-1 h-6 relative">
                  <div
                    className={`absolute top-1 h-4 rounded-sm ${getStatusColor(span.status_code)} opacity-80 group-hover:opacity-100 transition-opacity`}
                    style={{
                      left: `${leftPercent}%`,
                      width: `${widthPercent}%`,
                      minWidth: '2px',
                    }}
                  />
                </div>

                {/* Related logs */}
                <div className="w-[90px] text-right shrink-0 text-xs">
                  {spanLogs.length > 0 ? (
                    <Link
                      href={`/logs?trace_id=${encodeURIComponent(traceId)}&span_id=${encodeURIComponent(span.span_id)}`}
                      className="text-blue-400 hover:text-blue-300"
                      title={spanLogs[0]?.message}
                    >
                      {spanLogs.length} log{spanLogs.length !== 1 ? 's' : ''}
                    </Link>
                  ) : (
                    <span className="text-gray-600">—</span>
                  )}
                </div>

                {/* Duration */}
                <div className="w-[80px] text-right shrink-0 text-xs text-gray-300 font-mono">
                  {formatDuration(span.duration_ms)}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
