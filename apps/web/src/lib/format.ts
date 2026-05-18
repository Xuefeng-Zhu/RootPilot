export function formatTimestamp(value: string | null | undefined): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export function formatShortTimestamp(value: string | null | undefined): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function formatNumber(value: number | null | undefined): string {
  return Math.round(value ?? 0).toLocaleString();
}

export function formatMs(value: number | null | undefined): string {
  return `${Math.round(value ?? 0).toLocaleString()} ms`;
}

export function formatPercent(numerator: number, denominator: number): string {
  if (denominator <= 0) return '0.0%';
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

export function healthColor(status: string): string {
  if (status === 'healthy') return 'bg-emerald-500';
  if (status === 'warning') return 'bg-amber-400';
  if (status === 'degraded') return 'bg-red-500';
  return 'bg-gray-500';
}

export function healthTextColor(status: string): string {
  if (status === 'healthy') return 'text-emerald-300';
  if (status === 'warning') return 'text-amber-300';
  if (status === 'degraded') return 'text-red-300';
  return 'text-gray-400';
}

export function healthBorderColor(status: string): string {
  if (status === 'healthy') return 'border-emerald-700/70';
  if (status === 'warning') return 'border-amber-700/70';
  if (status === 'degraded') return 'border-red-700/70';
  return 'border-gray-700';
}
