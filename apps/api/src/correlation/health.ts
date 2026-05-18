import type { HealthStatus } from '@rootpilot/shared';

export interface HealthInput {
  requestCount: number;
  errorCount: number;
  p95LatencyMs: number;
  warningCount?: number;
  lastSeenAt?: Date | string | null;
  now?: Date;
}

const RECENT_TELEMETRY_MS = 60 * 60 * 1000;

export function calculateHealthStatus(input: HealthInput): HealthStatus {
  if (!input.lastSeenAt) return 'unknown';

  const now = input.now ?? new Date();
  const lastSeen = input.lastSeenAt instanceof Date ? input.lastSeenAt : new Date(input.lastSeenAt);

  if (
    Number.isNaN(lastSeen.getTime()) ||
    now.getTime() - lastSeen.getTime() > RECENT_TELEMETRY_MS
  ) {
    return 'unknown';
  }

  const errorRate = input.requestCount > 0 ? input.errorCount / Math.max(1, input.requestCount) : 0;

  if (errorRate >= 0.1 || input.p95LatencyMs >= 900) {
    return 'degraded';
  }

  if (
    errorRate >= 0.02 ||
    input.errorCount > 0 ||
    (input.warningCount ?? 0) > 0 ||
    input.p95LatencyMs >= 500
  ) {
    return 'warning';
  }

  return 'healthy';
}

export function riskLevelFromImpact(input: {
  errorCountBefore: number;
  errorCountAfter: number;
  p95LatencyBeforeMs: number;
  p95LatencyAfterMs: number;
  newErrorGroupsCount: number;
}): 'low' | 'medium' | 'high' {
  const errorIncrease = input.errorCountAfter - input.errorCountBefore;
  const latencyIncrease = input.p95LatencyAfterMs - input.p95LatencyBeforeMs;
  const errorMultiplier =
    input.errorCountBefore > 0
      ? input.errorCountAfter / input.errorCountBefore
      : input.errorCountAfter > 0
        ? input.errorCountAfter
        : 0;
  const latencyMultiplier =
    input.p95LatencyBeforeMs > 0
      ? input.p95LatencyAfterMs / input.p95LatencyBeforeMs
      : input.p95LatencyAfterMs > 0
        ? input.p95LatencyAfterMs
        : 0;

  if (
    input.newErrorGroupsCount >= 2 ||
    (errorIncrease >= 20 && errorMultiplier >= 2) ||
    (latencyIncrease >= 400 && latencyMultiplier >= 2)
  ) {
    return 'high';
  }

  if (
    input.newErrorGroupsCount > 0 ||
    errorIncrease >= 5 ||
    latencyIncrease >= 200 ||
    latencyMultiplier >= 1.5
  ) {
    return 'medium';
  }

  return 'low';
}
