import { buildLogPayloads, buildMetricPayloads, buildTracePayloads } from './payloads.js';
import { sleep } from './time.js';
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
  if (config.dryRun) {
    return { failedHttpRequests: 0 };
  }

  let failedHttpRequests = 0;
  const attempts: Array<Promise<void>> = [];

  for (const deployment of batch.deploymentEvents) {
    attempts.push(client.postJson('/v1/events/deployments', deployment));
  }
  for (const payload of buildLogPayloads(batch.logs)) {
    attempts.push(client.postJson('/v1/ingest/logs', payload));
  }
  for (const payload of buildTracePayloads(batch.spans)) {
    attempts.push(client.postJson('/v1/ingest/traces', payload));
  }
  for (const payload of buildMetricPayloads(batch.metrics)) {
    attempts.push(client.postJson('/v1/ingest/metrics', payload));
  }

  const settled = await Promise.allSettled(attempts);
  for (const result of settled) {
    if (result.status === 'rejected') {
      failedHttpRequests += 1;
      console.error(`[simulator] ${formatHttpError(result.reason, config.baseUrl)}`);
    }
  }

  return { failedHttpRequests };
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
