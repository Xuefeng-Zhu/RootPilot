import { describe, it, expect } from 'vitest';
import type { OTLPResourceMetrics } from './metrics';
import { normalizeMetrics } from './metrics';

describe('normalizeMetrics', () => {
  const tenantId = 'tenant-123';
  const projectId = 'project-456';

  it('normalizes a gauge metric with asDouble value', () => {
    const input: OTLPResourceMetrics[] = [
      {
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: 'my-service' } },
            { key: 'deployment.environment', value: { stringValue: 'production' } },
          ],
        },
        scopeMetrics: [
          {
            scope: { name: 'my-scope' },
            metrics: [
              {
                name: 'http.request.duration',
                unit: 'ms',
                gauge: {
                  dataPoints: [
                    {
                      timeUnixNano: '1700000000000000000',
                      asDouble: 42.5,
                      attributes: [{ key: 'http.method', value: { stringValue: 'GET' } }],
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
    ];

    const result = normalizeMetrics(input, tenantId, projectId);

    expect(result).toHaveLength(1);
    expect(result[0].tenant_id).toBe(tenantId);
    expect(result[0].project_id).toBe(projectId);
    expect(result[0].service_name).toBe('my-service');
    expect(result[0].environment).toBe('production');
    expect(result[0].metric_name).toBe('http.request.duration');
    expect(result[0].metric_type).toBe('gauge');
    expect(result[0].value).toBe(42.5);
    expect(result[0].unit).toBe('ms');
    expect(result[0].labels).toEqual({ 'http.method': 'GET' });
    expect(result[0].id).toBeDefined();
    expect(result[0].timestamp).toBeDefined();
    expect(result[0].received_at).toBeDefined();
    expect(result[0].resource_attributes).toEqual({
      'service.name': 'my-service',
      'deployment.environment': 'production',
    });
  });

  it('normalizes a gauge metric with asInt value', () => {
    const input: OTLPResourceMetrics[] = [
      {
        resource: {
          attributes: [{ key: 'service.name', value: { stringValue: 'worker' } }],
        },
        scopeMetrics: [
          {
            metrics: [
              {
                name: 'queue.depth',
                unit: '1',
                gauge: {
                  dataPoints: [
                    {
                      timeUnixNano: '1700000000000000000',
                      asInt: '15',
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
    ];

    const result = normalizeMetrics(input, tenantId, projectId);

    expect(result).toHaveLength(1);
    expect(result[0].value).toBe(15);
    expect(result[0].metric_type).toBe('gauge');
  });

  it('normalizes a sum metric', () => {
    const input: OTLPResourceMetrics[] = [
      {
        resource: {
          attributes: [{ key: 'service.name', value: { stringValue: 'api-server' } }],
        },
        scopeMetrics: [
          {
            metrics: [
              {
                name: 'http.requests.total',
                unit: '1',
                sum: {
                  dataPoints: [
                    {
                      timeUnixNano: '1700000000000000000',
                      asInt: '1024',
                      attributes: [{ key: 'http.status_code', value: { intValue: '200' } }],
                    },
                  ],
                  isMonotonic: true,
                  aggregationTemporality: 2,
                },
              },
            ],
          },
        ],
      },
    ];

    const result = normalizeMetrics(input, tenantId, projectId);

    expect(result).toHaveLength(1);
    expect(result[0].metric_type).toBe('sum');
    expect(result[0].value).toBe(1024);
    expect(result[0].metric_name).toBe('http.requests.total');
    expect(result[0].labels).toEqual({ 'http.status_code': '200' });
  });

  it('normalizes a histogram metric using sum/count', () => {
    const input: OTLPResourceMetrics[] = [
      {
        resource: {
          attributes: [{ key: 'service.name', value: { stringValue: 'api-server' } }],
        },
        scopeMetrics: [
          {
            metrics: [
              {
                name: 'http.request.duration',
                unit: 'ms',
                histogram: {
                  dataPoints: [
                    {
                      timeUnixNano: '1700000000000000000',
                      count: '10',
                      sum: 500,
                      attributes: [{ key: 'http.method', value: { stringValue: 'POST' } }],
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
    ];

    const result = normalizeMetrics(input, tenantId, projectId);

    expect(result).toHaveLength(1);
    expect(result[0].metric_type).toBe('histogram');
    expect(result[0].value).toBe(50); // 500 / 10
    expect(result[0].labels).toEqual({ 'http.method': 'POST' });
  });

  it('uses sum directly when histogram count is 0', () => {
    const input: OTLPResourceMetrics[] = [
      {
        resource: {
          attributes: [{ key: 'service.name', value: { stringValue: 'svc' } }],
        },
        scopeMetrics: [
          {
            metrics: [
              {
                name: 'latency',
                histogram: {
                  dataPoints: [
                    {
                      timeUnixNano: '1700000000000000000',
                      count: '0',
                      sum: 0,
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
    ];

    const result = normalizeMetrics(input, tenantId, projectId);

    expect(result).toHaveLength(1);
    expect(result[0].value).toBe(0);
  });

  it('skips metrics with unrecognized type (no gauge/sum/histogram)', () => {
    const input: OTLPResourceMetrics[] = [
      {
        resource: {
          attributes: [{ key: 'service.name', value: { stringValue: 'svc' } }],
        },
        scopeMetrics: [
          {
            metrics: [
              {
                name: 'unknown.metric',
                unit: 'ms',
                // No gauge, sum, or histogram field
              } as any,
            ],
          },
        ],
      },
    ];

    const result = normalizeMetrics(input, tenantId, projectId);

    expect(result).toHaveLength(0);
  });

  it('skips data points with non-numeric values', () => {
    const input: OTLPResourceMetrics[] = [
      {
        resource: {
          attributes: [{ key: 'service.name', value: { stringValue: 'svc' } }],
        },
        scopeMetrics: [
          {
            metrics: [
              {
                name: 'bad.metric',
                gauge: {
                  dataPoints: [
                    {
                      timeUnixNano: '1700000000000000000',
                      // No asDouble or asInt
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
    ];

    const result = normalizeMetrics(input, tenantId, projectId);

    expect(result).toHaveLength(0);
  });

  it('handles multiple data points per metric', () => {
    const input: OTLPResourceMetrics[] = [
      {
        resource: {
          attributes: [{ key: 'service.name', value: { stringValue: 'svc' } }],
        },
        scopeMetrics: [
          {
            metrics: [
              {
                name: 'cpu.usage',
                unit: '%',
                gauge: {
                  dataPoints: [
                    { timeUnixNano: '1700000000000000000', asDouble: 45.2 },
                    { timeUnixNano: '1700000001000000000', asDouble: 47.8 },
                    { timeUnixNano: '1700000002000000000', asDouble: 43.1 },
                  ],
                },
              },
            ],
          },
        ],
      },
    ];

    const result = normalizeMetrics(input, tenantId, projectId);

    expect(result).toHaveLength(3);
    expect(result[0].value).toBe(45.2);
    expect(result[1].value).toBe(47.8);
    expect(result[2].value).toBe(43.1);
  });

  it('handles multiple metrics in a single scope', () => {
    const input: OTLPResourceMetrics[] = [
      {
        resource: {
          attributes: [{ key: 'service.name', value: { stringValue: 'svc' } }],
        },
        scopeMetrics: [
          {
            metrics: [
              {
                name: 'metric.a',
                gauge: {
                  dataPoints: [{ timeUnixNano: '1700000000000000000', asDouble: 1 }],
                },
              },
              {
                name: 'metric.b',
                sum: {
                  dataPoints: [{ timeUnixNano: '1700000000000000000', asInt: '2' }],
                },
              },
            ],
          },
        ],
      },
    ];

    const result = normalizeMetrics(input, tenantId, projectId);

    expect(result).toHaveLength(2);
    expect(result[0].metric_name).toBe('metric.a');
    expect(result[0].metric_type).toBe('gauge');
    expect(result[1].metric_name).toBe('metric.b');
    expect(result[1].metric_type).toBe('sum');
  });

  it('handles multiple resource metrics', () => {
    const input: OTLPResourceMetrics[] = [
      {
        resource: {
          attributes: [{ key: 'service.name', value: { stringValue: 'service-a' } }],
        },
        scopeMetrics: [
          {
            metrics: [
              {
                name: 'metric.x',
                gauge: {
                  dataPoints: [{ timeUnixNano: '1700000000000000000', asDouble: 10 }],
                },
              },
            ],
          },
        ],
      },
      {
        resource: {
          attributes: [{ key: 'service.name', value: { stringValue: 'service-b' } }],
        },
        scopeMetrics: [
          {
            metrics: [
              {
                name: 'metric.y',
                gauge: {
                  dataPoints: [{ timeUnixNano: '1700000000000000000', asDouble: 20 }],
                },
              },
            ],
          },
        ],
      },
    ];

    const result = normalizeMetrics(input, tenantId, projectId);

    expect(result).toHaveLength(2);
    expect(result[0].service_name).toBe('service-a');
    expect(result[1].service_name).toBe('service-b');
  });

  it('defaults service_name to "unknown" when not in resource attributes', () => {
    const input: OTLPResourceMetrics[] = [
      {
        resource: { attributes: [] },
        scopeMetrics: [
          {
            metrics: [
              {
                name: 'test.metric',
                gauge: {
                  dataPoints: [{ timeUnixNano: '1700000000000000000', asDouble: 5 }],
                },
              },
            ],
          },
        ],
      },
    ];

    const result = normalizeMetrics(input, tenantId, projectId);

    expect(result).toHaveLength(1);
    expect(result[0].service_name).toBe('unknown');
    expect(result[0].environment).toBe('');
  });

  it('converts nanosecond timestamp to ISO 8601', () => {
    const input: OTLPResourceMetrics[] = [
      {
        resource: {
          attributes: [{ key: 'service.name', value: { stringValue: 'svc' } }],
        },
        scopeMetrics: [
          {
            metrics: [
              {
                name: 'test',
                gauge: {
                  dataPoints: [
                    {
                      timeUnixNano: '1700000000000000000', // 2023-11-14T22:13:20.000Z
                      asDouble: 1,
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
    ];

    const result = normalizeMetrics(input, tenantId, projectId);

    expect(result[0].timestamp).toBe('2023-11-14T22:13:20.000Z');
  });

  it('assigns current time when timestamp is absent', () => {
    const before = new Date();
    const input: OTLPResourceMetrics[] = [
      {
        resource: {
          attributes: [{ key: 'service.name', value: { stringValue: 'svc' } }],
        },
        scopeMetrics: [
          {
            metrics: [
              {
                name: 'test',
                gauge: {
                  dataPoints: [{ asDouble: 1 }],
                },
              },
            ],
          },
        ],
      },
    ];

    const result = normalizeMetrics(input, tenantId, projectId);
    const after = new Date();

    const ts = new Date(result[0].timestamp);
    expect(ts.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(ts.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it('generates unique IDs for each data point', () => {
    const input: OTLPResourceMetrics[] = [
      {
        resource: {
          attributes: [{ key: 'service.name', value: { stringValue: 'svc' } }],
        },
        scopeMetrics: [
          {
            metrics: [
              {
                name: 'test',
                gauge: {
                  dataPoints: [
                    { timeUnixNano: '1700000000000000000', asDouble: 1 },
                    { timeUnixNano: '1700000001000000000', asDouble: 2 },
                  ],
                },
              },
            ],
          },
        ],
      },
    ];

    const result = normalizeMetrics(input, tenantId, projectId);

    expect(result[0].id).not.toBe(result[1].id);
    // UUID v4 format
    expect(result[0].id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('skips histogram data points without sum', () => {
    const input: OTLPResourceMetrics[] = [
      {
        resource: {
          attributes: [{ key: 'service.name', value: { stringValue: 'svc' } }],
        },
        scopeMetrics: [
          {
            metrics: [
              {
                name: 'hist.metric',
                histogram: {
                  dataPoints: [
                    {
                      timeUnixNano: '1700000000000000000',
                      count: '5',
                      // No sum field
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
    ];

    const result = normalizeMetrics(input, tenantId, projectId);

    expect(result).toHaveLength(0);
  });

  it('handles empty resourceMetrics array', () => {
    const result = normalizeMetrics([], tenantId, projectId);
    expect(result).toHaveLength(0);
  });

  it('handles empty scopeMetrics array', () => {
    const input: OTLPResourceMetrics[] = [
      {
        resource: {
          attributes: [{ key: 'service.name', value: { stringValue: 'svc' } }],
        },
        scopeMetrics: [],
      },
    ];

    const result = normalizeMetrics(input, tenantId, projectId);
    expect(result).toHaveLength(0);
  });

  it('handles Infinity and NaN values by skipping them', () => {
    const input: OTLPResourceMetrics[] = [
      {
        resource: {
          attributes: [{ key: 'service.name', value: { stringValue: 'svc' } }],
        },
        scopeMetrics: [
          {
            metrics: [
              {
                name: 'bad.values',
                gauge: {
                  dataPoints: [
                    { timeUnixNano: '1700000000000000000', asDouble: Infinity },
                    { timeUnixNano: '1700000000000000000', asDouble: NaN },
                    { timeUnixNano: '1700000000000000000', asDouble: -Infinity },
                  ],
                },
              },
            ],
          },
        ],
      },
    ];

    const result = normalizeMetrics(input, tenantId, projectId);
    expect(result).toHaveLength(0);
  });
});
