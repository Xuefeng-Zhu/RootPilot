import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../server.js';

// Mock the postgres module for auth middleware
vi.mock('../../db/postgres.js', () => ({
  query: vi.fn(),
}));

// Mock the clickhouse module
vi.mock('../../db/clickhouse.js', () => ({
  getClickHouseClient: vi.fn(() => ({
    batchInsert: vi.fn().mockResolvedValue(undefined),
  })),
}));

import { query } from '../../db/postgres.js';
import { getClickHouseClient } from '../../db/clickhouse.js';

const mockQuery = vi.mocked(query);
const mockGetClickHouseClient = vi.mocked(getClickHouseClient);

// ============================================================
// Custom Arbitraries for OTLP Payload Generation
// ============================================================

/** Generates a valid service name */
const serviceNameArb = fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz-_.'.split('')), {
  minLength: 1,
  maxLength: 30,
});

/** Generates a valid environment name */
const environmentArb = fc.constantFrom('production', 'staging', 'development', 'test', 'qa');

/** Generates a valid OTLP attribute */
const otlpAttributeArb = fc.record({
  key: fc.string({ minLength: 1, maxLength: 20 }),
  value: fc.record({ stringValue: fc.string({ minLength: 0, maxLength: 50 }) }),
});

/** Generates a valid nanosecond timestamp (2020-2025 range) */
const nanoTimestampArb = fc
  .bigInt({
    min: BigInt('1577836800000000000'), // 2020-01-01
    max: BigInt('1735689600000000000'), // 2025-01-01
  })
  .map((n) => n.toString());

/** Generates a valid severity number (1-24) */
const severityNumberArb = fc.integer({ min: 1, max: 24 });

/** Generates a valid hex string for trace/span IDs */
const hexIdArb = fc.hexaString({ minLength: 8, maxLength: 32 });

/** Generates a valid span kind (0-5) */
const validSpanKindArb = fc.integer({ min: 0, max: 5 });

/** Generates a valid status code (0-2) */
const validStatusCodeArb = fc.integer({ min: 0, max: 2 });

/** Generates a non-empty, non-whitespace string for required fields */
const nonEmptyStringArb = fc.stringOf(
  fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789.-_'.split('')),
  { minLength: 1, maxLength: 20 },
);

/** Generates a valid OTLP log record */
const validLogRecordArb = fc.record({
  timeUnixNano: nanoTimestampArb,
  severityNumber: severityNumberArb,
  body: fc.record({ stringValue: fc.string({ minLength: 1, maxLength: 100 }) }),
  attributes: fc.array(otlpAttributeArb, { minLength: 0, maxLength: 3 }),
});

/** Generates a valid OTLP log payload */
const validLogPayloadArb = fc.tuple(serviceNameArb, environmentArb).chain(([svcName, env]) =>
  fc.array(validLogRecordArb, { minLength: 1, maxLength: 5 }).map((logRecords) => ({
    resourceLogs: [
      {
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: svcName } },
            { key: 'deployment.environment', value: { stringValue: env } },
          ],
        },
        scopeLogs: [{ scope: { name: 'test-scope' }, logRecords }],
      },
    ],
  })),
);

/** Generates a valid OTLP span */
const validSpanArb = fc
  .record({
    traceId: hexIdArb,
    spanId: hexIdArb,
    name: nonEmptyStringArb,
    startTimeUnixNano: nanoTimestampArb,
    kind: validSpanKindArb,
    status: fc.record({ code: validStatusCodeArb }),
    attributes: fc.array(otlpAttributeArb, { minLength: 0, maxLength: 3 }),
  })
  .chain((span) =>
    // Ensure endTimeUnixNano >= startTimeUnixNano
    fc.bigInt({ min: BigInt(0), max: BigInt('5000000000') }).map((offset) => ({
      ...span,
      endTimeUnixNano: (BigInt(span.startTimeUnixNano) + offset).toString(),
    })),
  );

