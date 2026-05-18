'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ServiceMapEdge, ServiceMapNode, ServiceMapResponse } from '@rootpilot/shared';
import { apiClient } from '../../lib/api';
import { formatMs, formatNumber, formatShortTimestamp, healthTextColor } from '../../lib/format';

type TimeRange = '1h' | '6h' | '24h';

interface PositionedNode extends ServiceMapNode {
  x: number;
  y: number;
}

const WIDTH = 1120;
const HEIGHT = 620;
const NODE_WIDTH = 168;
const NODE_HEIGHT = 58;

export default function ServiceMapPage() {
  const router = useRouter();
  const [nodes, setNodes] = useState<ServiceMapNode[]>([]);
  const [edges, setEdges] = useState<ServiceMapEdge[]>([]);
  const [environment, setEnvironment] = useState('');
  const [timeRange, setTimeRange] = useState<TimeRange>('1h');
  const [selectedEdge, setSelectedEdge] = useState<ServiceMapEdge | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchMap() {
      try {
        setLoading(true);
        setError(null);
        const { from, to } = rangeToParams(timeRange);
        const response = await apiClient<ServiceMapResponse>('/v1/service-map', {
          params: { environment: environment || undefined, from, to },
        });
        setNodes(response.nodes);
        setEdges(response.edges);
        setSelectedEdge(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch service map');
      } finally {
        setLoading(false);
      }
    }

    fetchMap();
  }, [environment, timeRange]);

  const environments = useMemo(
    () => [...new Set(nodes.map((node) => node.environment).filter(Boolean))].sort(),
    [nodes],
  );
  const positionedNodes = useMemo(() => positionNodes(nodes), [nodes]);
  const nodeById = useMemo(
    () =>
      new Map(positionedNodes.map((node) => [serviceNodeKey(node.name, node.environment), node])),
    [positionedNodes],
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Service Map</h1>
          <p className="text-sm text-gray-400 mt-1">
            Dependency graph inferred from parent and child spans.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={environment}
            onChange={(event) => setEnvironment(event.target.value)}
            aria-label="Filter service map by environment"
            className="px-3 py-2 text-sm bg-surface-card border border-surface-border rounded text-gray-300 focus:outline-none focus:border-sidebar-active"
          >
            <option value="">All Environments</option>
            {environments.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <select
            value={timeRange}
            onChange={(event) => setTimeRange(event.target.value as TimeRange)}
            aria-label="Filter service map by time range"
            className="px-3 py-2 text-sm bg-surface-card border border-surface-border rounded text-gray-300 focus:outline-none focus:border-sidebar-active"
          >
            <option value="1h">Last hour</option>
            <option value="6h">Last 6 hours</option>
            <option value="24h">Last 24 hours</option>
          </select>
        </div>
      </div>

      {loading && <div className="text-gray-400">Loading service map...</div>}

      {error && (
        <div className="bg-red-900/30 border border-red-700 rounded-lg p-4 text-red-300">
          {error}
        </div>
      )}

      {!loading && !error && nodes.length === 0 && (
        <div className="bg-surface-card border border-surface-border rounded-lg p-8 text-center">
          <p className="text-gray-400 text-lg">No service graph data yet</p>
          <p className="text-gray-500 text-sm mt-2">
            Run `npm run simulate:graph` and `npm run phase2:refresh` to build the map.
          </p>
        </div>
      )}

      {!loading && !error && nodes.length > 0 && (
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-5">
          <section className="bg-surface-card border border-surface-border rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-surface-border flex items-center justify-between">
              <div className="text-sm text-gray-300">
                {nodes.length} services, {edges.length} dependencies
              </div>
              <div className="text-xs text-gray-500">
                Click a service to drill in, or click an edge for details.
              </div>
            </div>
            <div className="overflow-auto">
              <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="min-w-[920px] w-full h-[620px]">
                <defs>
                  <marker
                    id="arrow"
                    markerWidth="10"
                    markerHeight="10"
                    refX="10"
                    refY="3"
                    orient="auto"
                    markerUnits="strokeWidth"
                  >
                    <path d="M0,0 L0,6 L9,3 z" fill="#64748b" />
                  </marker>
                </defs>

                {edges.map((edge) => {
                  const source = nodeById.get(serviceNodeKey(edge.source, edge.environment));
                  const target = nodeById.get(serviceNodeKey(edge.target, edge.environment));
                  if (!source || !target) return null;
                  const strokeWidth = Math.min(6, Math.max(1.5, edge.call_count / 40));
                  const hasErrors = edge.error_count > 0 || edge.p95_duration_ms >= 500;
                  const midX = (source.x + target.x) / 2;
                  const midY = (source.y + target.y) / 2;
                  return (
                    <g
                      key={edge.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedEdge(edge)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') setSelectedEdge(edge);
                      }}
                      className="cursor-pointer"
                    >
                      <line
                        x1={source.x}
                        y1={source.y}
                        x2={target.x}
                        y2={target.y}
                        stroke={hasErrors ? '#f87171' : '#64748b'}
                        strokeWidth={strokeWidth}
                        strokeOpacity={selectedEdge?.id === edge.id ? 0.95 : 0.55}
                        markerEnd="url(#arrow)"
                      />
                      <text
                        x={midX}
                        y={midY - 6}
                        fill="#cbd5e1"
                        fontSize="12"
                        textAnchor="middle"
                        className="select-none"
                      >
                        {formatNumber(edge.call_count)}
                      </text>
                    </g>
                  );
                })}

                {positionedNodes.map((node) => (
                  <g
                    key={`${node.id}-${node.environment}`}
                    role="button"
                    tabIndex={0}
                    onClick={() =>
                      router.push(
                        `/services/${encodeURIComponent(node.name)}?environment=${encodeURIComponent(
                          node.environment,
                        )}`,
                      )
                    }
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        router.push(
                          `/services/${encodeURIComponent(node.name)}?environment=${encodeURIComponent(
                            node.environment,
                          )}`,
                        );
                      }
                    }}
                    className="cursor-pointer"
                  >
                    <rect
                      x={node.x - NODE_WIDTH / 2}
                      y={node.y - NODE_HEIGHT / 2}
                      width={NODE_WIDTH}
                      height={NODE_HEIGHT}
                      rx="8"
                      fill="#111827"
                      stroke={nodeStroke(node.health_status)}
                      strokeWidth="2"
                    />
                    <circle
                      cx={node.x - NODE_WIDTH / 2 + 18}
                      cy={node.y - 10}
                      r="5"
                      fill={nodeFill(node.health_status)}
                    />
                    <text
                      x={node.x - 54}
                      y={node.y - 6}
                      fill="#f8fafc"
                      fontSize="13"
                      fontWeight="600"
                    >
                      {node.name}
                    </text>
                    <text x={node.x - 54} y={node.y + 15} fill="#94a3b8" fontSize="11">
                      {node.environment} · p95 {Math.round(node.p95_latency_ms)}ms
                    </text>
                  </g>
                ))}
              </svg>
            </div>
          </section>

          <aside className="space-y-4">
            <section className="bg-surface-card border border-surface-border rounded-lg p-4">
              <h2 className="text-sm font-semibold text-white mb-3">Health</h2>
              <div className="space-y-2 text-sm">
                {['healthy', 'warning', 'degraded', 'unknown'].map((status) => (
                  <div key={status} className="flex items-center justify-between">
                    <span className="flex items-center gap-2 text-gray-300">
                      <span
                        className="w-2 h-2 rounded-full"
                        style={{ background: nodeFill(status) }}
                      />
                      {titleCase(status)}
                    </span>
                    <span className={healthTextColor(status)}>
                      {nodes.filter((node) => node.health_status === status).length}
                    </span>
                  </div>
                ))}
              </div>
            </section>

            <section className="bg-surface-card border border-surface-border rounded-lg p-4 min-h-[230px]">
              <h2 className="text-sm font-semibold text-white mb-3">Dependency Detail</h2>
              {selectedEdge ? (
                <div className="space-y-3 text-sm">
                  <div>
                    <p className="text-gray-500 text-xs uppercase mb-1">Edge</p>
                    <p className="text-white font-medium">
                      {selectedEdge.source} {'->'} {selectedEdge.target}
                    </p>
                    <p className="text-gray-400">
                      {selectedEdge.operation_name} · {selectedEdge.environment}
                    </p>
                  </div>
                  <MetricRow label="Calls" value={formatNumber(selectedEdge.call_count)} />
                  <MetricRow label="Errors" value={formatNumber(selectedEdge.error_count)} />
                  <MetricRow label="Avg Duration" value={formatMs(selectedEdge.avg_duration_ms)} />
                  <MetricRow label="p95 Duration" value={formatMs(selectedEdge.p95_duration_ms)} />
                  <MetricRow
                    label="Last Seen"
                    value={formatShortTimestamp(selectedEdge.last_seen_at)}
                  />
                  {selectedEdge.example_trace_id && (
                    <a
                      href={`/traces/${encodeURIComponent(selectedEdge.example_trace_id)}`}
                      className="inline-flex text-sidebar-active hover:text-white text-sm"
                    >
                      Open example trace
                    </a>
                  )}
                </div>
              ) : (
                <p className="text-sm text-gray-400">
                  Select an edge to inspect call volume, latency, errors, and an example trace.
                </p>
              )}
            </section>
          </aside>
        </div>
      )}
    </div>
  );
}

