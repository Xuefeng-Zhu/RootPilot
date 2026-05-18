import { describe, it, expect } from 'vitest';
import type { OTLPResourceSpans } from './traces';
import { normalizeSpans, mapSpanKind, mapStatusCode } from './traces';

describe('normalizeSpans', () => {
  const tenantId = 'tenant-123';
  const projectId = 'project-456';

  function makeResourceSpans(overrides?: Partial<OTLPResourceSpans>): OTLPResourceSpans[] {
    return [
      {
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: 'my-service' } },
            { key: 'deployment.environment', value: { stringValue: 'production' } },
          ],
        },
        scopeSpans: [
          {
            scope: { name: 'my-scope' },
            spans: [
              {
                traceId: 'abc123',
                spanId: 'def456',
                parentSpanId: 'ghi789',
                name: 'GET /api/users',
                kind: 2,
                startTimeUnixNano: '1234567890000000000',
                endTimeUnixNano: '1234567891000000000',
                status: { code: 1, message: '' },
                attributes: [
                  { key: 'http.method', value: { stringValue: 'GET' } },
                  { key: 'http.status_code', value: { intValue: '200' } },
                ],
              },
            ],
          },
        ],
        ...overrides,
      },
    ];
  }

  it('should normalize a basic span correctly', () => {
    const result = normalizeSpans(makeResourceSpans(), tenantId, projectId);

    expect(result).toHaveLength(1);
    const span = result[0]!;

    expect(span.tenant_id).toBe(tenantId);
    expect(span.project_id).toBe(projectId);
    expect(span.service_name).toBe('my-service');
    expect(span.environment).toBe('production');
    expect(span.source).toBe('otlp');
    expect(span.trace_id).toBe('abc123');
    expect(span.span_id).toBe('def456');
    expect(span.parent_span_id).toBe('ghi789');
    expect(span.operation_name).toBe('GET /api/users');
    expect(span.kind).toBe('SERVER');
    expect(span.status_code).toBe('OK');
    expect(span.status_message).toBe('');
    expect(span.id).toBeDefined();
    expect(span.timestamp).toBeDefined();
    expect(span.received_at).toBeDefined();
  });

  it('should compute duration_ms correctly', () => {
    const result = normalizeSpans(makeResourceSpans(), tenantId, projectId);
    const span = result[0]!;

    // (1234567891000000000 - 1234567890000000000) / 1,000,000 = 1000 ms
    expect(span.duration_ms).toBe(1000);
  });

  it('should compute duration_ms for sub-millisecond spans', () => {
    const resourceSpans: OTLPResourceSpans[] = [
      {
        resource: { attributes: [] },
        scopeSpans: [
          {
            spans: [
              {
                traceId: 'trace1',
                spanId: 'span1',
                name: 'fast-op',
                startTimeUnixNano: '1000000000000000',
                endTimeUnixNano: '1000000000500000',
                kind: 1,
              },
            ],
          },
        ],
      },
    ];

    const result = normalizeSpans(resourceSpans, tenantId, projectId);
    // (1000000000500000 - 1000000000000000) / 1,000,000 = 0.5 ms
    expect(result[0]!.duration_ms).toBe(0.5);
  });

  it('should convert startTimeUnixNano to ISO 8601 timestamp', () => {
    const result = normalizeSpans(makeResourceSpans(), tenantId, projectId);
    const span = result[0]!;

    // 1234567890000000000 ns = 1234567890000 ms
    const expectedDate = new Date(1234567890000).toISOString();
    expect(span.timestamp).toBe(expectedDate);
  });

  it('should set parent_span_id to null for root spans (empty string)', () => {
    const resourceSpans: OTLPResourceSpans[] = [
      {
        resource: { attributes: [] },
        scopeSpans: [
          {
            spans: [
              {
                traceId: 'trace1',
                spanId: 'span1',
                parentSpanId: '',
                name: 'root-span',
                startTimeUnixNano: '1000000000000000000',
                endTimeUnixNano: '1000000001000000000',
              },
            ],
          },
        ],
      },
    ];

    const result = normalizeSpans(resourceSpans, tenantId, projectId);
    expect(result[0]!.parent_span_id).toBeNull();
  });

  it('should set parent_span_id to null for root spans (absent field)', () => {
    const resourceSpans: OTLPResourceSpans[] = [
      {
        resource: { attributes: [] },
        scopeSpans: [
          {
            spans: [
              {
                traceId: 'trace1',
                spanId: 'span1',
                name: 'root-span',
                startTimeUnixNano: '1000000000000000000',
                endTimeUnixNano: '1000000001000000000',
              },
            ],
          },
        ],
      },
    ];

    const result = normalizeSpans(resourceSpans, tenantId, projectId);
    expect(result[0]!.parent_span_id).toBeNull();
  });

  it('should extract resource attributes as flattened record', () => {
    const result = normalizeSpans(makeResourceSpans(), tenantId, projectId);
    const span = result[0]!;

    expect(span.resource_attributes).toEqual({
      'service.name': 'my-service',
      'deployment.environment': 'production',
    });
  });

  it('should extract span attributes as flattened record', () => {
    const result = normalizeSpans(makeResourceSpans(), tenantId, projectId);
    const span = result[0]!;

    expect(span.attributes).toEqual({
      'http.method': 'GET',
      'http.status_code': '200',
    });
  });

  it('should handle multiple resource spans with multiple scope spans', () => {
    const resourceSpans: OTLPResourceSpans[] = [
      {
        resource: {
          attributes: [{ key: 'service.name', value: { stringValue: 'service-a' } }],
        },
        scopeSpans: [
          {
            spans: [
              {
                traceId: 'trace1',
                spanId: 'span1',
                name: 'op-1',
                startTimeUnixNano: '1000000000000000000',
                endTimeUnixNano: '1000000001000000000',
              },
              {
                traceId: 'trace1',
                spanId: 'span2',
                name: 'op-2',
                startTimeUnixNano: '1000000001000000000',
                endTimeUnixNano: '1000000002000000000',
              },
            ],
          },
          {
            spans: [
              {
                traceId: 'trace1',
                spanId: 'span3',
                name: 'op-3',
                startTimeUnixNano: '1000000002000000000',
                endTimeUnixNano: '1000000003000000000',
              },
            ],
          },
        ],
      },
      {
        resource: {
          attributes: [{ key: 'service.name', value: { stringValue: 'service-b' } }],
        },
        scopeSpans: [
          {
            spans: [
              {
                traceId: 'trace2',
                spanId: 'span4',
                name: 'op-4',
                startTimeUnixNano: '1000000003000000000',
                endTimeUnixNano: '1000000004000000000',
              },
            ],
          },
        ],
      },
    ];

    const result = normalizeSpans(resourceSpans, tenantId, projectId);
    expect(result).toHaveLength(4);
    expect(result[0]!.service_name).toBe('service-a');
    expect(result[3]!.service_name).toBe('service-b');
  });

  it('should default service_name and environment to empty string when not in resource attributes', () => {
    const resourceSpans: OTLPResourceSpans[] = [
      {
        resource: { attributes: [] },
        scopeSpans: [
          {
            spans: [
              {
                traceId: 'trace1',
                spanId: 'span1',
                name: 'op',
                startTimeUnixNano: '1000000000000000000',
                endTimeUnixNano: '1000000001000000000',
              },
            ],
          },
        ],
      },
    ];

    const result = normalizeSpans(resourceSpans, tenantId, projectId);
    expect(result[0]!.service_name).toBe('');
    expect(result[0]!.environment).toBe('');
  });

  it('should handle missing resource object', () => {
    const resourceSpans: OTLPResourceSpans[] = [
      {
        scopeSpans: [
          {
            spans: [
              {
                traceId: 'trace1',
                spanId: 'span1',
                name: 'op',
                startTimeUnixNano: '1000000000000000000',
                endTimeUnixNano: '1000000001000000000',
              },
            ],
          },
        ],
      },
    ];

    const result = normalizeSpans(resourceSpans, tenantId, projectId);
    expect(result).toHaveLength(1);
    expect(result[0]!.service_name).toBe('');
    expect(result[0]!.resource_attributes).toEqual({});
  });

  it('should handle attributes with different value types', () => {
    const resourceSpans: OTLPResourceSpans[] = [
      {
        resource: { attributes: [] },
        scopeSpans: [
          {
            spans: [
              {
                traceId: 'trace1',
                spanId: 'span1',
                name: 'op',
                startTimeUnixNano: '1000000000000000000',
                endTimeUnixNano: '1000000001000000000',
                attributes: [
                  { key: 'str', value: { stringValue: 'hello' } },
                  { key: 'int', value: { intValue: 42 } },
                  { key: 'double', value: { doubleValue: 3.14 } },
                  { key: 'bool', value: { boolValue: true } },
                ],
              },
            ],
          },
        ],
      },
    ];

    const result = normalizeSpans(resourceSpans, tenantId, projectId);
    expect(result[0]!.attributes).toEqual({
      str: 'hello',
      int: '42',
      double: '3.14',
      bool: 'true',
    });
  });

  it('should return empty array for empty resourceSpans', () => {
    const result = normalizeSpans([], tenantId, projectId);
    expect(result).toEqual([]);
  });

  it('should generate unique IDs for each span', () => {
    const resourceSpans: OTLPResourceSpans[] = [
      {
        resource: { attributes: [] },
        scopeSpans: [
          {
            spans: [
              {
                traceId: 'trace1',
                spanId: 'span1',
                name: 'op-1',
                startTimeUnixNano: '1000000000000000000',
                endTimeUnixNano: '1000000001000000000',
              },
              {
                traceId: 'trace1',
                spanId: 'span2',
                name: 'op-2',
                startTimeUnixNano: '1000000001000000000',
                endTimeUnixNano: '1000000002000000000',
              },
            ],
          },
        ],
      },
    ];

    const result = normalizeSpans(resourceSpans, tenantId, projectId);
    expect(result[0]!.id).not.toBe(result[1]!.id);
  });
});