/** Generates a valid OTLP trace payload */
const validTracePayloadArb = fc.tuple(serviceNameArb, environmentArb).chain(([svcName, env]) =>
  fc.array(validSpanArb, { minLength: 1, maxLength: 3 }).map((spans) => ({
    resourceSpans: [
      {
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: svcName } },
            { key: 'deployment.environment', value: { stringValue: env } },
          ],
        },
        scopeSpans: [{ scope: { name: 'test-scope' }, spans }],
      },
    ],
  })),
);

/** Generates a valid metric type */
const metricTypeArb = fc.constantFrom('gauge', 'sum', 'histogram') as fc.Arbitrary<
  'gauge' | 'sum' | 'histogram'
>;

/** Generates a valid OTLP metric payload */
const validMetricPayloadArb = fc
  .tuple(serviceNameArb, environmentArb, metricTypeArb)
  .chain(([svcName, env, metricType]) =>
    fc
      .tuple(
        nonEmptyStringArb,
        fc.double({ min: -1000000, max: 1000000, noNaN: true, noDefaultInfinity: true }),
        nanoTimestampArb,
      )
      .map(([metricName, value, timeNano]) => {
        const dataPoint =
          metricType === 'histogram'
            ? { timeUnixNano: timeNano, sum: value, count: 10 }
            : { timeUnixNano: timeNano, asDouble: value };

        const metricObj: Record<string, unknown> = { name: metricName, unit: 'ms' };
        if (metricType === 'histogram') {
          metricObj.histogram = { dataPoints: [dataPoint] };
        } else if (metricType === 'sum') {
          metricObj.sum = { dataPoints: [dataPoint] };
        } else {
          metricObj.gauge = { dataPoints: [dataPoint] };
        }

        return {
          resourceMetrics: [
            {
              resource: {
                attributes: [
                  { key: 'service.name', value: { stringValue: svcName } },
                  { key: 'deployment.environment', value: { stringValue: env } },
                ],
              },
              scopeMetrics: [{ scope: { name: 'test-scope' }, metrics: [metricObj] }],
            },
          ],
        };
      }),
  );

/** Generates a valid deployment event payload */
const validDeploymentPayloadArb = fc.record({
  service_name: serviceNameArb,
  environment: environmentArb,
  version: nonEmptyStringArb,
  git_sha: fc.option(hexIdArb, { nil: undefined }),
  deployed_by: fc.option(nonEmptyStringArb, { nil: undefined }),
  provider: fc.option(fc.constantFrom('kubernetes', 'ecs', 'lambda', 'docker'), { nil: undefined }),
});

// ============================================================
// Test Setup — Single shared app instance
// ============================================================

let app: FastifyInstance;
let mockBatchInsert: ReturnType<typeof vi.fn>;

function mockValidAuth() {
  mockQuery.mockImplementation(async (sql: string) => {
    if (sql.includes('api_keys')) {
      return {
        rows: [{ id: 'key-1', tenant_id: 'tenant-1', revoked_at: null }],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      } as any;
    }
    if (sql.includes('projects')) {
      return {
        rows: [{ id: 'project-1' }],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      } as any;
    }
    return { rows: [], rowCount: 0, command: 'SELECT', oid: 0, fields: [] } as any;
  });
}

