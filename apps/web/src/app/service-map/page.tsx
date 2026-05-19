'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { ServiceMapEdge, ServiceMapNode, ServiceMapResponse } from '@rootpilot/shared';
import { apiClient } from '../../lib/api';
import { formatMs, formatNumber, formatPercent, formatShortTimestamp } from '../../lib/format';
import {
  EmptyState,
  ErrorState,
  HealthBadge,
  PageTitle,
  Panel,
  StatusBadge,
} from '../../components/ui';

type TimeRange = '1h' | '6h' | '24h';

interface PositionedNode extends ServiceMapNode {
  x: number;
  y: number;
}

const WIDTH = 1120;
const HEIGHT = 620;
const NODE_WIDTH = 178;
const NODE_HEIGHT = 66;

export default function ServiceMapPage() {
  const [nodes, setNodes] = useState<ServiceMapNode[]>([]);
  const [edges, setEdges] = useState<ServiceMapEdge[]>([]);
  const [environment, setEnvironment] = useState('');
  const [timeRange, setTimeRange] = useState<TimeRange>('1h');
  const [selectedEdge, setSelectedEdge] = useState<ServiceMapEdge | null>(null);
  const [selectedNode, setSelectedNode] = useState<ServiceMapNode | null>(null);
  const [zoom, setZoom] = useState(1);
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
        setSelectedNode(null);
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

  const selectedPanel = selectedNode ? (
    <NodeDetails node={selectedNode} />
  ) : selectedEdge ? (
    <EdgeDetails edge={selectedEdge} />
  ) : (
    <p className="text-sm text-slate-400">
      Select a node or edge to inspect traffic, latency, errors, and trace links.
    </p>
  );

  return (
    <div className="space-y-5">
      <PageTitle
        title="Service Map"
        description="Dependency graph inferred from spans and refreshed correlation data."
        actions={
          <>
            <select
              value={environment}
              onChange={(event) => setEnvironment(event.target.value)}
              aria-label="Filter service map by environment"
              className="rp-input"
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
              className="rp-input"
            >
              <option value="1h">Last hour</option>
              <option value="6h">Last 6 hours</option>
              <option value="24h">Last 24 hours</option>
            </select>
          </>
        }
      />

      {loading && (
        <Panel>
          <div className="p-8 text-center text-sm text-slate-400">Loading service map...</div>
        </Panel>
      )}

      {error && <ErrorState message={error} />}

      {!loading && !error && nodes.length === 0 && (
        <EmptyState
          title="No service dependencies found"
          description="Run npm run simulate:graph and npm run correlations:refresh to build the map."
        />
      )}

      {!loading && !error && nodes.length > 0 && (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_340px]">
          <Panel
            className="overflow-hidden"
            title={`${nodes.length} services, ${edges.length} dependencies`}
            action={<GraphLegend />}
          >
            <div className="flex items-center justify-between border-b border-surface-border px-4 py-3">
              <div className="text-xs text-slate-500">
                Click services or dependencies to inspect details. Double click a service name in
                the side panel to drill into service detail.
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="rp-button h-8 w-8 p-0"
                  onClick={() => setZoom((value) => Math.max(0.8, value - 0.1))}
                  aria-label="Zoom out"
                >
                  -
                </button>
                <span className="w-12 text-center text-xs text-slate-500">
                  {Math.round(zoom * 100)}%
                </span>
                <button
                  type="button"
                  className="rp-button h-8 w-8 p-0"
                  onClick={() => setZoom((value) => Math.min(1.3, value + 0.1))}
                  aria-label="Zoom in"
                >
                  +
                </button>
              </div>
            </div>
            <div className="overflow-auto bg-[radial-gradient(circle,_rgba(51,65,85,0.45)_1px,_transparent_1px)] [background-size:18px_18px]">
              <svg
                viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
                className="h-[620px] w-full min-w-[920px]"
                style={{ transform: `scale(${zoom})`, transformOrigin: 'center' }}
              >
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
                  <filter id="nodeGlow" x="-30%" y="-30%" width="160%" height="160%">
                    <feDropShadow
                      dx="0"
                      dy="0"
                      stdDeviation="4"
                      floodColor="#22d3ee"
                      floodOpacity="0.18"
                    />
                  </filter>
                </defs>

                {edges.map((edge) => {
                  const source = nodeById.get(serviceNodeKey(edge.source, edge.environment));
                  const target = nodeById.get(serviceNodeKey(edge.target, edge.environment));
                  if (!source || !target) return null;
                  const strokeWidth = Math.min(6, Math.max(1.5, edge.call_count / 40));
                  const hasErrors = edge.error_count > 0 || edge.p95_duration_ms >= 500;
                  const midX = (source.x + target.x) / 2;
                  const midY = (source.y + target.y) / 2;
                  const selected = selectedEdge?.id === edge.id;
                  return (
                    <g
                      key={edge.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        setSelectedEdge(edge);
                        setSelectedNode(null);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          setSelectedEdge(edge);
                          setSelectedNode(null);
                        }
                      }}
                      className="cursor-pointer"
                    >
                      <line
                        x1={source.x}
                        y1={source.y}
                        x2={target.x}
                        y2={target.y}
                        stroke={hasErrors ? '#f87171' : '#2dd4bf'}
                        strokeWidth={strokeWidth}
                        strokeOpacity={selected ? 0.95 : 0.48}
                        markerEnd="url(#arrow)"
                      />
                      <text
                        x={midX}
                        y={midY - 8}
                        fill={hasErrors ? '#fca5a5' : '#a7f3d0'}
                        fontSize="12"
                        textAnchor="middle"
                        className="select-none"
                      >
                        {formatNumber(edge.call_count)}
                      </text>
                      <text
                        x={midX}
                        y={midY + 8}
                        fill="#94a3b8"
                        fontSize="11"
                        textAnchor="middle"
                        className="select-none"
                      >
                        {formatPercent(edge.error_count, edge.call_count)}
                      </text>
                    </g>
                  );
                })}

                {positionedNodes.map((node) => {
                  const selected =
                    selectedNode?.id === node.id && selectedNode.environment === node.environment;
                  return (
                    <g
                      key={`${node.id}-${node.environment}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        setSelectedNode(node);
                        setSelectedEdge(null);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          setSelectedNode(node);
                          setSelectedEdge(null);
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
                        fill="#0d1520"
                        stroke={nodeStroke(node.health_status)}
                        strokeWidth={selected ? 3 : 2}
                        filter={selected ? 'url(#nodeGlow)' : undefined}
                      />
                      <circle
                        cx={node.x - NODE_WIDTH / 2 + 18}
                        cy={node.y - 13}
                        r="6"
                        fill={nodeFill(node.health_status)}
                      />
                      <text
                        x={node.x - 60}
                        y={node.y - 9}
                        fill="#f8fafc"
                        fontSize="13"
                        fontWeight="600"
                      >
                        {node.name}
                      </text>
                      <text x={node.x - 60} y={node.y + 13} fill="#94a3b8" fontSize="11">
                        {formatCompact(node.request_count)} rpm ·{' '}
                        {formatPercent(node.error_count, node.request_count)}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>
          </Panel>

          <aside className="space-y-5">
            <Panel title="Health Legend">
              <div className="space-y-3 p-4 text-sm">
                {['healthy', 'warning', 'degraded', 'unknown'].map((status) => (
                  <div key={status} className="flex items-center justify-between">
                    <HealthBadge status={status} />
                    <span className="text-slate-400">
                      {nodes.filter((node) => node.health_status === status).length}
                    </span>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel
              title={
                selectedNode
                  ? 'Service Detail'
                  : selectedEdge
                    ? 'Dependency Detail'
                    : 'Graph Detail'
              }
            >
              <div className="min-h-[240px] p-4">{selectedPanel}</div>
            </Panel>
          </aside>
        </div>
      )}
    </div>
  );
}

function NodeDetails({ node }: { node: ServiceMapNode }) {
  return (
    <div className="space-y-4 text-sm">
      <div>
        <div className="flex items-center justify-between gap-3">
          <p className="font-semibold text-white">{node.name}</p>
          <HealthBadge status={node.health_status} />
        </div>
        <p className="mt-1 text-slate-500">{node.environment}</p>
      </div>
      <MetricRow label="Requests" value={formatNumber(node.request_count)} />
      <MetricRow label="Error rate" value={formatPercent(node.error_count, node.request_count)} />
      <MetricRow label="p95 latency" value={formatMs(node.p95_latency_ms)} />
      <MetricRow label="Last seen" value={formatShortTimestamp(node.last_seen_at)} />
      {node.latest_version && <MetricRow label="Version" value={node.latest_version} />}
      <Link
        href={`/services/${encodeURIComponent(node.name)}?environment=${encodeURIComponent(node.environment)}`}
        className="rp-button rp-button-primary w-full"
      >
        Open service detail
      </Link>
    </div>
  );
}

function EdgeDetails({ edge }: { edge: ServiceMapEdge }) {
  return (
    <div className="space-y-4 text-sm">
      <div>
        <p className="text-xs uppercase tracking-wide text-slate-500">Edge</p>
        <p className="mt-1 font-semibold text-white">
          {edge.source} {'->'} {edge.target}
        </p>
        <p className="mt-1 text-slate-500">
          {edge.operation_name} · {edge.environment}
        </p>
      </div>
      <MetricRow label="Calls" value={formatNumber(edge.call_count)} />
      <MetricRow label="Errors" value={formatNumber(edge.error_count)} />
      <MetricRow label="Avg duration" value={formatMs(edge.avg_duration_ms)} />
      <MetricRow label="p95 duration" value={formatMs(edge.p95_duration_ms)} />
      <MetricRow label="Last seen" value={formatShortTimestamp(edge.last_seen_at)} />
      {edge.example_trace_id && (
        <Link
          href={`/traces/${encodeURIComponent(edge.example_trace_id)}`}
          className="rp-button rp-button-primary w-full"
        >
          Open example trace
        </Link>
      )}
    </div>
  );
}

function GraphLegend() {
  return (
    <div className="hidden items-center gap-3 text-xs text-slate-500 md:flex">
      <span className="inline-flex items-center gap-1">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
        Healthy
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
        Warning
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
        Critical
      </span>
      <StatusBadge status="traffic" />
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
    const x = 140 + column * 280;
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
  if (status === 'healthy') return '#34d399';
  if (status === 'warning') return '#f59e0b';
  if (status === 'degraded') return '#f87171';
  return '#64748b';
}

function nodeStroke(status: string): string {
  if (status === 'healthy') return '#10b981';
  if (status === 'warning') return '#d97706';
  if (status === 'degraded') return '#ef4444';
  return '#475569';
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-surface-border/60 pb-2 last:border-0 last:pb-0">
      <span className="text-slate-500">{label}</span>
      <span className="text-slate-200">{value}</span>
    </div>
  );
}

function formatCompact(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return formatNumber(value);
}
