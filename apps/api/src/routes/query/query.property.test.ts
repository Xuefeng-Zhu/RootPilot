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
    query: vi.fn().mockResolvedValue([]),
    healthCheck: vi.fn().mockResolvedValue(true),
    close: vi.fn().mockResolvedValue(undefined),
  })),
}));

import { query } from '../../db/postgres.js';
import { getClickHouseClient } from '../../db/clickhouse.js';

const mockQuery = vi.mocked(query);
const mockGetClickHouseClient = vi.mocked(getClickHouseClient);

// ============================================================
// Helpers
// ============================================================

function mockAuthForTenant(tenantId: string) {
  mockQuery.mockImplementation(async (sql: string) => {
    if (sql.includes('api_keys')) {
      return {
        rows: [{ id: 'key-1', tenant_id: tenantId, revoked_at: null }],
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

// ============================================================
// Custom Arbitraries
// ============================================================

/** Generates a valid tenant ID */
const tenantIdArb = fc.stringOf(
  fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-'.split('')),
  { minLength: 5, maxLength: 20 },
);

/** Generates a valid service name */
const serviceNameArb = fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz-_.'.split('')), {
  minLength: 1,
  maxLength: 30,
});

/** Generates a valid environment name */
const environmentArb = fc.constantFrom('production', 'staging', 'development', 'test', 'qa');

/** Generates a valid severity */
const validSeverityArb = fc.constantFrom('TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL');

/** Generates an invalid severity */
const invalidSeverityArb = fc
  .stringOf(fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')), {
    minLength: 1,
    maxLength: 10,
  })
  .filter((s) => !['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'].includes(s));

/** Generates a valid ISO 8601 timestamp */
const validTimestampArb = fc
  .date({
    min: new Date('2020-01-01T00:00:00Z'),
    max: new Date('2025-12-31T23:59:59Z'),
  })
  .map((d) => d.toISOString());

/** Generates an invalid timestamp string */
const invalidTimestampArb = fc
  .oneof(
    fc.constant('not-a-date'),
    fc.constant('2024-13-45T99:99:99Z'),
    fc.constant('yesterday'),
    fc.constant('abc123'),
    fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz!@#$%'.split('')), {
      minLength: 3,
      maxLength: 15,
    }),
  )
  .filter((s) => isNaN(new Date(s).getTime()));

/** Generates a valid trace ID */
const traceIdArb = fc.hexaString({ minLength: 16, maxLength: 32 });

/** Generates a valid interval */
const validIntervalArb = fc.constantFrom('1m', '5m', '15m', '1h', '1d');

/** Generates an invalid interval */
const invalidIntervalArb = fc
  .oneof(
    fc.constant('2m'),
    fc.constant('3m'),
    fc.constant('10m'),
    fc.constant('30m'),
    fc.constant('2h'),
    fc.constant('6h'),
    fc.constant('12h'),
    fc.constant('7d'),
    fc.constant('1w'),
    fc.stringOf(fc.constantFrom(...'0123456789abcdefghijklmnopqrstuvwxyz'.split('')), {
      minLength: 2,
      maxLength: 5,
    }),
  )
  .filter((s) => !['1m', '5m', '15m', '1h', '1d'].includes(s));

/** Generates a valid aggregation */
const validAggregationArb = fc.constantFrom(
  'avg',
  'sum',
  'min',
  'max',
  'count',
  'p50',
  'p95',
  'p99',
);

/** Generates an invalid aggregation */
const invalidAggregationArb = fc
  .oneof(
    fc.constant('median'),
    fc.constant('mode'),
    fc.constant('stddev'),
    fc.constant('percentile'),
    fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')), {
      minLength: 2,
      maxLength: 10,
    }),
  )
  .filter((s) => !['avg', 'sum', 'min', 'max', 'count', 'p50', 'p95', 'p99'].includes(s));

function expectedMetricAggregationSql(aggregation: string): string {
  if (aggregation === 'p50') return 'quantile(0.50)(value)';
  if (aggregation === 'p95') return 'quantile(0.95)(value)';
  if (aggregation === 'p99') return 'quantile(0.99)(value)';
  return `${aggregation}(value)`;
}

/** Generates a metric name */
const metricNameArb = fc.stringOf(
  fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789._'.split('')),
  { minLength: 1, maxLength: 30 },
);

// ============================================================
// Test Setup
// ============================================================

let app: FastifyInstance;
let mockChQuery: ReturnType<typeof vi.fn>;