function positionNodes(nodes: ServiceMapNode[]): PositionedNode[] {
  if (nodes.length === 0) return [];

  const preferredColumns: Record<string, number> = {
    'api-gateway': 0,
    'auth-service': 1,
    'checkout-service': 1,
    'search-service': 1,
    'recommendation-service': 1,
    'notification-service': 1,
    'inventory-service': 2,
    'payment-service': 2,
    'order-service': 2,
    'postgres-db': 3,
    'redis-cache': 3,
    'kafka-broker': 3,
  };
  const columns = new Map<number, ServiceMapNode[]>();

  for (const node of nodes) {
    const column = preferredColumns[node.name] ?? 2;
    const existing = columns.get(column) ?? [];
    existing.push(node);
    columns.set(column, existing);
  }

  return [...columns.entries()].flatMap(([column, columnNodes]) => {
    const x = 130 + column * 280;
    const gap = HEIGHT / (columnNodes.length + 1);
    return columnNodes
      .sort((a, b) => a.name.localeCompare(b.name) || a.environment.localeCompare(b.environment))
      .map((node, index) => ({
        ...node,
        x,
        y: gap * (index + 1),
      }));
  });
}

function serviceNodeKey(serviceName: string, environment: string): string {
  return `${environment}:${serviceName}`;
}

function rangeToParams(range: TimeRange): { from: string; to: string } {
  const to = new Date();
  const hours = range === '24h' ? 24 : range === '6h' ? 6 : 1;
  const from = new Date(to.getTime() - hours * 60 * 60 * 1000);
  return { from: from.toISOString(), to: to.toISOString() };
}

function nodeFill(status: string): string {
  if (status === 'healthy') return '#10b981';
  if (status === 'warning') return '#f59e0b';
  if (status === 'degraded') return '#ef4444';
  return '#64748b';
}

function nodeStroke(status: string): string {
  if (status === 'healthy') return '#047857';
  if (status === 'warning') return '#b45309';
  if (status === 'degraded') return '#b91c1c';
  return '#475569';
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-gray-500">{label}</span>
      <span className="text-gray-200">{value}</span>
    </div>
  );
}
