'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import type {
  CanonicalLog,
  CanonicalSpan,
  SimilarTrace,
  SimilarTracesResponse,
  TraceCriticalPath,
  TraceDetailResponse,
  TraceDetailSummary,
  TraceLogsResponse,
  TraceServiceBreakdown,
} from '@rootpilot/shared';
import { apiClient, ApiError } from '../../../lib/api';

interface SpanNode {
  span: CanonicalSpan;
  children: SpanNode[];
  depth: number;
}

interface FlatSpan {
  span: CanonicalSpan;
  depth: number;
  hasChildren: boolean;
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return 'Unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function formatDuration(ms: number | null | undefined): string {
  const value = Number(ms ?? 0);
  if (!Number.isFinite(value) || value <= 0) return '0ms';
  if (value < 1) return '<1ms';
  if (value < 1000) return `${Math.round(value)}ms`;
  return `${(value / 1000).toFixed(2)}s`;
}

function formatOffset(ms: number): string {
  if (ms < 1000) return `+${Math.round(ms)}ms`;
  return `+${(ms / 1000).toFixed(2)}s`;
}

function statusClass(status: string): string {
  if (status === 'ERROR') return 'border-red-700 bg-red-950/40 text-red-200';
  if (status === 'OK') return 'border-emerald-700 bg-emerald-950/40 text-emerald-200';
  return 'border-gray-700 bg-gray-900 text-gray-300';
}

function statusDotClass(status: string): string {
  if (status === 'ERROR') return 'bg-red-500';
  if (status === 'OK') return 'bg-emerald-500';
  return 'bg-gray-500';
}

