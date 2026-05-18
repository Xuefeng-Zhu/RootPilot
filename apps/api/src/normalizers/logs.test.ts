import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  normalizeLogRecords,
  mapSeverityNumber,
  flattenAttributes,
  nanoToISO,
  OTLPResourceLogs,
} from './logs';

describe('mapSeverityNumber', () => {
  it('maps 1-4 to TRACE', () => {
    expect(mapSeverityNumber(1)).toBe('TRACE');
    expect(mapSeverityNumber(4)).toBe('TRACE');
  });

  it('maps 5-8 to DEBUG', () => {
    expect(mapSeverityNumber(5)).toBe('DEBUG');
    expect(mapSeverityNumber(8)).toBe('DEBUG');
  });

  it('maps 9-12 to INFO', () => {
    expect(mapSeverityNumber(9)).toBe('INFO');
    expect(mapSeverityNumber(12)).toBe('INFO');
  });

  it('maps 13-16 to WARN', () => {
    expect(mapSeverityNumber(13)).toBe('WARN');
    expect(mapSeverityNumber(16)).toBe('WARN');
  });

  it('maps 17-20 to ERROR', () => {
    expect(mapSeverityNumber(17)).toBe('ERROR');
    expect(mapSeverityNumber(20)).toBe('ERROR');
  });

  it('maps 21-24 to FATAL', () => {
    expect(mapSeverityNumber(21)).toBe('FATAL');
    expect(mapSeverityNumber(24)).toBe('FATAL');
  });

  it('defaults to INFO when absent', () => {
    expect(mapSeverityNumber(undefined)).toBe('INFO');
  });

  it('defaults to INFO when outside valid range', () => {
    expect(mapSeverityNumber(0)).toBe('INFO');
    expect(mapSeverityNumber(-1)).toBe('INFO');
    expect(mapSeverityNumber(25)).toBe('INFO');
    expect(mapSeverityNumber(100)).toBe('INFO');
  });
});

describe('flattenAttributes', () => {
  it('flattens string attributes', () => {
    const attrs = [
      { key: 'service.name', value: { stringValue: 'my-service' } },
    ];
    expect(flattenAttributes(attrs)).toEqual({ 'service.name': 'my-service' });
  });

  it('flattens int attributes', () => {
    const attrs = [{ key: 'count', value: { intValue: 42 } }];
    expect(flattenAttributes(attrs)).toEqual({ count: '42' });
  });

  it('flattens bool attributes', () => {
    const attrs = [{ key: 'enabled', value: { boolValue: true } }];
    expect(flattenAttributes(attrs)).toEqual({ enabled: 'true' });
  });

  it('flattens double attributes', () => {
    const attrs = [{ key: 'rate', value: { doubleValue: 3.14 } }];
    expect(flattenAttributes(attrs)).toEqual({ rate: '3.14' });
  });

  it('returns empty object for undefined', () => {
    expect(flattenAttributes(undefined)).toEqual({});
  });

  it('skips attributes without key or value', () => {
    const attrs = [
      { key: '', value: { stringValue: 'skip' } },
      { key: 'valid', value: { stringValue: 'keep' } },
    ] as any;
    expect(flattenAttributes(attrs)).toEqual({ valid: 'keep' });
  });
});