beforeAll(async () => {
  app = await buildApp({ logger: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  vi.clearAllMocks();
  mockBatchInsert = vi.fn().mockResolvedValue(undefined);
  mockGetClickHouseClient.mockReturnValue({
    batchInsert: mockBatchInsert,
    query: vi.fn(),
    healthCheck: vi.fn(),
    close: vi.fn(),
  } as any);
  mockValidAuth();
});

// ============================================================
// Property 4: Payload Validation Rejection
// ============================================================

describe('Property 4: Payload Validation Rejection', () => {
  /**
   * **Validates: Requirements 2.2, 3.2, 3.5, 4.2, 5.2, 21.7**
   *
   * For any ingestion payload that violates structural validation rules
   * (missing required fields, invalid field types, invalid enum values),
   * the corresponding endpoint SHALL return HTTP 400 with an error message
   * of at least 10 characters, and SHALL NOT persist any data.
   */

  describe('POST /v1/ingest/logs — invalid payloads', () => {
    it('rejects payloads with missing or wrong-type resourceLogs field', () => {
      const invalidPayloadArb = fc.oneof(
        fc.record({ someField: fc.string() }),
        fc.string({ minLength: 1, maxLength: 20 }).map((s) => ({ resourceLogs: s })),
        fc.integer().map((n) => ({ resourceLogs: n })),
        fc.boolean().map((b) => ({ resourceLogs: b })),
        fc.constant({ resourceLogs: null }),
      );

      return fc.assert(
        fc.asyncProperty(invalidPayloadArb, async (payload) => {
          const response = await app.inject({
            method: 'POST',
            url: '/v1/ingest/logs',
            headers: { 'content-type': 'application/json', 'x-api-key': 'valid-key' },
            payload,
          });

          expect(response.statusCode).toBe(400);
          const body = response.json();
          expect(body.error.message.length).toBeGreaterThanOrEqual(10);
          expect(mockBatchInsert).not.toHaveBeenCalled();
        }),
        { numRuns: 100 },
      );
    });

    it('rejects payloads with zero logRecords', () => {
      return fc.assert(
        fc.asyncProperty(serviceNameArb, async (svcName) => {
          const payload = {
            resourceLogs: [
              {
                resource: {
                  attributes: [{ key: 'service.name', value: { stringValue: svcName } }],
                },
                scopeLogs: [{ logRecords: [] }],
              },
            ],
          };

          const response = await app.inject({
            method: 'POST',
            url: '/v1/ingest/logs',
            headers: { 'content-type': 'application/json', 'x-api-key': 'valid-key' },
            payload,
          });

          expect(response.statusCode).toBe(400);
          expect(response.json().error.message.length).toBeGreaterThanOrEqual(10);
          expect(mockBatchInsert).not.toHaveBeenCalled();
        }),
        { numRuns: 100 },
      );
    });
  });

  describe('POST /v1/ingest/traces — invalid payloads', () => {
    it('rejects payloads with missing or invalid resourceSpans', () => {
      const invalidPayloadArb = fc.oneof(
        fc.record({ data: fc.string() }),
        fc.string({ minLength: 1, maxLength: 20 }).map((s) => ({ resourceSpans: s })),
        fc.integer().map((n) => ({ resourceSpans: n })),
        fc.constant({ resourceSpans: [] }),
      );

      return fc.assert(
        fc.asyncProperty(invalidPayloadArb, async (payload) => {
          const response = await app.inject({
            method: 'POST',
            url: '/v1/ingest/traces',
            headers: { 'content-type': 'application/json', 'x-api-key': 'valid-key' },
            payload,
          });

          expect(response.statusCode).toBe(400);
          const body = response.json();
          expect(body.error.message.length).toBeGreaterThanOrEqual(10);
          expect(mockBatchInsert).not.toHaveBeenCalled();
        }),
        { numRuns: 100 },
      );
    });

    it('rejects payloads with invalid span kind values', () => {
      const invalidKindArb = fc.oneof(
        fc.integer({ min: 6, max: 100 }),
        fc.integer({ min: -100, max: -1 }),
      );

      return fc.assert(
        fc.asyncProperty(invalidKindArb, hexIdArb, hexIdArb, async (kind, traceId, spanId) => {
          const payload = {
            resourceSpans: [
              {
                resource: { attributes: [] },
                scopeSpans: [
                  {
                    spans: [
                      {
                        traceId,
                        spanId,
                        name: 'test-op',
                        startTimeUnixNano: '1700000000000000000',
                        endTimeUnixNano: '1700000000100000000',
                        kind,
                        status: { code: 0 },
                      },
                    ],
                  },
                ],
              },
            ],
          };

          const response = await app.inject({
            method: 'POST',
            url: '/v1/ingest/traces',
            headers: { 'content-type': 'application/json', 'x-api-key': 'valid-key' },
            payload,
          });

          expect(response.statusCode).toBe(400);
          expect(response.json().error.message.length).toBeGreaterThanOrEqual(10);
          expect(mockBatchInsert).not.toHaveBeenCalled();
        }),
        { numRuns: 100 },
      );
    });

    it('rejects payloads with invalid status code values', () => {
      const invalidStatusArb = fc.oneof(
        fc.integer({ min: 3, max: 100 }),
        fc.integer({ min: -100, max: -1 }),
      );

      return fc.assert(
        fc.asyncProperty(
          invalidStatusArb,
          hexIdArb,
          hexIdArb,
          async (statusCode, traceId, spanId) => {
            const payload = {
              resourceSpans: [
                {
                  resource: { attributes: [] },
                  scopeSpans: [
                    {
                      spans: [
                        {
                          traceId,
                          spanId,
                          name: 'test-op',
                          startTimeUnixNano: '1700000000000000000',
                          endTimeUnixNano: '1700000000100000000',
                          kind: 2,
                          status: { code: statusCode },
                        },
                      ],
                    },
                  ],
                },
              ],
            };

            const response = await app.inject({
              method: 'POST',
              url: '/v1/ingest/traces',
              headers: { 'content-type': 'application/json', 'x-api-key': 'valid-key' },
              payload,
            });

            expect(response.statusCode).toBe(400);
            expect(response.json().error.message.length).toBeGreaterThanOrEqual(10);
            expect(mockBatchInsert).not.toHaveBeenCalled();
          },
        ),
        { numRuns: 100 },
      );
    });

    it('rejects payloads with missing required span fields', () => {
      const missingFieldArb = fc.constantFrom(
        'traceId',
        'spanId',
        'name',
        'startTimeUnixNano',
        'endTimeUnixNano',
      );

      return fc.assert(
        fc.asyncProperty(missingFieldArb, async (missingField) => {
          const span: Record<string, unknown> = {
            traceId: 'abc123',
            spanId: 'def456',
            name: 'test-op',
            startTimeUnixNano: '1700000000000000000',
            endTimeUnixNano: '1700000000100000000',
            kind: 2,
          };
          delete span[missingField];

          const payload = {
            resourceSpans: [
              {
                resource: { attributes: [] },
                scopeSpans: [{ spans: [span] }],
              },
            ],
          };

          const response = await app.inject({
            method: 'POST',
            url: '/v1/ingest/traces',
            headers: { 'content-type': 'application/json', 'x-api-key': 'valid-key' },
            payload,
          });

          expect(response.statusCode).toBe(400);
          expect(response.json().error.message.length).toBeGreaterThanOrEqual(10);
          expect(mockBatchInsert).not.toHaveBeenCalled();
        }),
        { numRuns: 100 },
      );
    });
  });

  describe('POST /v1/ingest/metrics — invalid payloads', () => {
    it('rejects payloads with missing or invalid resourceMetrics', () => {
      const invalidPayloadArb = fc.oneof(
        fc.record({ data: fc.string() }),
        fc.string({ minLength: 1, maxLength: 20 }).map((s) => ({ resourceMetrics: s })),
        fc.integer().map((n) => ({ resourceMetrics: n })),
        fc.constant({ resourceMetrics: [] }),
      );

      return fc.assert(
        fc.asyncProperty(invalidPayloadArb, async (payload) => {
          const response = await app.inject({
            method: 'POST',
            url: '/v1/ingest/metrics',
            headers: { 'content-type': 'application/json', 'x-api-key': 'valid-key' },
            payload,
          });

          expect(response.statusCode).toBe(400);
          const body = response.json();
          expect(body.error.message.length).toBeGreaterThanOrEqual(10);
          expect(mockBatchInsert).not.toHaveBeenCalled();
        }),
        { numRuns: 100 },
      );
    });

    it('rejects metric payloads with non-numeric values', () => {
      // Generate strings that cannot be coerced to a finite number
      const nonNumericArb = fc
        .oneof(
          fc.constant('abc'),
          fc.constant('not-a-number'),
          fc.constant('hello'),
          fc.constant('NaN'),
          fc.constant('Infinity'),
          fc.constant('-Infinity'),
          fc.constant('true'),
          fc.constant('false'),
          fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz!@#$%'.split('')), {
            minLength: 1,
            maxLength: 10,
          }),
        )
        .filter((s) => !isFinite(Number(s)));

      return fc.assert(
        fc.asyncProperty(nonNumericArb, nonEmptyStringArb, async (badValue, metricName) => {
          const payload = {
            resourceMetrics: [
              {
                resource: { attributes: [] },
                scopeMetrics: [
                  {
                    metrics: [
                      {
                        name: metricName,
                        gauge: {
                          dataPoints: [{ asDouble: badValue }],
                        },
                      },
                    ],
                  },
                ],
              },
            ],
          };

          const response = await app.inject({
            method: 'POST',
            url: '/v1/ingest/metrics',
            headers: { 'content-type': 'application/json', 'x-api-key': 'valid-key' },
            payload,
          });

          expect(response.statusCode).toBe(400);
          expect(response.json().error.message.length).toBeGreaterThanOrEqual(10);
          expect(mockBatchInsert).not.toHaveBeenCalled();
        }),
        { numRuns: 100 },
      );
    });

    it('rejects metric payloads with missing metric name', () => {
      return fc.assert(
        fc.asyncProperty(
          fc.double({ min: 0, max: 100, noNaN: true, noDefaultInfinity: true }),
          async (value) => {
            const payload = {
              resourceMetrics: [
                {
                  resource: { attributes: [] },
                  scopeMetrics: [
                    {
                      metrics: [
                        {
                          gauge: { dataPoints: [{ asDouble: value }] },
                        },
                      ],
                    },
                  ],
                },
              ],
            };

            const response = await app.inject({
              method: 'POST',
              url: '/v1/ingest/metrics',
              headers: { 'content-type': 'application/json', 'x-api-key': 'valid-key' },
              payload,
            });

            expect(response.statusCode).toBe(400);
            expect(response.json().error.message.length).toBeGreaterThanOrEqual(10);
            expect(mockBatchInsert).not.toHaveBeenCalled();
          },
        ),
        { numRuns: 100 },
      );
    });

    it('rejects metric payloads with no data container (gauge/sum/histogram)', () => {
      return fc.assert(
        fc.asyncProperty(nonEmptyStringArb, async (metricName) => {
          const payload = {
            resourceMetrics: [
              {
                resource: { attributes: [] },
                scopeMetrics: [
                  {
                    metrics: [{ name: metricName }],
                  },
                ],
              },
            ],
          };

          const response = await app.inject({
            method: 'POST',
            url: '/v1/ingest/metrics',
            headers: { 'content-type': 'application/json', 'x-api-key': 'valid-key' },
            payload,
          });

          expect(response.statusCode).toBe(400);
          expect(response.json().error.message.length).toBeGreaterThanOrEqual(10);
          expect(mockBatchInsert).not.toHaveBeenCalled();
        }),
        { numRuns: 100 },
      );
    });
  });

  describe('POST /v1/events/deployments — invalid payloads', () => {
    it('rejects payloads with missing required fields', () => {
      const missingFieldArb = fc.constantFrom('service_name', 'environment', 'version');

      return fc.assert(
        fc.asyncProperty(
          missingFieldArb,
          serviceNameArb,
          environmentArb,
          async (missingField, svc, env) => {
            const payload: Record<string, string> = {
              service_name: svc,
              environment: env,
              version: '1.0.0',
            };
            delete payload[missingField];

            const response = await app.inject({
              method: 'POST',
              url: '/v1/events/deployments',
              headers: { 'content-type': 'application/json', 'x-api-key': 'valid-key' },
              payload,
            });

            expect(response.statusCode).toBe(400);
            expect(response.json().error.message.length).toBeGreaterThanOrEqual(10);
            expect(mockBatchInsert).not.toHaveBeenCalled();
          },
        ),
        { numRuns: 100 },
      );
    });

    it('rejects payloads with wrong types for required fields', () => {
      const wrongTypeArb = fc.oneof(
        fc.integer().map((n) => n as unknown),
        fc.boolean().map((b) => b as unknown),
        fc.constant(null as unknown),
        fc.constant([] as unknown),
      );

      return fc.assert(
        fc.asyncProperty(wrongTypeArb, async (wrongValue) => {
          const payload = {
            service_name: wrongValue,
            environment: 'production',
            version: '1.0.0',
          };

          const response = await app.inject({
            method: 'POST',
            url: '/v1/events/deployments',
            headers: { 'content-type': 'application/json', 'x-api-key': 'valid-key' },
            payload,
          });

          expect(response.statusCode).toBe(400);
          expect(response.json().error.message.length).toBeGreaterThanOrEqual(10);
          expect(mockBatchInsert).not.toHaveBeenCalled();
        }),
        { numRuns: 100 },
      );
    });
  });
});

