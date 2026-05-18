export interface TimeRange {
  from: Date;
  to: Date;
}

const DURATION_PATTERN = /^(\d+)(m|h|d)$/;

export function parseDurationMs(value: string): number {
  const match = DURATION_PATTERN.exec(value.trim());
  if (!match) {
    throw new Error(`Invalid duration '${value}'. Use values like 30m, 2h, or 1d.`);
  }

  const amount = Number(match[1]);
  const unit = match[2];

  if (unit === 'm') return amount * 60 * 1000;
  if (unit === 'h') return amount * 60 * 60 * 1000;
  return amount * 24 * 60 * 60 * 1000;
}

export function parseTimeExpression(value: string, now = new Date()): Date {
  const normalized = value.trim();
  if (normalized === 'now') return now;
  if (normalized.startsWith('now-')) {
    return new Date(now.getTime() - parseDurationMs(normalized.slice(4)));
  }

  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid time expression '${value}'. Use ISO timestamps or now-1h.`);
  }
  return date;
}

export function defaultTimeRange(now = new Date()): TimeRange {
  return {
    from: new Date(now.getTime() - 60 * 60 * 1000),
    to: now,
  };
}

export function toIso(value: Date): string {
  return value.toISOString();
}

export function parseScriptArgs(argv: string[]): Record<string, string | boolean> {
  const parsed: Record<string, string | boolean> = {};

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg?.startsWith('--')) continue;

    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      parsed[key] = true;
      continue;
    }

    parsed[key] = next;
    i += 1;
  }

  return parsed;
}

export function scriptTimeRange(args: Record<string, string | boolean>): TimeRange {
  const now = new Date();
  return {
    from:
      typeof args.from === 'string'
        ? parseTimeExpression(args.from, now)
        : new Date(now.getTime() - 60 * 60 * 1000),
    to: typeof args.to === 'string' ? parseTimeExpression(args.to, now) : now,
  };
}