describe('nanoToISO', () => {
  it('converts nanosecond timestamp to ISO string', () => {
    // 1704067200000000000 ns = 2024-01-01T00:00:00.000Z
    const result = nanoToISO('1704067200000000000');
    expect(result).toBe('2024-01-01T00:00:00.000Z');
  });

  it('returns null for undefined', () => {
    expect(nanoToISO(undefined)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(nanoToISO('')).toBeNull();
  });
});

describe('normalizeLogRecords', () => {
  const tenantId = 'tenant-123';
  const projectId = 'project-456';

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-06-15T10:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('normalizes a complete OTLP log record', () => {
    const resourceLogs: OTLPResourceLogs[] = [
      {
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: 'auth-service' } },
            {
              key: 'deployment.environment',
              value: { stringValue: 'production' },
            },
          ],
        },
        scopeLogs: [
          {
            scope: { name: 'my-scope' },
            logRecords: [
              {
                timeUnixNano: '1718445600000000000', // 2024-06-15T10:00:00.000Z
                severityNumber: 9,
                severityText: 'INFO',
                body: { stringValue: 'User logged in' },
                attributes: [
                  { key: 'user.id', value: { stringValue: 'user-1' } },
                ],
                traceId: 'trace-abc',
                spanId: 'span-def',
              },
            ],
          },
        ],
      },
    ];

    const result = normalizeLogRecords(resourceLogs, tenantId, projectId);

    expect(result).toHaveLength(1);
    const log = result[0];

    expect(log.tenant_id).toBe(tenantId);
    expect(log.project_id).toBe(projectId);
    expect(log.service_name).toBe('auth-service');
    expect(log.environment).toBe('production');
    expect(log.severity).toBe('INFO');
    expect(log.message).toBe('User logged in');
    expect(log.trace_id).toBe('trace-abc');
    expect(log.span_id).toBe('span-def');
    expect(log.source).toBe('my-scope');
    expect(log.attributes).toEqual({ 'user.id': 'user-1' });
    expect(log.resource_attributes).toEqual({
      'service.name': 'auth-service',
      'deployment.environment': 'production',
    });
    expect(log.fingerprint).toBe('');
    expect(log.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
    expect(log.timestamp).toBe('2024-06-15T10:00:00.000Z');
    expect(log.received_at).toBe('2024-06-15T10:00:00.000Z');
  });

  it('assigns server receive time when timestamp is absent', () => {
    const resourceLogs: OTLPResourceLogs[] = [
      {
        resource: { attributes: [] },
        scopeLogs: [
          {
            logRecords: [
              {
                severityNumber: 13,
                body: { stringValue: 'No timestamp' },
              },
            ],
          },
        ],
      },
    ];

    const result = normalizeLogRecords(resourceLogs, tenantId, projectId);

    expect(result).toHaveLength(1);
    expect(result[0].timestamp).toBe('2024-06-15T10:00:00.000Z');
  });

  it('defaults severity to INFO when severityNumber is absent', () => {
    const resourceLogs: OTLPResourceLogs[] = [
      {
        resource: { attributes: [] },
        scopeLogs: [
          {
            logRecords: [
              {
                timeUnixNano: '1718445600000000000',
                body: { stringValue: 'No severity' },
              },
            ],
          },
        ],
      },
    ];

    const result = normalizeLogRecords(resourceLogs, tenantId, projectId);

    expect(result[0].severity).toBe('INFO');
  });

  it('handles multiple resourceLogs with multiple scopeLogs and logRecords', () => {
    const resourceLogs: OTLPResourceLogs[] = [
      {
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: 'svc-a' } },
          ],
        },
        scopeLogs: [
          {
            logRecords: [
              {
                timeUnixNano: '1718445600000000000',
                severityNumber: 17,
                body: { stringValue: 'Error 1' },
              },
              {
                timeUnixNano: '1718445601000000000',
                severityNumber: 5,
                body: { stringValue: 'Debug 1' },
              },
            ],
          },
        ],
      },
      {
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: 'svc-b' } },
          ],
        },
        scopeLogs: [
          {
            logRecords: [
              {
                timeUnixNano: '1718445602000000000',
                severityNumber: 21,
                body: { stringValue: 'Fatal 1' },
              },
            ],
          },
        ],
      },
    ];

    const result = normalizeLogRecords(resourceLogs, tenantId, projectId);

    expect(result).toHaveLength(3);
    expect(result[0].service_name).toBe('svc-a');
    expect(result[0].severity).toBe('ERROR');
    expect(result[1].service_name).toBe('svc-a');
    expect(result[1].severity).toBe('DEBUG');
    expect(result[2].service_name).toBe('svc-b');
    expect(result[2].severity).toBe('FATAL');
  });

  it('handles empty resourceLogs array', () => {
    const result = normalizeLogRecords([], tenantId, projectId);
    expect(result).toEqual([]);
  });

  it('handles missing scopeLogs', () => {
    const resourceLogs: OTLPResourceLogs[] = [
      {
        resource: { attributes: [] },
      },
    ];

    const result = normalizeLogRecords(resourceLogs, tenantId, projectId);
    expect(result).toEqual([]);
  });

  it('handles missing logRecords in scopeLogs', () => {
    const resourceLogs: OTLPResourceLogs[] = [
      {
        resource: { attributes: [] },
        scopeLogs: [{ scope: { name: 'empty-scope' } }],
      },
    ];

    const result = normalizeLogRecords(resourceLogs, tenantId, projectId);
    expect(result).toEqual([]);
  });

  it('defaults service_name and environment to empty string when not in resource attributes', () => {
    const resourceLogs: OTLPResourceLogs[] = [
      {
        resource: { attributes: [] },
        scopeLogs: [
          {
            logRecords: [
              {
                timeUnixNano: '1718445600000000000',
                severityNumber: 9,
                body: { stringValue: 'test' },
              },
            ],
          },
        ],
      },
    ];

    const result = normalizeLogRecords(resourceLogs, tenantId, projectId);

    expect(result[0].service_name).toBe('');
    expect(result[0].environment).toBe('');
  });

  it('generates unique UUIDs for each log record', () => {
    const resourceLogs: OTLPResourceLogs[] = [
      {
        resource: { attributes: [] },
        scopeLogs: [
          {
            logRecords: [
              {
                timeUnixNano: '1718445600000000000',
                body: { stringValue: 'log 1' },
              },
              {
                timeUnixNano: '1718445601000000000',
                body: { stringValue: 'log 2' },
              },
            ],
          },
        ],
      },
    ];

    const result = normalizeLogRecords(resourceLogs, tenantId, projectId);

    expect(result[0].id).not.toBe(result[1].id);
  });
});