// ============================================================
// Property 1: Ingestion Round-Trip Preservation
// ============================================================

describe('Property 1: Ingestion Round-Trip Preservation', () => {
  /**
   * **Validates: Requirements 2.1, 2.2, 3.1, 3.2, 3.5, 4.1, 4.2, 5.1, 5.2**
   *
   * For any valid telemetry payload, ingesting via the corresponding endpoint
   * SHALL produce a record whose canonical fields match the original input
   * values after normalization. Verifies tenant_id, project_id, timestamps,
   * severity mapping, and field preservation.
   */

  describe('POST /v1/ingest/logs — round-trip preservation', () => {
    it('preserves canonical fields after normalization for valid log payloads', () => {
      return fc.assert(
        fc.asyncProperty(validLogPayloadArb, async (payload) => {
          mockBatchInsert.mockClear();

          const response = await app.inject({
            method: 'POST',
            url: '/v1/ingest/logs',
            headers: { 'content-type': 'application/json', 'x-api-key': 'valid-key' },
            payload,
          });

          expect(response.statusCode).toBe(202);
          expect(mockBatchInsert).toHaveBeenCalledTimes(1);

          const [table, rows] = mockBatchInsert.mock.calls[0];
          expect(table).toBe('logs');
          expect(rows.length).toBeGreaterThan(0);

          for (const row of rows) {
            // Verify tenant/project context is correctly attached
            expect(row.tenant_id).toBe('tenant-1');
            expect(row.project_id).toBe('project-1');

            // Verify id is a valid UUID v4
            expect(row.id).toMatch(
              /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
            );

            // Verify timestamp is valid ISO 8601
            expect(new Date(row.timestamp).getTime()).not.toBeNaN();

            // Verify received_at is valid ISO 8601
            expect(new Date(row.received_at).getTime()).not.toBeNaN();

            // Verify severity is a valid value
            expect(['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL']).toContain(row.severity);

            // Verify resource_attributes is a JSON string
            expect(typeof row.resource_attributes).toBe('string');
            const resAttrs = JSON.parse(row.resource_attributes);
            expect(resAttrs).toHaveProperty('service.name');

            // Verify service_name matches resource attribute
            expect(row.service_name).toBe(resAttrs['service.name']);
          }
        }),
        { numRuns: 100 },
      );
    });

    it('correctly maps severity numbers to severity strings', () => {
      const severityMappings: Array<[number, string]> = [
        [1, 'TRACE'],
        [4, 'TRACE'],
        [5, 'DEBUG'],
        [8, 'DEBUG'],
        [9, 'INFO'],
        [12, 'INFO'],
        [13, 'WARN'],
        [16, 'WARN'],
        [17, 'ERROR'],
        [20, 'ERROR'],
        [21, 'FATAL'],
        [24, 'FATAL'],
      ];

      const severityPairArb = fc.constantFrom(...severityMappings);

      return fc.assert(
        fc.asyncProperty(
          severityPairArb,
          serviceNameArb,
          async ([severityNum, expectedSeverity], svcName) => {
            mockBatchInsert.mockClear();

            const payload = {
              resourceLogs: [
                {
                  resource: {
                    attributes: [{ key: 'service.name', value: { stringValue: svcName } }],
                  },
                  scopeLogs: [
                    {
                      logRecords: [
                        {
                          timeUnixNano: '1700000000000000000',
                          severityNumber: severityNum,
                          body: { stringValue: 'test message' },
                        },
                      ],
                    },
                  ],
                },
              ],
            };

            const response = await app.inject({
              method: 'POST',
              url: '/v1/ingest/logs',
              headers: { 'content-type': 'application/json', 'x-api-key': 'valid-key' },
              payload,
            });

            expect(response.statusCode).toBe(202);
            const [, rows] = mockBatchInsert.mock.calls[0];
            expect(rows[0].severity).toBe(expectedSeverity);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('converts nanosecond timestamps to ISO 8601', () => {
      return fc.assert(
        fc.asyncProperty(nanoTimestampArb, serviceNameArb, async (timeNano, svcName) => {
          mockBatchInsert.mockClear();

          const payload = {
            resourceLogs: [
              {
                resource: {
                  attributes: [{ key: 'service.name', value: { stringValue: svcName } }],
                },
                scopeLogs: [
                  {
                    logRecords: [
                      {
                        timeUnixNano: timeNano,
                        severityNumber: 9,
                        body: { stringValue: 'test' },
                      },
                    ],
                  },
                ],
              },
            ],
          };

          const response = await app.inject({
            method: 'POST',
            url: '/v1/ingest/logs',
            headers: { 'content-type': 'application/json', 'x-api-key': 'valid-key' },
            payload,
          });

          expect(response.statusCode).toBe(202);
          const [, rows] = mockBatchInsert.mock.calls[0];

          // Verify the timestamp was converted from nanos to ISO 8601
          const expectedMillis = Number(BigInt(timeNano) / BigInt(1_000_000));
          const expectedISO = new Date(expectedMillis).toISOString();
          expect(rows[0].timestamp).toBe(expectedISO);
        }),
        { numRuns: 100 },
      );
    });
  });

  describe('POST /v1/ingest/traces — round-trip preservation', () => {
    it('preserves canonical fields after normalization for valid trace payloads', () => {
      return fc.assert(
        fc.asyncProperty(validTracePayloadArb, async (payload) => {
          mockBatchInsert.mockClear();

          const response = await app.inject({
            method: 'POST',
            url: '/v1/ingest/traces',
            headers: { 'content-type': 'application/json', 'x-api-key': 'valid-key' },
            payload,
          });

          expect(response.statusCode).toBe(202);
          expect(mockBatchInsert).toHaveBeenCalledTimes(1);

          const [table, rows] = mockBatchInsert.mock.calls[0];
          expect(table).toBe('spans');
          expect(rows.length).toBeGreaterThan(0);

          const inputSpans = payload.resourceSpans[0].scopeSpans[0].spans;

          for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const inputSpan = inputSpans[i];

            // Verify tenant/project context
            expect(row.tenant_id).toBe('tenant-1');
            expect(row.project_id).toBe('project-1');

            // Verify trace_id and span_id are preserved
            expect(row.trace_id).toBe(inputSpan.traceId);
            expect(row.span_id).toBe(inputSpan.spanId);

            // Verify operation_name matches span name
            expect(row.operation_name).toBe(inputSpan.name);

            // Verify duration_ms computation
            const expectedDuration =
              Number(BigInt(inputSpan.endTimeUnixNano) - BigInt(inputSpan.startTimeUnixNano)) /
              1_000_000;
            expect(row.duration_ms).toBeCloseTo(expectedDuration, 10);

            // Verify kind mapping
            const kindMap: Record<number, string> = {
              0: 'INTERNAL',
              1: 'INTERNAL',
              2: 'SERVER',
              3: 'CLIENT',
              4: 'PRODUCER',
              5: 'CONSUMER',
            };
            expect(row.kind).toBe(kindMap[inputSpan.kind]);

            // Verify status_code mapping
            const statusMap: Record<number, string> = { 0: 'UNSET', 1: 'OK', 2: 'ERROR' };
            expect(row.status_code).toBe(statusMap[inputSpan.status.code]);

            // Verify id is a valid UUID
            expect(row.id).toMatch(
              /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
            );
          }
        }),
        { numRuns: 100 },
      );
    });
  });

  describe('POST /v1/ingest/metrics — round-trip preservation', () => {
    it('preserves canonical fields after normalization for valid metric payloads', () => {
      return fc.assert(
        fc.asyncProperty(validMetricPayloadArb, async (payload) => {
          mockBatchInsert.mockClear();

          const response = await app.inject({
            method: 'POST',
            url: '/v1/ingest/metrics',
            headers: { 'content-type': 'application/json', 'x-api-key': 'valid-key' },
            payload,
          });

          expect(response.statusCode).toBe(202);
          expect(mockBatchInsert).toHaveBeenCalledTimes(1);

          const [table, rows] = mockBatchInsert.mock.calls[0];
          expect(table).toBe('metrics');
          expect(rows.length).toBeGreaterThan(0);

          const inputMetric = (payload.resourceMetrics[0] as any).scopeMetrics[0].metrics[0];
          const row = rows[0];

          // Verify tenant/project context
          expect(row.tenant_id).toBe('tenant-1');
          expect(row.project_id).toBe('project-1');

          // Verify metric_name is preserved
          expect(row.metric_name).toBe(inputMetric.name);

          // Verify metric_type matches the data container
          const expectedType = inputMetric.gauge ? 'gauge' : inputMetric.sum ? 'sum' : 'histogram';
          expect(row.metric_type).toBe(expectedType);

          // Verify value is a finite number
          expect(typeof row.value).toBe('number');
          expect(isFinite(row.value)).toBe(true);

          // Verify id is a valid UUID
          expect(row.id).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
          );

          // Verify timestamp is valid ISO 8601
          expect(new Date(row.timestamp).getTime()).not.toBeNaN();
        }),
        { numRuns: 100 },
      );
    });
  });

  describe('POST /v1/events/deployments — round-trip preservation', () => {
    it('preserves canonical fields after normalization for valid deployment payloads', () => {
      return fc.assert(
        fc.asyncProperty(validDeploymentPayloadArb, async (payload) => {
          mockBatchInsert.mockClear();

          const response = await app.inject({
            method: 'POST',
            url: '/v1/events/deployments',
            headers: { 'content-type': 'application/json', 'x-api-key': 'valid-key' },
            payload,
          });

          expect(response.statusCode).toBe(202);
          expect(mockBatchInsert).toHaveBeenCalledTimes(1);

          const [table, rows] = mockBatchInsert.mock.calls[0];
          expect(table).toBe('deployment_events');
          expect(rows).toHaveLength(1);

          const row = rows[0];

          // Verify tenant/project context
          expect(row.tenant_id).toBe('tenant-1');
          expect(row.project_id).toBe('project-1');

          // Verify required fields are preserved
          expect(row.service_name).toBe(payload.service_name);
          expect(row.environment).toBe(payload.environment);
          expect(row.version).toBe(payload.version);

          // Verify deployment_id is a valid UUID
          expect(row.deployment_id).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
          );

          // Verify timestamp is valid ISO 8601
          expect(new Date(row.timestamp).getTime()).not.toBeNaN();

          // Verify optional fields
          if (payload.git_sha) {
            expect(row.git_sha).toBe(payload.git_sha);
          }
          if (payload.deployed_by) {
            expect(row.deployed_by).toBe(payload.deployed_by);
          }
          if (payload.provider) {
            expect(row.provider).toBe(payload.provider);
          }
        }),
        { numRuns: 100 },
      );
    });
  });
});
