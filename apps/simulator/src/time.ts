const DURATION_PATTERN = /^(\d+)(ms|s|m|h)$/;

export function parseDuration(value: string): number {
  const match = DURATION_PATTERN.exec(value.trim());
  if (!match) {
    throw new Error(`Invalid duration "${value}". Use values like 500ms, 30s, 5m, or 1h.`);
  }

  const amount = Number(match[1]);
  const unit = match[2];

  switch (unit) {
    case 'ms':
      return amount;
    case 's':
      return amount * 1000;
    case 'm':
      return amount * 60 * 1000;
    case 'h':
      return amount * 60 * 60 * 1000;
    default:
      throw new Error(`Unsupported duration unit "${unit}"`);
  }
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${Math.round(ms / 3_600_000)}h`;
}

export function toUnixNano(date: Date): string {
  return (BigInt(date.getTime()) * 1_000_000n).toString();
}

export function offsetDate(date: Date, offsetMs: number): Date {
  return new Date(date.getTime() + offsetMs);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
