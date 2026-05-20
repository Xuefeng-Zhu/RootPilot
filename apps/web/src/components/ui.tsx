'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';
import { CheckIcon, CopyIcon, SearchIcon } from './icons';

export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
}

export function PageTitle({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-white">{title}</h1>
        {description && <p className="mt-1 text-sm text-slate-400">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Panel({
  children,
  className,
  title,
  action,
}: {
  children: ReactNode;
  className?: string;
  title?: string;
  action?: ReactNode;
}) {
  return (
    <section className={cn('rp-panel', className)}>
      {(title || action) && (
        <div className="flex items-center justify-between gap-3 border-b border-surface-border px-4 py-3">
          {title && <h2 className="text-sm font-semibold text-white">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function StatCard({
  label,
  value,
  delta,
  tone = 'neutral',
  children,
}: {
  label: string;
  value: ReactNode;
  delta?: string;
  tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'info' | 'purple';
  children?: ReactNode;
}) {
  const toneClass = {
    neutral: 'text-slate-400',
    good: 'text-emerald-300',
    warn: 'text-amber-300',
    bad: 'text-red-300',
    info: 'text-cyan-300',
    purple: 'text-purple-300',
  }[tone];

  return (
    <div className="rp-panel p-4 transition-colors hover:border-cyan-400/35">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className="mt-2 flex items-end justify-between gap-3">
        <div className="text-2xl font-semibold tracking-tight text-white">{value}</div>
        {delta && <div className={cn('text-xs font-medium', toneClass)}>{delta}</div>}
      </div>
      {children && <div className="mt-3">{children}</div>}
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const normalized = status.toLowerCase();
  const className =
    normalized.includes('error') || normalized.includes('critical')
      ? 'border-red-500/35 bg-red-500/10 text-red-300'
      : normalized.includes('warn') || normalized.includes('medium')
        ? 'border-amber-500/35 bg-amber-500/10 text-amber-300'
        : normalized.includes('healthy') || normalized.includes('ok') || normalized.includes('low')
          ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-300'
          : normalized.includes('degraded') || normalized.includes('high')
            ? 'border-red-500/35 bg-red-500/10 text-red-300'
            : 'border-slate-600 bg-slate-800/70 text-slate-300';
  return (
    <span className={cn('inline-flex items-center rounded border px-2 py-0.5 text-xs', className)}>
      {titleCase(status)}
    </span>
  );
}

export function HealthBadge({ status }: { status: string }) {
  const color =
    status === 'healthy'
      ? 'bg-emerald-400 text-emerald-200'
      : status === 'warning'
        ? 'bg-amber-400 text-amber-200'
        : status === 'degraded' || status === 'critical'
          ? 'bg-red-400 text-red-200'
          : 'bg-slate-500 text-slate-300';
  return (
    <span className="inline-flex items-center gap-2 text-xs font-medium">
      <span className={cn('h-2 w-2 rounded-full', color.split(' ')[0])} />
      <span className={color.split(' ')[1]}>{titleCase(status)}</span>
    </span>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder = 'Search...',
  className,
  'aria-label': ariaLabel = 'Search',
}: {
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  className?: string;
  'aria-label'?: string;
}) {
  return (
    <label className={cn('relative block', className)}>
      <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
      <input
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className="rp-input w-full pl-9"
      />
    </label>
  );
}

export function TimeRangePicker({
  value,
  onChange,
  options = ['15m', '1h', '6h', '24h', '7d'],
}: {
  value: string;
  onChange: (value: string) => void;
  options?: string[];
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      aria-label="Select time range"
      className="rp-input"
    >
      {options.map((option) => (
        <option key={option} value={option}>
          Last {option}
        </option>
      ))}
    </select>
  );
}

export function EnvironmentSelector({
  value,
  onChange,
  environments,
}: {
  value: string;
  onChange: (value: string) => void;
  environments: string[];
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      aria-label="Select environment"
      className="rp-input"
    >
      <option value="">All environments</option>
      {environments.map((environment) => (
        <option key={environment} value={environment}>
          {environment}
        </option>
      ))}
    </select>
  );
}

export function LoadingState({ label = 'Loading...' }: { label?: string }) {
  return (
    <div className="rp-panel flex min-h-36 items-center justify-center p-8 text-sm text-slate-400">
      {label}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="rp-panel flex min-h-36 flex-col items-center justify-center p-8 text-center">
      <p className="text-sm font-medium text-slate-200">{title}</p>
      {description && <p className="mt-2 max-w-lg text-sm text-slate-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
      {message}
    </div>
  );
}

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <button type="button" onClick={copy} className="rp-button px-2 py-1 text-xs" aria-label={label}>
      {copied ? (
        <CheckIcon className="h-3.5 w-3.5 text-emerald-300" />
      ) : (
        <CopyIcon className="h-3.5 w-3.5" />
      )}
      {copied ? 'Copied' : label}
    </button>
  );
}

export function MiniSparkline({ points, color = '#22d3ee' }: { points: number[]; color?: string }) {
  const max = Math.max(...points, 1);
  const min = Math.min(...points, 0);
  const spread = Math.max(max - min, 1);
  const d = points
    .map((point, index) => {
      const x = (index / Math.max(points.length - 1, 1)) * 100;
      const y = 34 - ((point - min) / spread) * 28;
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(' ');
  return (
    <svg viewBox="0 0 100 40" className="h-10 w-full" aria-hidden="true">
      <path d={d} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function ServiceHealthBar({
  healthy,
  warning,
  critical,
  unknown,
}: {
  healthy: number;
  warning: number;
  critical: number;
  unknown: number;
}) {
  const total = Math.max(healthy + warning + critical + unknown, 1);
  const segments = [
    { value: healthy, color: 'bg-emerald-400', label: 'Healthy' },
    { value: warning, color: 'bg-amber-400', label: 'Warning' },
    { value: critical, color: 'bg-red-400', label: 'Critical' },
    { value: unknown, color: 'bg-slate-500', label: 'Unknown' },
  ];
  return (
    <div>
      <div className="flex h-2 overflow-hidden rounded-full bg-surface-subtle">
        {segments.map((segment) => (
          <div
            key={segment.label}
            className={segment.color}
            style={{ width: `${(segment.value / total) * 100}%` }}
            title={`${segment.label}: ${segment.value}`}
          />
        ))}
      </div>
      <div className="mt-3 grid grid-cols-4 gap-2 text-xs">
        {segments.map((segment) => (
          <div key={segment.label}>
            <p className="font-semibold text-white">{segment.value}</p>
            <p className="text-slate-500">{segment.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export function titleCase(value: string): string {
  if (!value) return 'Unknown';
  return value.replace(/[-_]/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}
