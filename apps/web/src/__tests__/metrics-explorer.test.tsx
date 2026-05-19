import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import MetricsExplorerPage from '../app/metrics/page';

vi.mock('recharts', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const React = require('react');
  const passthrough =
    (name: string) =>
    ({ children }: { children?: React.ReactNode; [key: string]: unknown }) =>
      React.createElement('div', { 'data-recharts': name }, children);
  return {
    ResponsiveContainer: passthrough('ResponsiveContainer'),
    LineChart: passthrough('LineChart'),
    BarChart: passthrough('BarChart'),
    CartesianGrid: passthrough('CartesianGrid'),
    Legend: passthrough('Legend'),
    Tooltip: passthrough('Tooltip'),
    XAxis: passthrough('XAxis'),
    YAxis: passthrough('YAxis'),
    Line: passthrough('Line'),
    Bar: passthrough('Bar'),
  };
});

vi.mock('../lib/api', () => ({
  apiClient: vi.fn(),
  ApiError: class ApiError extends Error {
    status: number;
    body?: unknown;
    constructor(status: number, message: string, body?: unknown) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.body = body;
    }
  },
}));

import { apiClient } from '../lib/api';
const mockApiClient = vi.mocked(apiClient);

const catalog = [
  {
    metric_name: 'http.server.request.duration',
    metric_type: 'gauge',
    unit: 'ms',
    services: ['checkout-service', 'api-gateway'],
    last_seen: '2026-05-18T12:00:00.000Z',
    sample_count: 120,
    label_keys: ['route', 'version', 'status_code'],
  },
  {
    metric_name: 'http.server.error.count',
    metric_type: 'sum',
    unit: '1',
    services: ['api-gateway'],
    last_seen: '2026-05-18T12:00:00.000Z',
    sample_count: 8,
    label_keys: ['route'],
  },
];

const detail = {
  metric_name: 'http.server.request.duration',
  description: 'Server-side request latency captured from HTTP spans.',
  metric_type: 'gauge',
  unit: 'ms',
  services: ['checkout-service'],
  label_keys: ['route', 'version', 'status_code'],
  latest_value: 231,
  last_seen: '2026-05-18T12:00:00.000Z',
  sample_count: 120,
  example_labels: { route: '/api/checkout' },
};

const series = {
  metric_name: 'http.server.request.duration',
  unit: 'ms',
  aggregation: 'p95',
  interval: '1m',
  group_by: 'service_name',
  series: [
    {
      name: 'checkout-service',
      labels: { service_name: 'checkout-service' },
      points: [{ timestamp: '2026-05-18T12:00:00.000Z', value: 231 }],
    },
  ],
  comparison: {
    from: '2026-05-18T11:00:00.000Z',
    to: '2026-05-18T12:00:00.000Z',
    previous_from: '2026-05-18T10:00:00.000Z',
    previous_to: '2026-05-18T11:00:00.000Z',
    avg: { current: 180, previous: 120, delta: 60, delta_percent: 50 },
    max: { current: 300, previous: 200, delta: 100, delta_percent: 50 },
    p95: { current: 250, previous: 120, delta: 130, delta_percent: 108.33 },
    count: { current: 20, previous: 18, delta: 2, delta_percent: 11.11 },
    status: 'Large increase',
    summary: 'p95 latency increased 108% compared with the previous 60 minutes.',
  },
};

const topServices = {
  metric_name: 'http.server.request.duration',
  unit: 'ms',
  aggregation: 'p95',
  data: [
    {
      service_name: 'checkout-service',
      latest_value: 231,
      average: 180,
      p95: 250,
      max: 300,
      last_seen: '2026-05-18T12:00:00.000Z',
    },
  ],
};

function mockMetricsApi() {
  mockApiClient.mockImplementation(
    async (path: string, options?: { params?: Record<string, unknown> }) => {
      if (path === '/v1/metrics/catalog') return { data: catalog };
      if (path === '/v1/services') {
        return {
          data: [
            { service_name: 'checkout-service', environment: 'production' },
            { service_name: 'api-gateway', environment: 'staging' },
          ],
        };
      }
      if (path === '/v1/metrics/http.server.request.duration') return detail;
      if (path === '/v1/metrics/http.server.request.duration/series') {
        return { ...series, aggregation: options?.params?.aggregation ?? 'avg' };
      }
      if (path === '/v1/metrics/http.server.request.duration/top-services') return topServices;
      if (path === '/v1/metrics/http.server.error.count') {
        return { ...detail, metric_name: 'http.server.error.count', unit: '1' };
      }
      if (path === '/v1/metrics/http.server.error.count/series') return series;
      if (path === '/v1/metrics/http.server.error.count/top-services') return topServices;
      return { data: [] };
    },
  );
}

