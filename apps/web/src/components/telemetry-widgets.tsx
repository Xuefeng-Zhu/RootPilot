'use client';

import type { ReactNode } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { cn, EmptyState } from './ui';

export function FilterBar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex flex-wrap items-center gap-3', className)}>{children}</div>;
}

export function DataTable({
  columns,
  rows,
  emptyLabel,
}: {
  columns: string[];
  rows: ReactNode[][];
  emptyLabel: string;
}) {
  if (rows.length === 0) return <EmptyState title={emptyLabel} />;
  return (
    <div className="overflow-x-auto">
      <table className="rp-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DetailDrawer({
  title,
  open,
  onClose,
  children,
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <aside className="fixed right-0 top-0 z-50 h-screen w-full max-w-xl animate-slide-in border-l border-surface-border bg-surface-card shadow-panel">
      <div className="flex items-center justify-between border-b border-surface-border px-4 py-3">
        <h2 className="text-sm font-semibold text-white">{title}</h2>
        <button
          type="button"
          onClick={onClose}
          className="rp-button h-8 w-8 p-0"
          aria-label="Close drawer"
        >
          ×
        </button>
      </div>
      <div className="h-[calc(100vh-49px)] overflow-y-auto p-4">{children}</div>
    </aside>
  );
}

export function MetricLineChart({
  data,
  lines,
  height = 280,
}: {
  data: Array<Record<string, string | number | null>>;
  lines: Array<{ key: string; color: string }>;
  height?: number;
}) {
  if (data.length === 0) return <EmptyState title="No chart data available" />;
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <CartesianGrid stroke="#1d2a3a" strokeDasharray="3 3" />
          <XAxis dataKey="time" stroke="#64748b" tickLine={false} axisLine={false} />
          <YAxis stroke="#64748b" tickLine={false} axisLine={false} />
          <Tooltip
            contentStyle={{
              background: '#0d1520',
              border: '1px solid #1d2a3a',
              borderRadius: '8px',
              color: '#e2e8f0',
            }}
          />
          {lines.map((line) => (
            <Line
              key={line.key}
              type="monotone"
              dataKey={line.key}
              stroke={line.color}
              strokeWidth={2}
              dot={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function TraceWaterfall({
  rows,
}: {
  rows: Array<{
    id: string;
    service: string;
    operation: string;
    offset: number;
    duration: number;
    status: string;
  }>;
}) {
  const total = Math.max(...rows.map((row) => row.offset + row.duration), 1);
  if (rows.length === 0) return <EmptyState title="No spans available" />;
  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <div key={row.id} className="grid grid-cols-[220px_1fr_80px] items-center gap-3 text-xs">
          <div className="min-w-0">
            <p className="truncate font-medium text-white">{row.operation}</p>
            <p className="truncate text-slate-500">{row.service}</p>
          </div>
          <div className="h-5 rounded bg-surface-subtle">
            <div
              className={cn(
                'h-5 rounded',
                row.status === 'ERROR' ? 'bg-red-400/70' : 'bg-cyan-400/65',
              )}
              style={{
                marginLeft: `${(row.offset / total) * 100}%`,
                width: `${Math.max((row.duration / total) * 100, 1)}%`,
              }}
            />
          </div>
          <div className="text-right text-slate-400">{Math.round(row.duration)} ms</div>
        </div>
      ))}
    </div>
  );
}

export function ServiceMapGraph({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-auto rounded-lg border border-surface-border bg-[radial-gradient(circle,_rgba(51,65,85,0.45)_1px,_transparent_1px)] [background-size:18px_18px]">
      {children}
    </div>
  );
}

export function FacetSidebar({
  sections,
  onSelect,
}: {
  sections: Array<{ title: string; values: Array<{ value: string; count: number }> }>;
  onSelect: (title: string, value: string) => void;
}) {
  return (
    <aside className="rp-panel p-3">
      {sections.map((section) => (
        <div
          key={section.title}
          className="border-b border-surface-border py-3 first:pt-0 last:border-0"
        >
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {section.title}
          </h3>
          <div className="mt-2 space-y-1">
            {section.values.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => onSelect(section.title, item.value)}
                className="flex w-full items-center justify-between rounded px-2 py-1 text-left text-xs text-slate-300 hover:bg-surface-raised"
              >
                <span className="truncate">{item.value}</span>
                <span className="text-slate-500">{item.count}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </aside>
  );
}
