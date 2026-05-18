import { describe, expect, it, vi } from 'vitest';
import { SimulatorApiClient, sendTelemetryBatch } from './client.js';
import { parseArgs } from './config.js';
import { TelemetryGenerator } from './generator.js';
import { buildLogPayloads, buildMetricPayloads, buildTracePayloads } from './payloads.js';
import type { HttpFetch, SimulatorConfig } from './types.js';

function config(overrides: Partial<SimulatorConfig> = {}): SimulatorConfig {
  return {
    baseUrl: 'http://localhost:4000',
    apiKey: 'rootpilot_demo_key',
    tenant: 'demo',
    project: 'default',
    environment: 'production',
    scenario: 'normal',
    durationMs: 5 * 60 * 1000,
    rate: 20,
    seed: 42,
    verbose: false,
    dryRun: false,
    once: false,
    ...overrides,
  };
}

describe('TelemetryGenerator', () => {
  it('generates valid OTLP log payloads', () => {
    const batch = new TelemetryGenerator(config()).generateBatch({
      timestamp: new Date('2026-05-18T12:00:00.000Z'),
      requestCount: 1,
    });

    const payload = buildLogPayloads(batch.logs)[0]!;
    expect(payload.resourceLogs.length).toBeGreaterThan(0);
    const record = payload.resourceLogs[0]!.scopeLogs[0]!.logRecords[0]!;
    expect(record.timeUnixNano).toMatch(/^\d+$/);
    expect(record.body.stringValue).toBeTruthy();
    expect(record.traceId).toHaveLength(32);
    expect(record.spanId).toHaveLength(16);
  });

  it('generates valid OTLP span payloads', () => {
    const batch = new TelemetryGenerator(config()).generateBatch({
      timestamp: new Date('2026-05-18T12:00:00.000Z'),
      requestCount: 1,
    });

    const payload = buildTracePayloads(batch.spans)[0]!;
    const spans = payload.resourceSpans.flatMap((resourceSpan) =>
      resourceSpan.scopeSpans.flatMap((scopeSpan) => scopeSpan.spans),
    );
    expect(spans.length).toBeGreaterThan(1);
    expect(spans.some((span) => span.parentSpanId === '')).toBe(true);
    expect(spans.every((span) => span.traceId === spans[0]!.traceId)).toBe(true);
  });

  it('generates valid OTLP metric payloads', () => {
    const batch = new TelemetryGenerator(config()).generateBatch({
      timestamp: new Date('2026-05-18T12:00:00.000Z'),
      requestCount: 1,
    });

    const payload = buildMetricPayloads(batch.metrics)[0]!;
    const metricNames = payload.resourceMetrics.flatMap((resourceMetric) =>
      resourceMetric.scopeMetrics.flatMap((scopeMetric) =>
        scopeMetric.metrics.map((metric) => metric.name),
      ),
    );
    expect(metricNames).toContain('http.server.request.duration');
    expect(metricNames).toContain('http.server.request.count');
    expect(batch.metrics.some((metric) => metric.serviceName === 'notification-service')).toBe(
      true,
    );
  });

  it('generates deployment events', () => {
    const batch = new TelemetryGenerator(config({ scenario: 'bad-deploy' })).generateBatch({
      timestamp: new Date('2026-05-18T12:00:00.000Z'),
      requestCount: 1,
    });

    expect(batch.deploymentEvents).toHaveLength(1);
    expect(batch.deploymentEvents[0]!.deployment_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(batch.deploymentEvents[0]).toMatchObject({
      service_name: 'checkout-service',
      environment: 'production',
      version: 'v1.4.2',
      provider: 'github-actions',
    });
  });

  it('bad-deploy emits deployment before the error spike', () => {
    const batch = new TelemetryGenerator(config({ scenario: 'bad-deploy' })).generateBatch({
      timestamp: new Date('2026-05-18T12:00:00.000Z'),
      requestCount: 2,
    });

    const deploymentTime = new Date(batch.deploymentEvents[0]!.timestamp!).getTime();
    const paymentErrors = batch.logs.filter((log) =>
      log.message.includes('PaymentProviderTimeout'),
    );
    expect(paymentErrors.length).toBeGreaterThan(0);
    expect(paymentErrors.every((log) => new Date(log.timestamp).getTime() >= deploymentTime)).toBe(
      true,
    );
  });

  it('deterministic seed produces stable output', () => {
    const timestamp = new Date('2026-05-18T12:00:00.000Z');
    const first = new TelemetryGenerator(config({ seed: 123 })).generateBatch({
      timestamp,
      requestCount: 2,
    });
    const second = new TelemetryGenerator(config({ seed: 123 })).generateBatch({
      timestamp,
      requestCount: 2,
    });

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('batching splits large payloads', () => {
    const batch = new TelemetryGenerator(config()).generateBatch({
      timestamp: new Date('2026-05-18T12:00:00.000Z'),
      requestCount: 5,
    });

    const payloads = buildLogPayloads(batch.logs, 3);
    expect(payloads.length).toBeGreaterThan(1);
    const totalRecords = payloads.reduce(
      (sum, payload) =>
        sum +
        payload.resourceLogs.reduce(
          (resourceSum, resourceLog) =>
            resourceSum +
            resourceLog.scopeLogs.reduce(
              (scopeSum, scopeLog) => scopeSum + scopeLog.logRecords.length,
              0,
            ),
          0,
        ),
      0,
    );
    expect(totalRecords).toBe(batch.logs.length);
  });
});

describe('SimulatorApiClient', () => {
  it('attaches X-API-Key', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 202 })) as unknown as HttpFetch;
    const client = new SimulatorApiClient('http://localhost:4000', 'rootpilot_demo_key', fetchMock);

    await client.postJson('/v1/events/deployments', { service_name: 'checkout-service' });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:4000/v1/events/deployments',
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-API-Key': 'rootpilot_demo_key',
        }),
      }),
    );
  });

  it('dry-run does not send HTTP requests', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 202 })) as unknown as HttpFetch;
    const client = new SimulatorApiClient('http://localhost:4000', 'rootpilot_demo_key', fetchMock);
    const batch = new TelemetryGenerator(config()).generateBatch({
      timestamp: new Date('2026-05-18T12:00:00.000Z'),
      requestCount: 1,
    });

    await sendTelemetryBatch(config({ dryRun: true }), batch, client);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('parseArgs', () => {
  it('parses CLI defaults and overrides', () => {
    const parsed = parseArgs([
      '--scenario',
      'checkout-error',
      '--duration',
      '10m',
      '--rate',
      '50',
      '--services',
      'checkout-service,payment-service',
      '--seed',
      '7',
      '--verbose',
    ]);

    expect(parsed.scenario).toBe('checkout-error');
    expect(parsed.durationMs).toBe(10 * 60 * 1000);
    expect(parsed.rate).toBe(50);
    expect(parsed.services).toEqual(['checkout-service', 'payment-service']);
    expect(parsed.seed).toBe(7);
    expect(parsed.verbose).toBe(true);
  });
});