describe('mapSpanKind', () => {
  it('should map 0 to INTERNAL', () => {
    expect(mapSpanKind(0)).toBe('INTERNAL');
  });

  it('should map 1 to INTERNAL', () => {
    expect(mapSpanKind(1)).toBe('INTERNAL');
  });

  it('should map 2 to SERVER', () => {
    expect(mapSpanKind(2)).toBe('SERVER');
  });

  it('should map 3 to CLIENT', () => {
    expect(mapSpanKind(3)).toBe('CLIENT');
  });

  it('should map 4 to PRODUCER', () => {
    expect(mapSpanKind(4)).toBe('PRODUCER');
  });

  it('should map 5 to CONSUMER', () => {
    expect(mapSpanKind(5)).toBe('CONSUMER');
  });

  it('should default to INTERNAL for undefined', () => {
    expect(mapSpanKind(undefined)).toBe('INTERNAL');
  });

  it('should default to INTERNAL for out-of-range values', () => {
    expect(mapSpanKind(6)).toBe('INTERNAL');
    expect(mapSpanKind(-1)).toBe('INTERNAL');
    expect(mapSpanKind(99)).toBe('INTERNAL');
  });
});

describe('mapStatusCode', () => {
  it('should map 0 to UNSET', () => {
    expect(mapStatusCode(0)).toBe('UNSET');
  });

  it('should map 1 to OK', () => {
    expect(mapStatusCode(1)).toBe('OK');
  });

  it('should map 2 to ERROR', () => {
    expect(mapStatusCode(2)).toBe('ERROR');
  });

  it('should default to UNSET for undefined', () => {
    expect(mapStatusCode(undefined)).toBe('UNSET');
  });

  it('should default to UNSET for out-of-range values', () => {
    expect(mapStatusCode(3)).toBe('UNSET');
    expect(mapStatusCode(-1)).toBe('UNSET');
    expect(mapStatusCode(99)).toBe('UNSET');
  });
});