describe('MetricsExplorerPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMetricsApi();
  });

  it('renders metric catalog metadata and auto-selects the first metric', async () => {
    render(<MetricsExplorerPage />);

    await waitFor(() => {
      expect(screen.getByText('Metric Catalog')).toBeInTheDocument();
      expect(screen.getAllByText('http.server.request.duration').length).toBeGreaterThan(0);
    });

    expect(screen.getByText('120 samples')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('Metric Details')).toBeInTheDocument();
      expect(
        screen.getByText('Server-side request latency captured from HTTP spans.'),
      ).toBeInTheDocument();
    });
  });

  it('calls series and top-services APIs with selected query params', async () => {
    render(<MetricsExplorerPage />);

    await waitFor(() => {
      expect(screen.getByText('Metric Details')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText('Aggregation'), { target: { value: 'p95' } });
    fireEvent.change(screen.getByLabelText('Service'), { target: { value: 'checkout-service' } });
    fireEvent.change(screen.getByLabelText('Group by'), { target: { value: 'route' } });

    await waitFor(() => {
      expect(mockApiClient).toHaveBeenCalledWith(
        '/v1/metrics/http.server.request.duration/series',
        expect.objectContaining({
          params: expect.objectContaining({
            aggregation: 'p95',
            service: 'checkout-service',
            group_by: 'route',
          }),
        }),
      );
      expect(mockApiClient).toHaveBeenCalledWith(
        '/v1/metrics/http.server.request.duration/top-services',
        expect.objectContaining({
          params: expect.objectContaining({
            aggregation: 'p95',
            service: 'checkout-service',
          }),
        }),
      );
    });
  });

  it('renders chart, comparison, unusual change badge, and top services', async () => {
    render(<MetricsExplorerPage />);

    await waitFor(() => {
      expect(screen.getByTestId('metric-chart')).toBeInTheDocument();
    });

    expect(screen.getByText('Large increase')).toBeInTheDocument();
    expect(screen.getByText(/p95 latency increased/)).toBeInTheDocument();
    expect(screen.getByText('Top Services')).toBeInTheDocument();
    expect(screen.getAllByText('checkout-service').length).toBeGreaterThan(0);
  });

  it('switches chart mode and keeps Recharts rendering available', async () => {
    render(<MetricsExplorerPage />);

    await waitFor(() => {
      expect(screen.getByTestId('metric-chart')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText('Chart'), { target: { value: 'bar' } });

    await waitFor(() => {
      expect(screen.getByTestId('metric-chart')).toBeInTheDocument();
    });
  });

  it('applies label filters to metric queries', async () => {
    render(<MetricsExplorerPage />);

    await waitFor(() => {
      expect(screen.getByText('Metric Details')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Add label filter'));
    fireEvent.change(screen.getByPlaceholderText('label key'), { target: { value: 'route' } });
    fireEvent.change(screen.getByPlaceholderText('label value'), {
      target: { value: '/api/checkout' },
    });

    await waitFor(() => {
      expect(mockApiClient).toHaveBeenCalledWith(
        '/v1/metrics/http.server.request.duration/series',
        expect.objectContaining({
          params: expect.objectContaining({
            labels: JSON.stringify({ route: '/api/checkout' }),
          }),
        }),
      );
    });
  });

  it('renders an empty data state when the selected query has no series points', async () => {
    mockApiClient.mockImplementation(async (path: string) => {
      if (path === '/v1/metrics/catalog') return { data: catalog };
      if (path === '/v1/services') return { data: [] };
      if (path === '/v1/metrics/http.server.request.duration') return detail;
      if (path === '/v1/metrics/http.server.request.duration/series') {
        return { ...series, series: [] };
      }
      if (path === '/v1/metrics/http.server.request.duration/top-services') {
        return { ...topServices, data: [] };
      }
      return { data: [] };
    });

    render(<MetricsExplorerPage />);

    await waitFor(() => {
      expect(screen.getByText('No data available for this query.')).toBeInTheDocument();
    });
  });
});