beforeAll(async () => {
  app = await buildApp({ logger: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  vi.clearAllMocks();
  mockChQuery = vi.fn().mockResolvedValue([]);
  mockGetClickHouseClient.mockReturnValue({
    batchInsert: vi.fn().mockResolvedValue(undefined),
    query: mockChQuery,
    healthCheck: vi.fn().mockResolvedValue(true),
    close: vi.fn().mockResolvedValue(undefined),
  } as any);
  mockAuthForTenant('tenant-1');
});

// ============================================================
// Property 10: Query Parameter Validation
// ============================================================

describe('Property 10: Query Parameter Validation', () => {
  /**
   * **Validates: Requirements 7.7, 8.7, 9.6**
   *
   * For any query request containing invalid parameter values (malformed
   * ISO-8601 timestamps, negative durations, limit exceeding maximum,
   * unsupported interval or aggregation values, unrecognized severity),
   * the query endpoint SHALL return HTTP 400 with a descriptive error
   * message and SHALL NOT execute any database query.
   */

  describe('GET /v1/logs — invalid parameters', () => {
    it('rejects invalid from timestamps', () => {
      return fc.assert(
        fc.asyncProperty(invalidTimestampArb, async (badTimestamp) => {
          const response = await app.inject({
            method: 'GET',
            url: `/v1/logs?from=${encodeURIComponent(badTimestamp)}`,
            headers: { 'x-api-key': 'valid-key' },
          });

          expect(response.statusCode).toBe(400);
          const body = response.json();
          expect(body.error.code).toBe('INVALID_PARAMETER');
          expect(body.error.message.length).toBeGreaterThanOrEqual(10);
          expect(mockChQuery).not.toHaveBeenCalled();
        }),
        { numRuns: 100 },
      );
    });

    it('rejects invalid to timestamps', () => {
      return fc.assert(
        fc.asyncProperty(invalidTimestampArb, async (badTimestamp) => {
          const response = await app.inject({
            method: 'GET',
            url: `/v1/logs?to=${encodeURIComponent(badTimestamp)}`,
            headers: { 'x-api-key': 'valid-key' },
          });

          expect(response.statusCode).toBe(400);
          const body = response.json();
          expect(body.error.code).toBe('INVALID_PARAMETER');
          expect(body.error.message.length).toBeGreaterThanOrEqual(10);
          expect(mockChQuery).not.toHaveBeenCalled();
        }),
        { numRuns: 100 },
      );
    });

    it('rejects invalid severity values', () => {
      return fc.assert(
        fc.asyncProperty(invalidSeverityArb, async (badSeverity) => {
          const response = await app.inject({
            method: 'GET',
            url: `/v1/logs?severity=${encodeURIComponent(badSeverity)}`,
            headers: { 'x-api-key': 'valid-key' },
          });

          expect(response.statusCode).toBe(400);
          const body = response.json();
          expect(body.error.code).toBe('INVALID_PARAMETER');
          expect(body.error.message.length).toBeGreaterThanOrEqual(10);
          expect(mockChQuery).not.toHaveBeenCalled();
        }),
        { numRuns: 100 },
      );
    });

    it('rejects limit exceeding 1000', () => {
      const overLimitArb = fc.integer({ min: 1001, max: 100000 });

      return fc.assert(
        fc.asyncProperty(overLimitArb, async (badLimit) => {
          const response = await app.inject({
            method: 'GET',
            url: `/v1/logs?limit=${badLimit}`,
            headers: { 'x-api-key': 'valid-key' },
          });

          expect(response.statusCode).toBe(400);
          const body = response.json();
          expect(body.error.code).toBe('INVALID_PARAMETER');
          expect(body.error.message.length).toBeGreaterThanOrEqual(10);
          expect(mockChQuery).not.toHaveBeenCalled();
        }),
        { numRuns: 100 },
      );
    });

    it('rejects negative or zero limit', () => {
      const negativeLimitArb = fc.integer({ min: -1000, max: 0 });

      return fc.assert(
        fc.asyncProperty(negativeLimitArb, async (badLimit) => {
          const response = await app.inject({
            method: 'GET',
            url: `/v1/logs?limit=${badLimit}`,
            headers: { 'x-api-key': 'valid-key' },
          });

          expect(response.statusCode).toBe(400);
          const body = response.json();
          expect(body.error.code).toBe('INVALID_PARAMETER');
          expect(body.error.message.length).toBeGreaterThanOrEqual(10);
          expect(mockChQuery).not.toHaveBeenCalled();
        }),
        { numRuns: 100 },
      );
    });
  });

  describe('GET /v1/traces — invalid parameters', () => {
    it('rejects invalid from timestamps', () => {
      return fc.assert(
        fc.asyncProperty(invalidTimestampArb, async (badTimestamp) => {
          const response = await app.inject({
            method: 'GET',
            url: `/v1/traces?from=${encodeURIComponent(badTimestamp)}`,
            headers: { 'x-api-key': 'valid-key' },
          });

          expect(response.statusCode).toBe(400);
          const body = response.json();
          expect(body.error.code).toBe('INVALID_PARAMETER');
          expect(body.error.message.length).toBeGreaterThanOrEqual(10);
          expect(mockChQuery).not.toHaveBeenCalled();
        }),
        { numRuns: 100 },
      );
    });

    it('rejects negative minDuration values', () => {
      const negDurationArb = fc.integer({ min: -100000, max: -1 });

      return fc.assert(
        fc.asyncProperty(negDurationArb, async (badDuration) => {
          const response = await app.inject({
            method: 'GET',
            url: `/v1/traces?minDuration=${badDuration}`,
            headers: { 'x-api-key': 'valid-key' },
          });

          expect(response.statusCode).toBe(400);
          const body = response.json();
          expect(body.error.code).toBe('INVALID_PARAMETER');
          expect(body.error.message.length).toBeGreaterThanOrEqual(10);
          expect(mockChQuery).not.toHaveBeenCalled();
        }),
        { numRuns: 100 },
      );
    });

    it('rejects limit exceeding 200', () => {
      const overLimitArb = fc.integer({ min: 201, max: 10000 });

      return fc.assert(
        fc.asyncProperty(overLimitArb, async (badLimit) => {
          const response = await app.inject({
            method: 'GET',
            url: `/v1/traces?limit=${badLimit}`,
            headers: { 'x-api-key': 'valid-key' },
          });

          expect(response.statusCode).toBe(400);
          const body = response.json();
          expect(body.error.code).toBe('INVALID_PARAMETER');
          expect(body.error.message.length).toBeGreaterThanOrEqual(10);
          expect(mockChQuery).not.toHaveBeenCalled();
        }),
        { numRuns: 100 },
      );
    });
  });

  describe('GET /v1/metrics — invalid parameters', () => {
    it('rejects unsupported interval values', () => {
      return fc.assert(
        fc.asyncProperty(invalidIntervalArb, async (badInterval) => {
          const response = await app.inject({
            method: 'GET',
            url: `/v1/metrics?interval=${encodeURIComponent(badInterval)}`,
            headers: { 'x-api-key': 'valid-key' },
          });

          expect(response.statusCode).toBe(400);
          const body = response.json();
          expect(body.error.code).toBe('INVALID_PARAMETER');
          expect(body.error.message.length).toBeGreaterThanOrEqual(10);
          expect(mockChQuery).not.toHaveBeenCalled();
        }),
        { numRuns: 100 },
      );
    });

    it('rejects unsupported aggregation values', () => {
      return fc.assert(
        fc.asyncProperty(invalidAggregationArb, async (badAgg) => {
          const response = await app.inject({
            method: 'GET',
            url: `/v1/metrics?aggregation=${encodeURIComponent(badAgg)}`,
            headers: { 'x-api-key': 'valid-key' },
          });

          expect(response.statusCode).toBe(400);
          const body = response.json();
          expect(body.error.code).toBe('INVALID_PARAMETER');
          expect(body.error.message.length).toBeGreaterThanOrEqual(10);
          expect(mockChQuery).not.toHaveBeenCalled();
        }),
        { numRuns: 100 },
      );
    });

    it('rejects invalid from timestamps', () => {
      return fc.assert(
        fc.asyncProperty(invalidTimestampArb, async (badTimestamp) => {
          const response = await app.inject({
            method: 'GET',
            url: `/v1/metrics?from=${encodeURIComponent(badTimestamp)}`,
            headers: { 'x-api-key': 'valid-key' },
          });

          expect(response.statusCode).toBe(400);
          const body = response.json();
          expect(body.error.code).toBe('INVALID_PARAMETER');
          expect(body.error.message.length).toBeGreaterThanOrEqual(10);
          expect(mockChQuery).not.toHaveBeenCalled();
        }),
        { numRuns: 100 },
      );
    });
  });

  describe('GET /v1/deployments — invalid parameters', () => {
    it('rejects invalid from timestamps', () => {
      return fc.assert(
        fc.asyncProperty(invalidTimestampArb, async (badTimestamp) => {
          const response = await app.inject({
            method: 'GET',
            url: `/v1/deployments?from=${encodeURIComponent(badTimestamp)}`,
            headers: { 'x-api-key': 'valid-key' },
          });

          expect(response.statusCode).toBe(400);
          const body = response.json();
          expect(body.error.code).toBe('INVALID_PARAMETER');
          expect(body.error.message.length).toBeGreaterThanOrEqual(10);
          expect(mockChQuery).not.toHaveBeenCalled();
        }),
        { numRuns: 100 },
      );
    });

    it('rejects limit exceeding 200', () => {
      const overLimitArb = fc.integer({ min: 201, max: 10000 });

      return fc.assert(
        fc.asyncProperty(overLimitArb, async (badLimit) => {
          const response = await app.inject({
            method: 'GET',
            url: `/v1/deployments?limit=${badLimit}`,
            headers: { 'x-api-key': 'valid-key' },
          });

          expect(response.statusCode).toBe(400);
          const body = response.json();
          expect(body.error.code).toBe('INVALID_PARAMETER');
          expect(body.error.message.length).toBeGreaterThanOrEqual(10);
          expect(mockChQuery).not.toHaveBeenCalled();
        }),
        { numRuns: 100 },
      );
    });
  });
});

// ============================================================
// Property 6: Tenant Data Isolation
// ============================================================

describe('Property 6: Tenant Data Isolation', () => {
  /**
   * **Validates: Requirements 18.1, 18.3**
   *
   * For any two distinct tenants A and B, querying via tenant B's API key
   * SHALL always include tenant B's tenant_id in the WHERE clause, ensuring
   * zero records belonging to tenant A are returned. The tenant_id is always
   * part of the ClickHouse query regardless of other parameters.
   */

  it('always includes the authenticated tenant_id in log queries', () => {
    return fc.assert(
      fc.asyncProperty(tenantIdArb, serviceNameArb, async (tenantId, service) => {
        mockChQuery.mockClear();
        mockAuthForTenant(tenantId);
        mockChQuery.mockResolvedValue([]);

        await app.inject({
          method: 'GET',
          url: `/v1/logs?service_name=${encodeURIComponent(service)}`,
          headers: { 'x-api-key': 'valid-key' },
        });

        expect(mockChQuery).toHaveBeenCalled();
        const [queryText, queryParams] = mockChQuery.mock.calls[0];
        expect(queryText).toContain('tenant_id = {tenantId:String}');
        expect(queryParams.tenantId).toBe(tenantId);
      }),
      { numRuns: 100 },
    );
  });

  it('always includes the authenticated tenant_id in trace queries', () => {
    return fc.assert(
      fc.asyncProperty(tenantIdArb, environmentArb, async (tenantId, env) => {
        mockChQuery.mockClear();
        mockAuthForTenant(tenantId);
        mockChQuery.mockResolvedValue([]);

        await app.inject({
          method: 'GET',
          url: `/v1/traces?environment=${encodeURIComponent(env)}`,
          headers: { 'x-api-key': 'valid-key' },
        });

        expect(mockChQuery).toHaveBeenCalled();
        const [queryText, queryParams] = mockChQuery.mock.calls[0];
        expect(queryText).toContain('tenant_id = {tenantId:String}');
        expect(queryParams.tenantId).toBe(tenantId);
      }),
      { numRuns: 100 },
    );
  });

  it('always includes the authenticated tenant_id in metrics queries', () => {
    return fc.assert(
      fc.asyncProperty(tenantIdArb, metricNameArb, async (tenantId, metricName) => {
        mockChQuery.mockClear();
        mockAuthForTenant(tenantId);
        mockChQuery.mockResolvedValue([]);

        await app.inject({
          method: 'GET',
          url: `/v1/metrics?metric_name=${encodeURIComponent(metricName)}`,
          headers: { 'x-api-key': 'valid-key' },
        });

        expect(mockChQuery).toHaveBeenCalled();
        const [queryText, queryParams] = mockChQuery.mock.calls[0];
        expect(queryText).toContain('tenant_id');
        expect(queryParams.tenantId).toBe(tenantId);
      }),
      { numRuns: 100 },
    );
  });

  it('always includes the authenticated tenant_id in services queries', () => {
    return fc.assert(
      fc.asyncProperty(tenantIdArb, async (tenantId) => {
        mockChQuery.mockClear();
        mockAuthForTenant(tenantId);
        mockChQuery.mockResolvedValue([]);

        await app.inject({
          method: 'GET',
          url: '/v1/services',
          headers: { 'x-api-key': 'valid-key' },
        });

        expect(mockChQuery).toHaveBeenCalled();
        const [queryText, queryParams] = mockChQuery.mock.calls[0];
        expect(queryText).toContain('tenant_id = {tenantId:String}');
        expect(queryParams.tenantId).toBe(tenantId);
      }),
      { numRuns: 100 },
    );
  });

  it('always includes the authenticated tenant_id in deployments queries', () => {
    return fc.assert(
      fc.asyncProperty(tenantIdArb, serviceNameArb, async (tenantId, service) => {
        mockChQuery.mockClear();
        mockAuthForTenant(tenantId);
        mockChQuery.mockResolvedValue([]);

        await app.inject({
          method: 'GET',
          url: `/v1/deployments?service=${encodeURIComponent(service)}`,
          headers: { 'x-api-key': 'valid-key' },
        });

        expect(mockChQuery).toHaveBeenCalled();
        const [queryText, queryParams] = mockChQuery.mock.calls[0];
        expect(queryText).toContain('tenant_id = {tenantId:String}');
        expect(queryParams.tenantId).toBe(tenantId);
      }),
      { numRuns: 100 },
    );
  });

  it('returns zero records when ClickHouse returns empty for a different tenant', () => {
    return fc.assert(
      fc.asyncProperty(tenantIdArb, tenantIdArb, async (tenantA, tenantB) => {
        fc.pre(tenantA !== tenantB);
        mockChQuery.mockClear();

        // Simulate: data was ingested under tenantA, but we query as tenantB
        mockAuthForTenant(tenantB);
        mockChQuery.mockResolvedValue([]); // ClickHouse returns nothing for tenantB

        const response = await app.inject({
          method: 'GET',
          url: '/v1/logs',
          headers: { 'x-api-key': 'valid-key' },
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();
        expect(body.data).toEqual([]);
        expect(body.pagination.hasMore).toBe(false);

        // Verify the query was scoped to tenantB, not tenantA
        const [, queryParams] = mockChQuery.mock.calls[0];
        expect(queryParams.tenantId).toBe(tenantB);
        expect(queryParams.tenantId).not.toBe(tenantA);
      }),
      { numRuns: 100 },
    );
  });
});

// ============================================================
// Property 7: Cross-Tenant Resource Not-Found
// ============================================================

describe('Property 7: Cross-Tenant Resource Not-Found', () => {
  /**
   * **Validates: Requirements 18.4, 8.6**
   *
   * For any resource (trace) that exists under tenant A, a direct lookup
   * of that resource's identifier using tenant B's API key SHALL return
   * HTTP 404, indistinguishable from a genuinely non-existent resource.
   * This is because the query always scopes to the authenticated tenant_id.
   */

  it('returns 404 for trace detail when trace belongs to another tenant', () => {
    return fc.assert(
      fc.asyncProperty(tenantIdArb, traceIdArb, async (tenantId, traceId) => {
        mockChQuery.mockClear();
        mockAuthForTenant(tenantId);
        mockChQuery.mockResolvedValue([]);

        const response = await app.inject({
          method: 'GET',
          url: `/v1/traces/${traceId}`,
          headers: { 'x-api-key': 'valid-key' },
        });

        expect(response.statusCode).toBe(404);
        const body = response.json();
        expect(body.error.code).toBe('NOT_FOUND');
        expect(body.error.message.length).toBeGreaterThanOrEqual(10);

        // Verify the query was scoped to the authenticated tenant
        const [queryText, queryParams] = mockChQuery.mock.calls[0];
        expect(queryText).toContain('tenant_id = {tenantId:String}');
        expect(queryParams.tenantId).toBe(tenantId);
        expect(queryParams.traceId).toBe(traceId);
      }),
      { numRuns: 100 },
    );
  });

  it('trace detail 404 response is indistinguishable from non-existent resource', () => {
    return fc.assert(
      fc.asyncProperty(
        tenantIdArb,
        traceIdArb,
        traceIdArb,
        async (tenantId, existingTraceId, nonExistentTraceId) => {
          fc.pre(existingTraceId !== nonExistentTraceId);
          mockChQuery.mockClear();
          mockAuthForTenant(tenantId);
          mockChQuery.mockResolvedValue([]);

          // Query for a trace that "exists" in another tenant
          const response1 = await app.inject({
            method: 'GET',
            url: `/v1/traces/${existingTraceId}`,
            headers: { 'x-api-key': 'valid-key' },
          });

          // Query for a genuinely non-existent trace
          const response2 = await app.inject({
            method: 'GET',
            url: `/v1/traces/${nonExistentTraceId}`,
            headers: { 'x-api-key': 'valid-key' },
          });

          // Both should return 404 with the same structure
          expect(response1.statusCode).toBe(404);
          expect(response2.statusCode).toBe(404);
          expect(response1.json().error.code).toBe(response2.json().error.code);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ============================================================
// Property 8: Query Filtering Correctness
// ============================================================

describe('Property 8: Query Filtering Correctness', () => {
  /**
   * **Validates: Requirements 7.3, 7.4, 8.4, 9.3, 10.2**
   *
   * For any combination of valid filter parameters, the query endpoint
   * SHALL pass those filters correctly to the ClickHouse query. We verify
   * that filter parameters are correctly included in the WHERE clause.
   */

  it('passes all log filter combinations to ClickHouse correctly', () => {
    const logFilterArb = fc.record({
      service_name: fc.option(serviceNameArb, { nil: undefined }),
      environment: fc.option(environmentArb, { nil: undefined }),
      severity: fc.option(validSeverityArb, { nil: undefined }),
      search: fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: undefined }),
      from: fc.option(validTimestampArb, { nil: undefined }),
      to: fc.option(validTimestampArb, { nil: undefined }),
    });

    return fc.assert(
      fc.asyncProperty(logFilterArb, async (filters) => {
        mockChQuery.mockClear();
        mockChQuery.mockResolvedValue([]);

        const params = new URLSearchParams();
        if (filters.service_name) params.set('service_name', filters.service_name);
        if (filters.environment) params.set('environment', filters.environment);
        if (filters.severity) params.set('severity', filters.severity);
        if (filters.search) params.set('search', filters.search);
        if (filters.from) params.set('from', filters.from);
        if (filters.to) params.set('to', filters.to);

        const response = await app.inject({
          method: 'GET',
          url: `/v1/logs?${params.toString()}`,
          headers: { 'x-api-key': 'valid-key' },
        });

        expect(response.statusCode).toBe(200);
        expect(mockChQuery).toHaveBeenCalledTimes(3);

        const [queryText, queryParams] = mockChQuery.mock.calls[0];

        // Verify each filter is included in the query
        if (filters.service_name) {
          expect(queryText).toContain('service_name = {serviceName:String}');
          expect(queryParams.serviceName).toBe(filters.service_name);
        }
        if (filters.environment) {
          expect(queryText).toContain('environment = {environment:String}');
          expect(queryParams.environment).toBe(filters.environment);
        }
        if (filters.severity) {
          expect(queryText).toContain('severity = {severity:String}');
          expect(queryParams.severity).toBe(filters.severity.toUpperCase());
        }
        if (filters.search) {
          expect(queryText).toContain('positionCaseInsensitive(message, {search:String}) > 0');
          expect(queryParams.search).toBe(filters.search);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('passes all trace filter combinations to ClickHouse correctly', () => {
    const traceFilterArb = fc.record({
      service: fc.option(serviceNameArb, { nil: undefined }),
      environment: fc.option(environmentArb, { nil: undefined }),
      minDuration: fc.option(fc.integer({ min: 0, max: 999999 }).map(String), { nil: undefined }),
      from: fc.option(validTimestampArb, { nil: undefined }),
      to: fc.option(validTimestampArb, { nil: undefined }),
    });

    return fc.assert(
      fc.asyncProperty(traceFilterArb, async (filters) => {
        mockChQuery.mockClear();
        mockChQuery.mockResolvedValue([]);

        const params = new URLSearchParams();
        if (filters.service) params.set('service', filters.service);
        if (filters.environment) params.set('environment', filters.environment);
        if (filters.minDuration) params.set('minDuration', filters.minDuration);
        if (filters.from) params.set('from', filters.from);
        if (filters.to) params.set('to', filters.to);

        const response = await app.inject({
          method: 'GET',
          url: `/v1/traces?${params.toString()}`,
          headers: { 'x-api-key': 'valid-key' },
        });

        expect(response.statusCode).toBe(200);
        expect(mockChQuery).toHaveBeenCalledTimes(1);

        const [queryText, queryParams] = mockChQuery.mock.calls[0];

        if (filters.service) {
          expect(queryText).toContain('service_name = {service:String}');
          expect(queryParams.service).toBe(filters.service);
        }
        if (filters.environment) {
          expect(queryText).toContain('environment = {environment:String}');
          expect(queryParams.environment).toBe(filters.environment);
        }
        if (filters.minDuration) {
          expect(queryText).toContain('duration_ms >= {minDuration:Float64}');
          expect(queryParams.minDuration).toBe(parseFloat(filters.minDuration));
        }
      }),
      { numRuns: 100 },
    );
  });

  it('passes all metrics filter combinations to ClickHouse correctly', () => {
    const metricsFilterArb = fc
      .record({
        metric_name: fc.option(metricNameArb, { nil: undefined }),
        service: fc.option(serviceNameArb, { nil: undefined }),
        environment: fc.option(environmentArb, { nil: undefined }),
        from: fc.option(validTimestampArb, { nil: undefined }),
        to: fc.option(validTimestampArb, { nil: undefined }),
      })
      .filter((filters) => {
        if (!filters.from || !filters.to) return true;
        return new Date(filters.from).getTime() <= new Date(filters.to).getTime();
      });

    return fc.assert(
      fc.asyncProperty(metricsFilterArb, async (filters) => {
        mockChQuery.mockClear();
        mockChQuery.mockResolvedValue([]);

        const params = new URLSearchParams();
        if (filters.metric_name) params.set('metric_name', filters.metric_name);
        if (filters.service) params.set('service', filters.service);
        if (filters.environment) params.set('environment', filters.environment);
        if (filters.from) params.set('from', filters.from);
        if (filters.to) params.set('to', filters.to);

        const response = await app.inject({
          method: 'GET',
          url: `/v1/metrics?${params.toString()}`,
          headers: { 'x-api-key': 'valid-key' },
        });

        expect(response.statusCode).toBe(200);
        expect(mockChQuery).toHaveBeenCalledTimes(1);

        const [queryText, queryParams] = mockChQuery.mock.calls[0];

        if (filters.metric_name) {
          expect(queryText).toContain('metric_name');
          expect(queryParams.metricName).toBe(filters.metric_name);
        }
        if (filters.service) {
          expect(queryText).toContain('service_name');
          expect(queryParams.serviceName).toBe(filters.service);
        }
        if (filters.environment) {
          expect(queryText).toContain('environment');
          expect(queryParams.environment).toBe(filters.environment);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('passes all deployment filter combinations to ClickHouse correctly', () => {
    const deployFilterArb = fc.record({
      service: fc.option(serviceNameArb, { nil: undefined }),
      environment: fc.option(environmentArb, { nil: undefined }),
      from: fc.option(validTimestampArb, { nil: undefined }),
      to: fc.option(validTimestampArb, { nil: undefined }),
    });

    return fc.assert(
      fc.asyncProperty(deployFilterArb, async (filters) => {
        mockChQuery.mockClear();
        mockChQuery.mockResolvedValue([]);

        const params = new URLSearchParams();
        if (filters.service) params.set('service', filters.service);
        if (filters.environment) params.set('environment', filters.environment);
        if (filters.from) params.set('from', filters.from);
        if (filters.to) params.set('to', filters.to);

        const response = await app.inject({
          method: 'GET',
          url: `/v1/deployments?${params.toString()}`,
          headers: { 'x-api-key': 'valid-key' },
        });

        expect(response.statusCode).toBe(200);
        expect(mockChQuery).toHaveBeenCalledTimes(1);

        const [queryText, queryParams] = mockChQuery.mock.calls[0];

        if (filters.service) {
          expect(queryText).toContain('service_name = {service:String}');
          expect(queryParams.service).toBe(filters.service);
        }
        if (filters.environment) {
          expect(queryText).toContain('environment = {environment:String}');
          expect(queryParams.environment).toBe(filters.environment);
        }
        if (filters.from) {
          expect(queryText).toContain(
            "timestamp >= parseDateTime64BestEffort({from:String}, 3, 'UTC')",
          );
          expect(queryParams.from).toBe(filters.from);
        }
        if (filters.to) {
          expect(queryText).toContain(
            "timestamp <= parseDateTime64BestEffort({to:String}, 3, 'UTC')",
          );
          expect(queryParams.to).toBe(filters.to);
        }
      }),
      { numRuns: 100 },
    );
  });
});

// ============================================================
// Property 9: Cursor-Based Pagination Consistency
// ============================================================

describe('Property 9: Cursor-Based Pagination Consistency', () => {
  /**
   * **Validates: Requirements 7.1, 8.2, 9.5**
   *
   * For any query result set larger than the page size, iterating through
   * all pages using the returned cursor SHALL yield every record exactly
   * once. The final page SHALL have hasMore: false.
   * We verify cursor encoding/decoding and hasMore logic.
   */

  it('returns hasMore=true and valid cursor when ClickHouse returns N+1 rows for logs', () => {
    const limitArb = fc.integer({ min: 1, max: 100 });

    return fc.assert(
      fc.asyncProperty(limitArb, async (limit) => {
        mockChQuery.mockClear();
        // Mock ClickHouse returning limit + 1 rows (indicating more data)
        const rows = Array.from({ length: limit + 1 }, (_, i) => ({
          id: `log-${i}`,
          tenant_id: 'tenant-1',
          project_id: 'project-1',
          timestamp: `2024-01-15T10:${String(59 - i).padStart(2, '0')}:00.000`,
          received_at: '2024-01-15T10:30:01.000',
          service_name: 'my-service',
          environment: 'production',
          source: '',
          resource_attributes: '{}',
          attributes: '{}',
          severity: 'INFO',
          message: `Log message ${i}`,
          trace_id: '',
          span_id: '',
          fingerprint: '',
        }));
        mockChQuery.mockResolvedValue(rows);

        const response = await app.inject({
          method: 'GET',
          url: `/v1/logs?limit=${limit}`,
          headers: { 'x-api-key': 'valid-key' },
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();

        // Should return exactly `limit` records (not limit+1)
        expect(body.data).toHaveLength(limit);
        expect(body.pagination.hasMore).toBe(true);
        expect(body.pagination.cursor).not.toBeNull();

        // Verify cursor is valid base64 JSON with ts and id
        const decoded = JSON.parse(Buffer.from(body.pagination.cursor, 'base64').toString());
        expect(decoded).toHaveProperty('ts');
        expect(decoded).toHaveProperty('id');

        // Cursor should reference the last returned record
        const lastRecord = body.data[body.data.length - 1];
        expect(decoded.ts).toBe(lastRecord.timestamp);
        expect(decoded.id).toBe(lastRecord.id);
      }),
      { numRuns: 100 },
    );
  });

  it('returns hasMore=false and null cursor when ClickHouse returns <= N rows for logs', () => {
    const limitArb = fc.integer({ min: 1, max: 100 });
    const countArb = fc.integer({ min: 0, max: 50 });

    return fc.assert(
      fc.asyncProperty(limitArb, countArb, async (limit, count) => {
        mockChQuery.mockClear();
        // Ensure count <= limit (so hasMore should be false)
        const actualCount = Math.min(count, limit);

        const rows = Array.from({ length: actualCount }, (_, i) => ({
          id: `log-${i}`,
          tenant_id: 'tenant-1',
          project_id: 'project-1',
          timestamp: `2024-01-15T10:${String(59 - i).padStart(2, '0')}:00.000`,
          received_at: '2024-01-15T10:30:01.000',
          service_name: 'my-service',
          environment: 'production',
          source: '',
          resource_attributes: '{}',
          attributes: '{}',
          severity: 'INFO',
          message: `Log message ${i}`,
          trace_id: '',
          span_id: '',
          fingerprint: '',
        }));
        mockChQuery.mockResolvedValue(rows);

        const response = await app.inject({
          method: 'GET',
          url: `/v1/logs?limit=${limit}`,
          headers: { 'x-api-key': 'valid-key' },
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();

        expect(body.data).toHaveLength(actualCount);
        expect(body.pagination.hasMore).toBe(false);
        expect(body.pagination.cursor).toBeNull();
      }),
      { numRuns: 100 },
    );
  });

  it('returns hasMore=true and valid cursor when ClickHouse returns N+1 rows for deployments', () => {
    const limitArb = fc.integer({ min: 1, max: 50 });

    return fc.assert(
      fc.asyncProperty(limitArb, async (limit) => {
        mockChQuery.mockClear();
        const rows = Array.from({ length: limit + 1 }, (_, i) => ({
          deployment_id: `deploy-${i}`,
          tenant_id: 'tenant-1',
          project_id: 'project-1',
          timestamp: `2024-01-15T10:${String(59 - i).padStart(2, '0')}:00.000`,
          service_name: 'my-service',
          environment: 'production',
          version: `v1.0.${i}`,
          git_sha: 'abc123',
          deployed_by: 'ci-bot',
          provider: 'github-actions',
          metadata: '{}',
        }));
        mockChQuery.mockResolvedValue(rows);

        const response = await app.inject({
          method: 'GET',
          url: `/v1/deployments?limit=${limit}`,
          headers: { 'x-api-key': 'valid-key' },
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();

        expect(body.data).toHaveLength(limit);
        expect(body.pagination.hasMore).toBe(true);
        expect(body.pagination.cursor).not.toBeNull();

        // Verify cursor structure
        const decoded = JSON.parse(Buffer.from(body.pagination.cursor, 'base64').toString());
        expect(decoded).toHaveProperty('ts');
        expect(decoded).toHaveProperty('id');
      }),
      { numRuns: 100 },
    );
  });

  it('cursor from previous page is passed to ClickHouse query for logs', () => {
    const cursorArb = fc.record({
      ts: validTimestampArb,
      id: fc.hexaString({ minLength: 8, maxLength: 16 }),
    });

    return fc.assert(
      fc.asyncProperty(cursorArb, async (cursorData) => {
        mockChQuery.mockClear();
        mockChQuery.mockResolvedValue([]);
        const cursor = Buffer.from(JSON.stringify(cursorData)).toString('base64');

        await app.inject({
          method: 'GET',
          url: `/v1/logs?cursor=${cursor}`,
          headers: { 'x-api-key': 'valid-key' },
        });

        expect(mockChQuery).toHaveBeenCalledTimes(3);
        const [queryText, queryParams] = mockChQuery.mock.calls[0];

        // Verify cursor conditions are in the query
        expect(queryText).toContain('cursorTs');
        expect(queryText).toContain('cursorId');
        expect(queryParams.cursorTs).toBe(cursorData.ts);
        expect(queryParams.cursorId).toBe(cursorData.id);
      }),
      { numRuns: 100 },
    );
  });

  it('fetchLimit is always limit + 1 for hasMore detection in logs', () => {
    const limitArb = fc.integer({ min: 1, max: 1000 });

    return fc.assert(
      fc.asyncProperty(limitArb, async (limit) => {
        mockChQuery.mockClear();
        mockChQuery.mockResolvedValue([]);

        await app.inject({
          method: 'GET',
          url: `/v1/logs?limit=${limit}`,
          headers: { 'x-api-key': 'valid-key' },
        });

        const [, queryParams] = mockChQuery.mock.calls[0];
        expect(queryParams.fetchLimit).toBe(limit + 1);
      }),
      { numRuns: 100 },
    );
  });
});

// ============================================================
// Property 11: Metric Aggregation Correctness
// ============================================================

describe('Property 11: Metric Aggregation Correctness', () => {
  /**
   * **Validates: Requirements 9.4**
   *
   * For any valid aggregation function (avg, sum, min, max, count) with
   * a valid interval (1m, 5m, 15m, 1h, 1d), the query SHALL include the
   * correct aggregation function and interval in the ClickHouse query.
   */

  it('includes correct aggregation function in query when interval is specified', () => {
    return fc.assert(
      fc.asyncProperty(validAggregationArb, validIntervalArb, async (aggregation, interval) => {
        mockChQuery.mockClear();
        mockChQuery.mockResolvedValue([]);

        await app.inject({
          method: 'GET',
          url: `/v1/metrics?interval=${interval}&aggregation=${aggregation}`,
          headers: { 'x-api-key': 'valid-key' },
        });

        expect(mockChQuery).toHaveBeenCalledTimes(1);
        const [queryText] = mockChQuery.mock.calls[0];

        // Verify aggregation function is in the query
        expect(queryText).toContain(expectedMetricAggregationSql(aggregation));
        // Verify interval-based grouping is used
        expect(queryText).toContain('toStartOfInterval');
        expect(queryText).toContain('GROUP BY');
        expect(queryText).toContain('ORDER BY point_timestamp ASC');
      }),
      { numRuns: 100 },
    );
  });

  it('maps interval values to correct ClickHouse INTERVAL syntax', () => {
    const intervalMappings: Array<[string, string]> = [
      ['1m', 'INTERVAL 1 MINUTE'],
      ['5m', 'INTERVAL 5 MINUTE'],
      ['15m', 'INTERVAL 15 MINUTE'],
      ['1h', 'INTERVAL 1 HOUR'],
      ['1d', 'INTERVAL 1 DAY'],
    ];

    const intervalPairArb = fc.constantFrom(...intervalMappings);

    return fc.assert(
      fc.asyncProperty(
        intervalPairArb,
        validAggregationArb,
        async ([interval, expectedSql], aggregation) => {
          mockChQuery.mockClear();
          mockChQuery.mockResolvedValue([]);

          await app.inject({
            method: 'GET',
            url: `/v1/metrics?interval=${interval}&aggregation=${aggregation}`,
            headers: { 'x-api-key': 'valid-key' },
          });

          const [queryText] = mockChQuery.mock.calls[0];
          expect(queryText).toContain(expectedSql);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('uses raw query without aggregation when no interval is specified', () => {
    return fc.assert(
      fc.asyncProperty(metricNameArb, async (metricName) => {
        mockChQuery.mockClear();
        mockChQuery.mockResolvedValue([]);

        await app.inject({
          method: 'GET',
          url: `/v1/metrics?metric_name=${encodeURIComponent(metricName)}`,
          headers: { 'x-api-key': 'valid-key' },
        });

        expect(mockChQuery).toHaveBeenCalledTimes(1);
        const [queryText] = mockChQuery.mock.calls[0];

        // Without interval, should use raw query with LIMIT 1000
        expect(queryText).toContain('LIMIT 1000');
        expect(queryText).toContain('ORDER BY timestamp ASC');
        expect(queryText).not.toContain('toStartOfInterval');
        expect(queryText).not.toContain('GROUP BY');
      }),
      { numRuns: 100 },
    );
  });

  it('defaults aggregation to avg when only interval is specified', () => {
    return fc.assert(
      fc.asyncProperty(validIntervalArb, async (interval) => {
        mockChQuery.mockClear();
        mockChQuery.mockResolvedValue([]);

        const response = await app.inject({
          method: 'GET',
          url: `/v1/metrics?interval=${interval}`,
          headers: { 'x-api-key': 'valid-key' },
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();
        expect(body.aggregation).toBe('avg');

        const [queryText] = mockChQuery.mock.calls[0];
        expect(queryText).toContain('avg(value)');
      }),
      { numRuns: 100 },
    );
  });

  it('returns correct response shape with aggregation metadata', () => {
    return fc.assert(
      fc.asyncProperty(
        validAggregationArb,
        validIntervalArb,
        metricNameArb,
        async (aggregation, interval, metricName) => {
          mockChQuery.mockClear();
          mockChQuery.mockResolvedValue([]);

          const response = await app.inject({
            method: 'GET',
            url: `/v1/metrics?metric_name=${encodeURIComponent(metricName)}&interval=${interval}&aggregation=${aggregation}`,
            headers: { 'x-api-key': 'valid-key' },
          });

          expect(response.statusCode).toBe(200);
          const body = response.json();
          expect(body.metric_name).toBe(metricName);
          expect(body.aggregation).toBe(aggregation);
          expect(body.interval).toBe(interval);
          expect(Array.isArray(body.data)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ============================================================
// Property 12: Service Catalog Aggregation
// ============================================================

describe('Property 12: Service Catalog Aggregation', () => {
  /**
   * **Validates: Requirements 10.1**
   *
   * The services endpoint SHALL aggregate across logs, spans, and metrics
   * tables using UNION ALL. We verify the query structure includes all
   * three tables and proper aggregation.
   */

  it('services query uses UNION ALL across logs, spans, and metrics tables', () => {
    return fc.assert(
      fc.asyncProperty(tenantIdArb, async (tenantId) => {
        mockChQuery.mockClear();
        mockAuthForTenant(tenantId);
        mockChQuery.mockResolvedValue([]);

        await app.inject({
          method: 'GET',
          url: '/v1/services',
          headers: { 'x-api-key': 'valid-key' },
        });

        expect(mockChQuery).toHaveBeenCalledTimes(1);
        const [queryText, queryParams] = mockChQuery.mock.calls[0];

        // Verify UNION ALL structure across all three tables
        expect(queryText).toContain('FROM logs');
        expect(queryText).toContain('FROM spans');
        expect(queryText).toContain('FROM metrics');
        expect(queryText).toContain('UNION ALL');

        // Verify tenant scoping in all sub-queries
        const tenantMatches = queryText.match(/tenant_id = \{tenantId:String\}/g);
        expect(tenantMatches).not.toBeNull();
        // Should appear at least 3 times (once per sub-query)
        expect(tenantMatches!.length).toBeGreaterThanOrEqual(3);

        expect(queryParams.tenantId).toBe(tenantId);
      }),
      { numRuns: 100 },
    );
  });

  it('services query groups by service_name and environment', () => {
    return fc.assert(
      fc.asyncProperty(tenantIdArb, async (tenantId) => {
        mockChQuery.mockClear();
        mockAuthForTenant(tenantId);
        mockChQuery.mockResolvedValue([]);

        await app.inject({
          method: 'GET',
          url: '/v1/services',
          headers: { 'x-api-key': 'valid-key' },
        });

        const [queryText] = mockChQuery.mock.calls[0];
        expect(queryText).toContain('GROUP BY service_name, environment');
      }),
      { numRuns: 100 },
    );
  });

  it('services response correctly converts string counts to numbers', () => {
    const serviceDataArb = fc.record({
      service_name: serviceNameArb,
      environment: environmentArb,
      log_count: fc.nat({ max: 10000 }).map(String),
      span_count: fc.nat({ max: 10000 }).map(String),
      metric_count: fc.nat({ max: 10000 }).map(String),
    });

    return fc.assert(
      fc.asyncProperty(
        fc.array(serviceDataArb, { minLength: 1, maxLength: 5 }),
        async (services) => {
          mockChQuery.mockClear();
          const rows = services.map((s) => ({
            ...s,
            last_seen: '2024-01-15T10:30:00.000',
          }));
          mockChQuery.mockResolvedValue(rows);

          const response = await app.inject({
            method: 'GET',
            url: '/v1/services',
            headers: { 'x-api-key': 'valid-key' },
          });

          expect(response.statusCode).toBe(200);
          const body = response.json();
          expect(body.data).toHaveLength(services.length);

          for (let i = 0; i < body.data.length; i++) {
            const entry = body.data[i];
            const original = services[i];

            expect(entry.service_name).toBe(original.service_name);
            expect(entry.environment).toBe(original.environment);
            expect(typeof entry.log_count).toBe('number');
            expect(typeof entry.span_count).toBe('number');
            expect(typeof entry.metric_count).toBe('number');
            expect(entry.log_count).toBe(parseInt(original.log_count, 10));
            expect(entry.span_count).toBe(parseInt(original.span_count, 10));
            expect(entry.metric_count).toBe(parseInt(original.metric_count, 10));
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('services endpoint returns empty array with 200 when no services exist', () => {
    return fc.assert(
      fc.asyncProperty(tenantIdArb, async (tenantId) => {
        mockChQuery.mockClear();
        mockAuthForTenant(tenantId);
        mockChQuery.mockResolvedValue([]);

        const response = await app.inject({
          method: 'GET',
          url: '/v1/services',
          headers: { 'x-api-key': 'valid-key' },
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();
        expect(body.data).toEqual([]);
      }),
      { numRuns: 100 },
    );
  });
});
