import { buildLogPayloads, buildMetricPayloads, buildTracePayloads } from './payloads.js';
import { sleep } from './time.js';
import type { LogsPayload, MetricsPayload, TracesPayload } from './payloads.js';
import type { HttpFetch, SendResult, SimulatorConfig, TelemetryBatch } from './types.js';

export class SimulatorApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly fetchFn: HttpFetch = fetch,
  ) {}

  async postJson(endpoint: string, body: unknown): Promise<void> {
    const url = `${this.baseUrl}${endpoint}`;
    const response = await this.withRetries(() => this.fetchWithTimeout(url, body));

    if (!response.ok) {
      const responseText = await response.text().catch(() => '');
      throw new Error(
        `POST ${endpoint} failed (${response.status}): ${responseText || response.statusText}`,
      );
    }
  }

  private async withRetries(request: () => Promise<Response>): Promise<Response> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await request();
        if (response.status < 500 && response.status !== 408 && response.status !== 429) {
          return response;
        }
        if (attempt === 2) return response;
        lastError = new Error(`HTTP ${response.status}`);
      } catch (error) {
        lastError = error;
      }
      await sleep(200 * 2 ** attempt);
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private async fetchWithTimeout(url: string, body: unknown): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      return await this.fetchFn(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.apiKey,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}

export async function sendTelemetryBatch(
  config: SimulatorConfig,
  batch: TelemetryBatch,
  client = new SimulatorApiClient(config.baseUrl, config.apiKey),
): Promise<SendResult> {
  const result: SendResult = {
    logsSent: 0,
    spansSent: 0,
    metricsSent: 0,
    deploymentEventsSent: 0,
    failedHttpRequests: 0,
  };

  if (config.dryRun) {
    return result;
  }

  const attempts: SendAttempt[] = [];

  for (const deployment of batch.deploymentEvents) {
    attempts.push({
      kind: 'deployments',
      count: 1,
      promise: client.postJson('/v1/events/deployments', deployment),
    });
  }
  for (const payload of buildLogPayloads(batch.logs)) {
    attempts.push({
      kind: 'logs',
      count: countLogs(payload),
      promise: client.postJson('/v1/ingest/logs', payload),
    });
  }
  for (const payload of buildTracePayloads(batch.spans)) {
    attempts.push({
      kind: 'spans',
      count: countSpans(payload),
      promise: client.postJson('/v1/ingest/traces', payload),
    });
  }
  for (const payload of buildMetricPayloads(batch.metrics)) {
    attempts.push({
      kind: 'metrics',
      count: countMetricDataPoints(payload),
      promise: client.postJson('/v1/ingest/metrics', payload),
    });
  }

  const settled = await Promise.allSettled(attempts.map((attempt) => attempt.promise));
  settled.forEach((settledAttempt, index) => {
    const attempt = attempts[index];
    if (!attempt) return;

    if (settledAttempt.status === 'rejected') {
      result.failedHttpRequests += 1;
      console.error(`[simulator] ${formatHttpError(settledAttempt.reason, config.baseUrl)}`);
      return;
    }

    if (attempt.kind === 'logs') result.logsSent += attempt.count;
    if (attempt.kind === 'spans') result.spansSent += attempt.count;
    if (attempt.kind === 'metrics') result.metricsSent += attempt.count;
    if (attempt.kind === 'deployments') result.deploymentEventsSent += attempt.count;
  });

  return result;
}

type SendAttemptKind = 'logs' | 'spans' | 'metrics' | 'deployments';

interface SendAttempt {
  kind: SendAttemptKind;
  count: number;
  promise: Promise<void>;
}

function countLogs(payload: LogsPayload): number {
  return payload.resourceLogs.reduce(
    (resourceSum, resourceLog) =>
      resourceSum +
      resourceLog.scopeLogs.reduce(
        (scopeSum, scopeLog) => scopeSum + scopeLog.logRecords.length,
        0,
      ),
    0,
  );
}

function countSpans(payload: TracesPayload): number {
  return payload.resourceSpans.reduce(
    (resourceSum, resourceSpan) =>
      resourceSum +
      resourceSpan.scopeSpans.reduce((scopeSum, scopeSpan) => scopeSum + scopeSpan.spans.length, 0),
    0,
  );
}

function countMetricDataPoints(payload: MetricsPayload): number {
  return payload.resourceMetrics.reduce(
    (resourceSum, resourceMetric) =>
      resourceSum +
      resourceMetric.scopeMetrics.reduce(
        (scopeSum, scopeMetric) =>
          scopeSum +
          scopeMetric.metrics.reduce((metricSum, metric) => {
            return (
              metricSum +
              (metric.gauge?.dataPoints.length ?? 0) +
              (metric.sum?.dataPoints.length ?? 0)
            );
          }, 0),
        0,
      ),
    0,
  );
}

function formatHttpError(reason: unknown, baseUrl: string): string {
  const message = reason instanceof Error ? reason.message : String(reason);
  if (
    message.includes('fetch failed') ||
    message.includes('ECONNREFUSED') ||
    message.includes('aborted')
  ) {
    return `RootPilot API is not reachable at ${baseUrl}. Run docker compose -f infra/docker-compose.yml up -d postgres clickhouse and npm run dev --workspace=apps/api.`;
  }
  if (message.includes('401')) {
    return 'API key was rejected. Run npm run seed to create rootpilot_demo_key, or pass --api-key with a valid key.';
  }
  if (message.includes('400')) {
    return `RootPilot rejected a simulator payload: ${message}`;
  }
  return message;
}