function getTimestampMs(value: string): number {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function buildTree(spans: CanonicalSpan[]): SpanNode[] {
  const nodes = new Map<string, SpanNode>();
  for (const span of spans) {
    nodes.set(span.span_id, { span, children: [], depth: 0 });
  }

  const roots: SpanNode[] = [];
  for (const node of nodes.values()) {
    const parentId = node.span.parent_span_id;
    if (parentId && nodes.has(parentId)) {
      nodes.get(parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  function sortAndDepth(node: SpanNode, depth: number) {
    node.depth = depth;
    node.children.sort(
      (a, b) => getTimestampMs(a.span.timestamp) - getTimestampMs(b.span.timestamp),
    );
    for (const child of node.children) {
      sortAndDepth(child, depth + 1);
    }
  }

  roots.sort((a, b) => getTimestampMs(a.span.timestamp) - getTimestampMs(b.span.timestamp));
  for (const root of roots) {
    sortAndDepth(root, 0);
  }
  return roots;
}

function flattenVisibleSpans(roots: SpanNode[], expanded: Set<string>): FlatSpan[] {
  const result: FlatSpan[] = [];

  function visit(node: SpanNode) {
    result.push({
      span: node.span,
      depth: node.depth,
      hasChildren: node.children.length > 0,
    });
    if (!expanded.has(node.span.span_id)) return;
    for (const child of node.children) {
      visit(child);
    }
  }

  for (const root of roots) {
    visit(root);
  }
  return result;
}

function computeBounds(
  spans: CanonicalSpan[],
  summary?: TraceDetailSummary,
): {
  startMs: number;
  durationMs: number;
} {
  const summaryStart = summary?.start_time ? getTimestampMs(summary.start_time) : 0;
  const starts = spans.map((span) => getTimestampMs(span.timestamp)).filter((value) => value > 0);
  const startMs = summaryStart || (starts.length > 0 ? Math.min(...starts) : 0);
  const endMs = Math.max(
    startMs,
    ...spans.map((span) => {
      const start = getTimestampMs(span.timestamp);
      return start > 0 ? start + Math.max(span.duration_ms, 0) : startMs;
    }),
  );
  return {
    startMs,
    durationMs: Math.max(summary?.duration_ms ?? 0, endMs - startMs, 1),
  };
}

function computeCriticalPath(spans: CanonicalSpan[]): TraceCriticalPath {
  const roots = buildTree(spans);
  const memo = new Map<string, TraceCriticalPath>();

  function bestPath(node: SpanNode): TraceCriticalPath {
    const cached = memo.get(node.span.span_id);
    if (cached) return cached;

    let bestChild: TraceCriticalPath = { span_ids: [], duration_ms: 0 };
    for (const child of node.children) {
      const childPath = bestPath(child);
      if (childPath.duration_ms > bestChild.duration_ms) {
        bestChild = childPath;
      }
    }

    const result = {
      span_ids: [node.span.span_id, ...bestChild.span_ids],
      duration_ms: Math.max(node.span.duration_ms, 0) + bestChild.duration_ms,
    };
    memo.set(node.span.span_id, result);
    return result;
  }

  let longest: TraceCriticalPath = { span_ids: [], duration_ms: 0 };
  for (const root of roots) {
    const path = bestPath(root);
    if (path.duration_ms > longest.duration_ms) {
      longest = path;
    }
  }
  return longest;
}

function computeServiceBreakdown(spans: CanonicalSpan[]): TraceServiceBreakdown[] {
  const byService = new Map<string, TraceServiceBreakdown>();
  for (const span of spans) {
    const current =
      byService.get(span.service_name) ??
      ({
        service_name: span.service_name,
        total_time_ms: 0,
        span_count: 0,
        error_count: 0,
      } satisfies TraceServiceBreakdown);
    current.total_time_ms += Math.max(span.duration_ms, 0);
    current.span_count += 1;
    if (span.status_code === 'ERROR') current.error_count += 1;
    byService.set(span.service_name, current);
  }
  return [...byService.values()].sort((a, b) => b.total_time_ms - a.total_time_ms);
}

function buildLogsHref(traceId: string, spanId?: string | null): string {
  const params = new URLSearchParams({ trace_id: traceId });
  if (spanId) params.set('span_id', spanId);
  return `/logs?${params.toString()}`;
}

function attributeRows(attributes: Record<string, string> | null | undefined): [string, string][] {
  return Object.entries(attributes ?? {}).sort(([a], [b]) => a.localeCompare(b));
}

function errorAttributes(span: CanonicalSpan): [string, string][] {
  return attributeRows(span.attributes).filter(([key]) => {
    const lower = key.toLowerCase();
    return lower.includes('error') || lower.includes('exception') || lower.includes('status');
  });
}

function metricValue(label: string, value: string) {
  return (
    <div className="rounded border border-surface-border bg-surface-card p-4">
      <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
      <div className="mt-1 text-lg font-semibold text-white">{value}</div>
    </div>
  );
}

export default function TraceDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const rawTraceId = params.traceId;
  const traceId = Array.isArray(rawTraceId) ? (rawTraceId[0] ?? '') : (rawTraceId ?? '');
  const backHref = searchParams.toString() ? `/traces?${searchParams.toString()}` : '/traces';

  const [spans, setSpans] = useState<CanonicalSpan[]>([]);
  const [summary, setSummary] = useState<TraceDetailSummary | undefined>();
  const [relatedLogs, setRelatedLogs] = useState<CanonicalLog[]>([]);
  const [similarTraces, setSimilarTraces] = useState<SimilarTrace[]>([]);
  const [selectedSpanId, setSelectedSpanId] = useState<string | null>(null);
  const [expandedSpanIds, setExpandedSpanIds] = useState<Set<string>>(new Set());
  const [logSpanFilter, setLogSpanFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [logsLoading, setLogsLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logsError, setLogsError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchTrace() {
      try {
        setLoading(true);
        setError(null);
        setNotFound(false);

        const detailPromise = apiClient<TraceDetailResponse>(`/v1/traces/${traceId}`);
        const similarParams: Record<string, string | number> = { limit: 8 };
        const from = searchParams.get('from');
        const to = searchParams.get('to');
        if (from) similarParams.from = from;
        if (to) similarParams.to = to;
        const similarPromise = apiClient<SimilarTracesResponse>(`/v1/traces/${traceId}/similar`, {
          params: similarParams,
        }).catch(() => ({ data: [] }));

        const [detailResponse, similarResponse] = await Promise.all([
          detailPromise,
          similarPromise,
        ]);
        if (cancelled) return;

        const rootSpan = detailResponse.data.find((span) => !span.parent_span_id);
        setSpans(detailResponse.data);
        setSummary(detailResponse.summary);
        setSimilarTraces(similarResponse.data);
        setExpandedSpanIds(new Set(detailResponse.data.map((span) => span.span_id)));
        setSelectedSpanId(rootSpan?.span_id ?? detailResponse.data[0]?.span_id ?? null);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) {
          setNotFound(true);
        } else {
          const message = err instanceof ApiError ? err.message : 'Failed to fetch trace details';
          setError(message);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    if (traceId) void fetchTrace();
    return () => {
      cancelled = true;
    };
  }, [searchParams, traceId]);

  useEffect(() => {
    let cancelled = false;

    async function fetchLogs() {
      try {
        setLogsLoading(true);
        setLogsError(null);
        const params = logSpanFilter ? { span_id: logSpanFilter } : undefined;
        const logsResponse = await apiClient<TraceLogsResponse>(`/v1/traces/${traceId}/logs`, {
          params,
        });
        if (!cancelled) setRelatedLogs(logsResponse.data);
      } catch (err) {
        if (!cancelled) {
          setRelatedLogs([]);
          setLogsError(err instanceof ApiError ? err.message : 'Failed to fetch related logs');
        }
      } finally {
        if (!cancelled) setLogsLoading(false);
      }
    }

    if (traceId && !notFound) void fetchLogs();
    return () => {
      cancelled = true;
    };
  }, [logSpanFilter, notFound, traceId]);

  const treeRoots = useMemo(() => buildTree(spans), [spans]);
  const flatSpans = useMemo(
    () => flattenVisibleSpans(treeRoots, expandedSpanIds),
    [expandedSpanIds, treeRoots],
  );
  const criticalPath = useMemo(() => computeCriticalPath(spans), [spans]);
  const criticalSpanIds = useMemo(() => new Set(criticalPath.span_ids), [criticalPath.span_ids]);
  const serviceBreakdown = useMemo(() => computeServiceBreakdown(spans), [spans]);
  const { startMs, durationMs } = useMemo(() => computeBounds(spans, summary), [spans, summary]);
  const logsBySpanId = useMemo(() => {
    const grouped = new Map<string, CanonicalLog[]>();
    for (const log of relatedLogs) {
      if (!log.span_id) continue;
      const logs = grouped.get(log.span_id) ?? [];
      logs.push(log);
      grouped.set(log.span_id, logs);
    }
    return grouped;
  }, [relatedLogs]);
  const selectedSpan = useMemo(
    () => spans.find((span) => span.span_id === selectedSpanId) ?? null,
    [selectedSpanId, spans],
  );
  const errorSpans = useMemo(() => spans.filter((span) => span.status_code === 'ERROR'), [spans]);

  function toggleSpan(spanId: string) {
    setExpandedSpanIds((current) => {
      const next = new Set(current);
      if (next.has(spanId)) {
        next.delete(spanId);
      } else {
        next.add(spanId);
      }
      return next;
    });
  }

  if (loading) {
    return (
      <div>
        <div className="mb-6">
          <Link href={backHref} className="text-sm text-blue-400 hover:text-blue-300">
            Back to Traces
          </Link>
        </div>
        <div className="py-10 text-center text-sm text-gray-400">Loading trace...</div>
      </div>
    );
  }

  if (notFound) {
    return (
      <div>
        <div className="mb-6">
          <Link href={backHref} className="text-sm text-blue-400 hover:text-blue-300">
            Back to Traces
          </Link>
        </div>
        <div className="py-12 text-center">
          <h2 className="mb-2 text-xl font-semibold text-white">Trace Not Found</h2>
          <p className="text-sm text-gray-400">
            The requested trace does not exist or has expired.
          </p>
          <p className="mt-2 font-mono text-xs text-gray-500">{traceId}</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <div className="mb-6">
          <Link href={backHref} className="text-sm text-blue-400 hover:text-blue-300">
            Back to Traces
          </Link>
        </div>
        <div className="rounded border border-red-700 bg-red-950/40 p-4 text-sm text-red-200">
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href={backHref} className="text-sm text-blue-400 hover:text-blue-300">
            Back to Traces
          </Link>
          <h1 className="mt-3 text-2xl font-bold text-white">Trace Detail</h1>
          <p className="mt-1 break-all font-mono text-xs text-gray-500">{traceId}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {summary?.deployment?.near_deployment && summary.deployment.deployment_id ? (
            <Link
              href={`/deployments/${encodeURIComponent(summary.deployment.deployment_id)}`}
              className="rounded border border-amber-600 bg-amber-950/40 px-3 py-1.5 text-xs font-medium text-amber-200 hover:border-amber-400"
            >
              Near deployment
            </Link>
          ) : null}
          <Link
            href={buildLogsHref(traceId)}
            className="rounded border border-surface-border bg-surface-card px-3 py-1.5 text-xs text-gray-200 hover:border-blue-500"
          >
            View related logs
          </Link>
        </div>
      </div>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {metricValue('Duration', formatDuration(summary?.duration_ms ?? durationMs))}
        {metricValue('Start time', formatDateTime(summary?.start_time))}
        {metricValue('Root service', summary?.root_service || 'Unknown')}
        {metricValue('Root operation', summary?.root_operation || 'Unknown')}
        {metricValue('Status', summary?.status || 'Unknown')}
        {metricValue('Spans', String(summary?.span_count ?? spans.length))}
        {metricValue('Errors', String(summary?.error_count ?? errorSpans.length))}
        {metricValue('Related logs', String(summary?.related_logs_count ?? relatedLogs.length))}
      </section>

      <section className="rounded border border-surface-border bg-surface-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">Critical Path</h2>
            <p className="mt-1 text-sm text-gray-400">
              {formatDuration(criticalPath.duration_ms)} across {criticalPath.span_ids.length} span
              {criticalPath.span_ids.length === 1 ? '' : 's'}
            </p>
          </div>
          <div className="text-xs text-gray-500">
            {summary?.services.length ? summary.services.join(', ') : 'No services'}
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="overflow-hidden rounded border border-surface-border">
          <div className="grid grid-cols-[minmax(280px,360px)_90px_minmax(220px,1fr)_84px_90px] items-center gap-3 border-b border-surface-border bg-surface-card px-4 py-2 text-xs uppercase tracking-wide text-gray-500">
            <div>Span</div>
            <div>Offset</div>
            <div>Waterfall</div>
            <div>Status</div>
            <div className="text-right">Duration</div>
          </div>

          {flatSpans.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-gray-400">No spans found.</div>
          ) : (
            <div className="divide-y divide-surface-border/50">
              {flatSpans.map(({ span, depth, hasChildren }) => {
                const startOffset = Math.max(getTimestampMs(span.timestamp) - startMs, 0);
                const leftPercent = Math.min((startOffset / durationMs) * 100, 100);
                const rawWidth = (Math.max(span.duration_ms, 0) / durationMs) * 100;
                const widthPercent = Math.max(Math.min(rawWidth, 100 - leftPercent), 0.7);
                const selected = selectedSpanId === span.span_id;
                const critical = criticalSpanIds.has(span.span_id);

                return (
                  <div
                    key={span.span_id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedSpanId(span.span_id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setSelectedSpanId(span.span_id);
                      }
                    }}
                    className={`grid w-full grid-cols-[minmax(280px,360px)_90px_minmax(220px,1fr)_84px_90px] items-center gap-3 px-4 py-2 text-left text-sm transition-colors hover:bg-surface-card/70 ${
                      selected ? 'bg-blue-950/30' : critical ? 'bg-amber-950/20' : ''
                    }`}
                  >
                    <div className="min-w-0">
                      <div
                        className="flex min-w-0 items-center gap-2"
                        style={{ paddingLeft: depth * 16 }}
                      >
                        {hasChildren ? (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              toggleSpan(span.span_id);
                            }}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                event.stopPropagation();
                                toggleSpan(span.span_id);
                              }
                            }}
                            className="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-surface-border text-xs text-gray-300"
                            aria-label={
                              expandedSpanIds.has(span.span_id) ? 'Collapse span' : 'Expand span'
                            }
                          >
                            {expandedSpanIds.has(span.span_id) ? '-' : '+'}
                          </button>
                        ) : (
                          <span className="h-5 w-5 shrink-0" />
                        )}
                        <span
                          className={`h-2.5 w-2.5 shrink-0 rounded-full ${statusDotClass(span.status_code)}`}
                        />
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-white">
                            {span.operation_name}
                          </span>
                          <span className="block truncate text-xs text-gray-500">
                            {span.service_name}
                          </span>
                        </span>
                      </div>
                    </div>
                    <div className="font-mono text-xs text-gray-400">
                      {formatOffset(startOffset)}
                    </div>
                    <div className="relative h-7 rounded bg-gray-950/60">
                      <div
                        className={`absolute top-1 h-5 rounded-sm ${
                          span.status_code === 'ERROR'
                            ? 'bg-red-500'
                            : critical
                              ? 'bg-amber-400'
                              : 'bg-blue-500'
                        }`}
                        style={{
                          left: `${leftPercent}%`,
                          width: `${widthPercent}%`,
                          minWidth: '3px',
                        }}
                      />
                    </div>
                    <div>
                      <span
                        className={`rounded border px-2 py-1 text-xs ${statusClass(span.status_code)}`}
                      >
                        {span.status_code}
                      </span>
                    </div>
                    <div className="text-right font-mono text-xs text-gray-300">
                      {formatDuration(span.duration_ms)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <aside className="space-y-4">
          <section className="rounded border border-surface-border bg-surface-card p-4">
            <h2 className="mb-3 text-lg font-semibold text-white">Span Detail</h2>
            {selectedSpan ? (
              <div className="space-y-3 text-sm">
                <div>
                  <div className="text-xs uppercase tracking-wide text-gray-500">Operation</div>
                  <div className="mt-1 text-white">{selectedSpan.operation_name}</div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-xs uppercase tracking-wide text-gray-500">Service</div>
                    <Link
                      href={`/services/${encodeURIComponent(selectedSpan.service_name)}`}
                      className="mt-1 block truncate text-blue-300 hover:text-blue-200"
                    >
                      {selectedSpan.service_name}
                    </Link>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wide text-gray-500">Kind</div>
                    <div className="mt-1 text-gray-200">{selectedSpan.kind}</div>
                  </div>
                </div>
                <div className="grid gap-2 font-mono text-xs text-gray-300">
                  <div>
                    <span className="text-gray-500">span_id</span> {selectedSpan.span_id}
                  </div>
                  <div>
                    <span className="text-gray-500">parent_span_id</span>{' '}
                    {selectedSpan.parent_span_id || 'root'}
                  </div>
                  <div>
                    <span className="text-gray-500">trace_id</span> {selectedSpan.trace_id}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-xs uppercase tracking-wide text-gray-500">Status</div>
                    <div className="mt-1 text-gray-200">{selectedSpan.status_code}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wide text-gray-500">Duration</div>
                    <div className="mt-1 text-gray-200">
                      {formatDuration(selectedSpan.duration_ms)}
                    </div>
                  </div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wide text-gray-500">Start</div>
                  <div className="mt-1 text-gray-200">{formatDateTime(selectedSpan.timestamp)}</div>
                </div>
                {selectedSpan.status_message ? (
                  <div>
                    <div className="text-xs uppercase tracking-wide text-gray-500">
                      Status message
                    </div>
                    <div className="mt-1 text-red-200">{selectedSpan.status_message}</div>
                  </div>
                ) : null}
                <div>
                  <div className="mb-2 text-xs uppercase tracking-wide text-gray-500">
                    Attributes
                  </div>
                  {attributeRows(selectedSpan.attributes).length > 0 ? (
                    <div className="max-h-56 overflow-auto rounded border border-surface-border bg-gray-950/70">
                      {attributeRows(selectedSpan.attributes).map(([key, value]) => (
                        <div
                          key={key}
                          className="grid grid-cols-[130px_minmax(0,1fr)] gap-2 border-b border-surface-border/40 px-3 py-2 text-xs last:border-b-0"
                        >
                          <span className="truncate font-mono text-gray-500">{key}</span>
                          <span className="break-words text-gray-300">{value}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-sm text-gray-500">No attributes</div>
                  )}
                </div>
                <div>
                  <div className="mb-2 text-xs uppercase tracking-wide text-gray-500">
                    Related logs
                  </div>
                  {(logsBySpanId.get(selectedSpan.span_id) ?? []).length > 0 ? (
                    <Link
                      href={buildLogsHref(traceId, selectedSpan.span_id)}
                      className="text-sm text-blue-300 hover:text-blue-200"
                    >
                      {(logsBySpanId.get(selectedSpan.span_id) ?? []).length} log
                      {(logsBySpanId.get(selectedSpan.span_id) ?? []).length === 1 ? '' : 's'}
                    </Link>
                  ) : (
                    <div className="text-sm text-gray-500">No logs for this span</div>
                  )}
                </div>
              </div>
            ) : (
              <div className="text-sm text-gray-500">Select a span to inspect it.</div>
            )}
          </section>
        </aside>
      </div>

      <section className="rounded border border-surface-border bg-surface-card p-4">
        <h2 className="mb-3 text-lg font-semibold text-white">Service Breakdown</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="py-2 pr-4 font-medium">Service</th>
                <th className="py-2 pr-4 font-medium">Total time</th>
                <th className="py-2 pr-4 font-medium">Spans</th>
                <th className="py-2 pr-4 font-medium">Errors</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border/50">
              {serviceBreakdown.map((service) => (
                <tr key={service.service_name}>
                  <td className="py-2 pr-4 text-white">{service.service_name}</td>
                  <td className="py-2 pr-4 font-mono text-gray-300">
                    {formatDuration(service.total_time_ms)}
                  </td>
                  <td className="py-2 pr-4 text-gray-300">{service.span_count}</td>
                  <td className="py-2 pr-4 text-gray-300">{service.error_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded border border-surface-border bg-surface-card p-4">
        <h2 className="mb-3 text-lg font-semibold text-white">Errors</h2>
        {errorSpans.length === 0 ? (
          <div className="text-sm text-gray-500">No error spans.</div>
        ) : (
          <div className="space-y-3">
            {errorSpans.map((span) => (
              <div
                key={span.span_id}
                className="rounded border border-red-900/70 bg-red-950/20 p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="font-medium text-red-100">{span.operation_name}</div>
                    <div className="text-xs text-gray-500">{span.service_name}</div>
                  </div>
                  <Link
                    href={buildLogsHref(traceId, span.span_id)}
                    className="text-xs text-blue-300 hover:text-blue-200"
                  >
                    Related logs
                  </Link>
                </div>
                {span.status_message ? (
                  <div className="mt-2 text-sm text-red-200">{span.status_message}</div>
                ) : null}
                {errorAttributes(span).length > 0 ? (
                  <div className="mt-2 grid gap-1 text-xs">
                    {errorAttributes(span).map(([key, value]) => (
                      <div key={key} className="grid grid-cols-[160px_minmax(0,1fr)] gap-2">
                        <span className="font-mono text-gray-500">{key}</span>
                        <span className="break-words text-gray-300">{value}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rounded border border-surface-border bg-surface-card p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-white">Related Logs</h2>
          <select
            value={logSpanFilter}
            onChange={(event) => setLogSpanFilter(event.target.value)}
            className="rounded border border-surface-border bg-background px-3 py-2 text-sm text-white"
          >
            <option value="">All spans</option>
            {spans.map((span) => (
              <option key={span.span_id} value={span.span_id}>
                {span.operation_name}
              </option>
            ))}
          </select>
        </div>
        {logsLoading ? (
          <div className="py-6 text-center text-sm text-gray-400">Loading related logs...</div>
        ) : logsError ? (
          <div className="rounded border border-red-700 bg-red-950/40 p-3 text-sm text-red-200">
            {logsError}
          </div>
        ) : relatedLogs.length === 0 ? (
          <div className="py-6 text-center text-sm text-gray-500">No related logs.</div>
        ) : (
          <div className="divide-y divide-surface-border/50">
            {relatedLogs.slice(0, 50).map((log) => (
              <Link
                key={log.id}
                href={buildLogsHref(traceId, log.span_id)}
                className="grid gap-2 px-1 py-3 text-sm hover:bg-gray-950/40 md:grid-cols-[170px_80px_180px_minmax(0,1fr)]"
              >
                <span className="font-mono text-xs text-gray-500">
                  {formatDateTime(log.timestamp)}
                </span>
                <span className={log.severity === 'ERROR' ? 'text-red-300' : 'text-gray-300'}>
                  {log.severity}
                </span>
                <span className="truncate font-mono text-xs text-gray-500">{log.span_id}</span>
                <span className="truncate text-gray-200">{log.message}</span>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="rounded border border-surface-border bg-surface-card p-4">
        <h2 className="mb-3 text-lg font-semibold text-white">Similar Traces</h2>
        {similarTraces.length === 0 ? (
          <div className="text-sm text-gray-500">No similar traces found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="py-2 pr-4 font-medium">Trace ID</th>
                  <th className="py-2 pr-4 font-medium">Duration</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 pr-4 font-medium">Errors</th>
                  <th className="py-2 pr-4 font-medium">Start</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-border/50">
                {similarTraces.map((trace) => (
                  <tr key={trace.trace_id}>
                    <td className="max-w-[260px] py-2 pr-4">
                      <Link
                        href={`/traces/${encodeURIComponent(trace.trace_id)}${
                          searchParams.toString() ? `?${searchParams.toString()}` : ''
                        }`}
                        className="truncate font-mono text-xs text-blue-300 hover:text-blue-200"
                      >
                        {trace.trace_id}
                      </Link>
                    </td>
                    <td className="py-2 pr-4 font-mono text-gray-300">
                      {formatDuration(trace.duration_ms)}
                    </td>
                    <td className="py-2 pr-4">
                      <span
                        className={`rounded border px-2 py-1 text-xs ${statusClass(trace.status)}`}
                      >
                        {trace.status}
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-gray-300">{trace.error_count}</td>
                    <td className="py-2 pr-4 text-gray-400">{formatDateTime(trace.start_time)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
