import type { ServiceSummary } from '@rootpilot/shared';

export interface TimeSeriesPoint {
  time: string;
  requests: number;
  errors: number;
  latency: number;
}

export const overviewSeries: TimeSeriesPoint[] = [
  { time: '11:15', requests: 68000, errors: 720, latency: 265 },
  { time: '11:16', requests: 71200, errors: 820, latency: 278 },
  { time: '11:17', requests: 74500, errors: 910, latency: 292 },
  { time: '11:18', requests: 72100, errors: 780, latency: 276 },
  { time: '11:19', requests: 76800, errors: 990, latency: 305 },
  { time: '11:20', requests: 73900, errors: 1040, latency: 314 },
  { time: '11:21', requests: 78100, errors: 920, latency: 298 },
  { time: '11:22', requests: 80400, errors: 1110, latency: 326 },
  { time: '11:23', requests: 79600, errors: 1060, latency: 318 },
  { time: '11:24', requests: 81200, errors: 1210, latency: 337 },
  { time: '11:25', requests: 83300, errors: 1170, latency: 329 },
  { time: '11:26', requests: 82100, errors: 1280, latency: 342 },
  { time: '11:27', requests: 84500, errors: 1320, latency: 356 },
  { time: '11:28', requests: 83800, errors: 1240, latency: 339 },
  { time: '11:29', requests: 86100, errors: 1370, latency: 371 },
  { time: '11:30', requests: 87200, errors: 1410, latency: 384 },
];

export const fallbackServices: Array<Partial<ServiceSummary>> = [
  {
    service_name: 'api-gateway',
    environment: 'production',
    health_status: 'healthy',
    request_count: 12100,
    error_count: 42,
    p95_latency_ms: 152,
    log_count: 1200000,
    span_count: 52000,
    metric_count: 410000,
    dependency_count: 3,
    latest_version: 'v2.14.3',
    last_seen_at: new Date().toISOString(),
  },
  {
    service_name: 'checkout-service',
    environment: 'production',
    health_status: 'warning',
    request_count: 8700,
    error_count: 141,
    p95_latency_ms: 412,
    log_count: 980000,
    span_count: 43000,
    metric_count: 380000,
    dependency_count: 4,
    latest_version: 'v2.14.3',
    last_seen_at: new Date().toISOString(),
  },
  {
    service_name: 'payment-service',
    environment: 'production',
    health_status: 'degraded',
    request_count: 2100,
    error_count: 99,
    p95_latency_ms: 823,
    log_count: 440000,
    span_count: 18000,
    metric_count: 120000,
    dependency_count: 2,
    latest_version: 'v0.8.7',
    last_seen_at: new Date().toISOString(),
  },
  {
    service_name: 'order-service',
    environment: 'production',
    health_status: 'healthy',
    request_count: 6900,
    error_count: 14,
    p95_latency_ms: 210,
    log_count: 760000,
    span_count: 31000,
    metric_count: 220000,
    dependency_count: 3,
    latest_version: 'v1.23.0',
    last_seen_at: new Date().toISOString(),
  },
];

export const activeIssues = [
  {
    title: 'High error rate in checkout-service',
    service: 'checkout-service',
    severity: 'P2',
    age: '2m',
  },
  {
    title: 'Increased latency in payment-service',
    service: 'payment-service',
    severity: 'P3',
    age: '8m',
  },
  {
    title: 'Elevated 5xx errors in api-gateway',
    service: 'api-gateway',
    severity: 'P2',
    age: '23m',
  },
];
