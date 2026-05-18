import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { mapSeverityNumber, normalizeLogRecords } from './logs.js';
import { normalizeSpans, mapSpanKind, mapStatusCode } from './traces.js';

/**
 * Property-based tests for normalizer functions.
 *
 * These tests validate correctness properties across arbitrary inputs
 * using fast-check with a minimum of 100 iterations per property.
 */

describe('Property 2: Severity Number Mapping Correctness', () => {
  /**
   * **Validates: Requirements 2.6**
   *
   * For any integer value, the severity mapping function SHALL return the correct
   * severity string according to the defined ranges (1-4→TRACE, 5-8→DEBUG,
   * 9-12→INFO, 13-16→WARN, 17-20→ERROR, 21-24→FATAL), and for any value
   * outside 1-24 or absent, SHALL return INFO.
   */

  it('maps integers 1-4 to TRACE', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 4 }), (n) => {
        expect(mapSeverityNumber(n)).toBe('TRACE');
      }),
      { numRuns: 100 }
    );
  });

  it('maps integers 5-8 to DEBUG', () => {
    fc.assert(
      fc.property(fc.integer({ min: 5, max: 8 }), (n) => {
        expect(mapSeverityNumber(n)).toBe('DEBUG');
      }),
      { numRuns: 100 }
    );
  });

  it('maps integers 9-12 to INFO', () => {
    fc.assert(
      fc.property(fc.integer({ min: 9, max: 12 }), (n) => {
        expect(mapSeverityNumber(n)).toBe('INFO');
      }),
      { numRuns: 100 }
    );
  });

  it('maps integers 13-16 to WARN', () => {
    fc.assert(
      fc.property(fc.integer({ min: 13, max: 16 }), (n) => {
        expect(mapSeverityNumber(n)).toBe('WARN');
      }),
      { numRuns: 100 }
    );
  });

  it('maps integers 17-20 to ERROR', () => {
    fc.assert(
      fc.property(fc.integer({ min: 17, max: 20 }), (n) => {
        expect(mapSeverityNumber(n)).toBe('ERROR');
      }),
      { numRuns: 100 }
    );
  });

  it('maps integers 21-24 to FATAL', () => {
    fc.assert(
      fc.property(fc.integer({ min: 21, max: 24 }), (n) => {
        expect(mapSeverityNumber(n)).toBe('FATAL');
      }),
      { numRuns: 100 }
    );
  });

  it('maps integers outside 1-24 to INFO', () => {
    const outsideRange = fc.oneof(
      fc.integer({ min: -1000, max: 0 }),
      fc.integer({ min: 25, max: 1000 })
    );

    fc.assert(
      fc.property(outsideRange, (n) => {
        expect(mapSeverityNumber(n)).toBe('INFO');
      }),
      { numRuns: 100 }
    );
  });

  it('maps undefined to INFO', () => {
    expect(mapSeverityNumber(undefined)).toBe('INFO');
  });

  it('maps any arbitrary integer to a valid severity', () => {
    const validSeverities = ['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'];

    fc.assert(
      fc.property(fc.integer(), (n) => {
        const result = mapSeverityNumber(n);
        expect(validSeverities).toContain(result);
      }),
      { numRuns: 100 }
    );
  });
});

describe('Property 3: Span Duration Computation', () => {
  /**
   * **Validates: Requirements 3.1**
   *
   * For any span with startTimeUnixNano and endTimeUnixNano where
   * endTimeUnixNano >= startTimeUnixNano, the computed duration_ms SHALL equal
   * (endTimeUnixNano - startTimeUnixNano) / 1,000,000 with no precision loss
   * beyond floating-point representation.
   */

  it('computes duration_ms = (end - start) / 1,000,000 for arbitrary nanosecond pairs', () => {
    // Generate pairs where end >= start, using realistic nanosecond timestamps
    // (roughly 2020-2025 range in nanoseconds)
    const minNano = BigInt('1577836800000000000'); // 2020-01-01T00:00:00Z
    const maxNano = BigInt('1735689600000000000'); // 2025-01-01T00:00:00Z

    const nanoPairArb = fc
      .bigInt({ min: minNano, max: maxNano })
      .chain((start) =>
        fc
          .bigInt({ min: BigInt(0), max: BigInt('60000000000') }) // up to 60 seconds duration
          .map((offset) => ({ start, end: start + offset }))
      );

    fc.assert(
      fc.property(nanoPairArb, ({ start, end }) => {
        const resourceSpans = [
          {
            resource: { attributes: [] },
            scopeSpans: [
              {
                spans: [
                  {
                    traceId: 'abc123',
                    spanId: 'def456',
                    name: 'test-op',
                    startTimeUnixNano: start.toString(),
                    endTimeUnixNano: end.toString(),
                    kind: 1,
                    status: { code: 0 },
                  },
                ],
              },
            ],
          },
        ];

        const result = normalizeSpans(resourceSpans, 'tenant-1', 'project-1');
        expect(result).toHaveLength(1);

        const expectedDuration = Number(end - start) / 1_000_000;
        expect(result[0].duration_ms).toBeCloseTo(expectedDuration, 10);
      }),
      { numRuns: 100 }
    );
  });

  it('computes zero duration when start equals end', () => {
    fc.assert(
      fc.property(
        fc.bigInt({
          min: BigInt('1577836800000000000'),
          max: BigInt('1735689600000000000'),
        }),
        (timestamp) => {
          const resourceSpans = [
            {
              resource: { attributes: [] },
              scopeSpans: [
                {
                  spans: [
                    {
                      traceId: 'abc123',
                      spanId: 'def456',
                      name: 'zero-duration',
                      startTimeUnixNano: timestamp.toString(),
                      endTimeUnixNano: timestamp.toString(),
                      kind: 2,
                      status: { code: 1 },
                    },
                  ],
                },
              ],
            },
          ];

          const result = normalizeSpans(resourceSpans, 'tenant-1', 'project-1');
          expect(result[0].duration_ms).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('duration is always non-negative when end >= start', () => {
    const nanoPairArb = fc
      .bigInt({
        min: BigInt('1577836800000000000'),
        max: BigInt('1735689600000000000'),
      })
      .chain((start) =>
        fc
          .bigInt({ min: BigInt(0), max: BigInt('3600000000000') }) // up to 1 hour
          .map((offset) => ({ start, end: start + offset }))
      );

    fc.assert(
      fc.property(nanoPairArb, ({ start, end }) => {
        const resourceSpans = [
          {
            resource: { attributes: [] },
            scopeSpans: [
              {
                spans: [
                  {
                    traceId: 'trace-1',
                    spanId: 'span-1',
                    name: 'op',
                    startTimeUnixNano: start.toString(),
                    endTimeUnixNano: end.toString(),
                  },
                ],
              },
            ],
          },
        ];

        const result = normalizeSpans(resourceSpans, 'tenant-1', 'project-1');
        expect(result[0].duration_ms).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 100 }
    );
  });
});

describe('Property 5: Missing Field Defaults', () => {
  /**
   * **Validates: Requirements 2.5, 5.4, 5.5**
   *
   * For any ingestion payload where optional temporal fields are absent
   * (timestamp on logs, deployment_id on deployment events), the system SHALL
   * assign server-generated values: current server time for timestamps, and a
   * valid UUID for deployment_id.
   */

  const ISO_8601_REGEX =
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
  const UUID_V4_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  it('assigns a valid ISO 8601 timestamp when log record has no timestamp', () => {
    // Generate arbitrary log payloads without timestamps
    const messageArb = fc.string({ minLength: 0, maxLength: 200 });
    const severityArb = fc.oneof(
      fc.constant(undefined),
      fc.integer({ min: 1, max: 24 })
    );

    fc.assert(
      fc.property(messageArb, severityArb, (message, severityNumber) => {
        const resourceLogs = [
          {
            resource: { attributes: [] },
            scopeLogs: [
              {
                logRecords: [
                  {
                    // No timeUnixNano — timestamp should be server-generated
                    severityNumber,
                    body: { stringValue: message },
                  },
                ],
              },
            ],
          },
        ];

        const result = normalizeLogRecords(resourceLogs, 'tenant-1', 'project-1');
        expect(result).toHaveLength(1);
        expect(result[0].timestamp).toMatch(ISO_8601_REGEX);

        // Verify the timestamp is a valid date
        const parsed = new Date(result[0].timestamp);
        expect(parsed.getTime()).not.toBeNaN();
      }),
      { numRuns: 100 }
    );
  });

  it('generates a valid UUID for each log record id', () => {
    const messageArb = fc.string({ minLength: 1, maxLength: 100 });

    fc.assert(
      fc.property(messageArb, (message) => {
        const resourceLogs = [
          {
            resource: { attributes: [] },
            scopeLogs: [
              {
                logRecords: [
                  {
                    timeUnixNano: '1718445600000000000',
                    severityNumber: 9,
                    body: { stringValue: message },
                  },
                ],
              },
            ],
          },
        ];

        const result = normalizeLogRecords(resourceLogs, 'tenant-1', 'project-1');
        expect(result).toHaveLength(1);
        expect(result[0].id).toMatch(UUID_V4_REGEX);
      }),
      { numRuns: 100 }
    );
  });

  it('defaults severity to INFO when severityNumber is absent', () => {
    const messageArb = fc.string({ minLength: 0, maxLength: 200 });

    fc.assert(
      fc.property(messageArb, (message) => {
        const resourceLogs = [
          {
            resource: { attributes: [] },
            scopeLogs: [
              {
                logRecords: [
                  {
                    timeUnixNano: '1718445600000000000',
                    // No severityNumber — should default to INFO
                    body: { stringValue: message },
                  },
                ],
              },
            ],
          },
        ];

        const result = normalizeLogRecords(resourceLogs, 'tenant-1', 'project-1');
        expect(result).toHaveLength(1);
        expect(result[0].severity).toBe('INFO');
      }),
      { numRuns: 100 }
    );
  });

  it('server-generated timestamp is close to current time', () => {
    const messageArb = fc.string({ minLength: 0, maxLength: 50 });

    fc.assert(
      fc.property(messageArb, (message) => {
        const before = Date.now();

        const resourceLogs = [
          {
            resource: { attributes: [] },
            scopeLogs: [
              {
                logRecords: [
                  {
                    // No timeUnixNano
                    body: { stringValue: message },
                  },
                ],
              },
            ],
          },
        ];

        const result = normalizeLogRecords(resourceLogs, 'tenant-1', 'project-1');
        const after = Date.now();

        const generatedTime = new Date(result[0].timestamp).getTime();
        // Server-generated timestamp should be between before and after
        expect(generatedTime).toBeGreaterThanOrEqual(before);
        expect(generatedTime).toBeLessThanOrEqual(after);
      }),
      { numRuns: 100 }
    );
  });
});
