import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import MetricsExplorerPage from '../app/metrics/page';

// Mock the API client
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

describe('MetricsExplorerPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders empty state when no metric is selected', async () => {
    mockApiClient.mockImplementation(async (path: string) => {
      if (path === '/v1/metrics/names') {
        return { data: ['http.request.duration', 'cpu.usage'] };
      }
      if (path === '/v1/services') {
        return { data: [] };
      }
      return { data: [] };
    });

    render(<MetricsExplorerPage />);

    await waitFor(() => {
      expect(screen.getByText('Metrics Explorer')).toBeInTheDocument();
    });

    expect(screen.getByText('Select a metric to visualize time-series data')).toBeInTheDocument();
  });

  it('renders line chart with mock data when metric is selected', async () => {
    const mockData = [
      { timestamp: '2024-01-01T12:00:00Z', value: 10 },
      { timestamp: '2024-01-01T12:01:00Z', value: 25 },
      { timestamp: '2024-01-01T12:02:00Z', value: 15 },
      { timestamp: '2024-01-01T12:03:00Z', value: 30 },
      { timestamp: '2024-01-01T12:04:00Z', value: 20 },
    ];

    mockApiClient.mockImplementation(async (path: string, _options?: { params?: Record<string, unknown> }) => {
      if (path === '/v1/metrics/names') {
        return { data: ['http.request.duration'] };
      }
      if (path === '/v1/services') {
        return { data: [] };
      }
      if (path === '/v1/metrics') {
        return {
          metric_name: 'http.request.duration',
          aggregation: 'avg',
          interval: '1m',
          data: mockData,
        };
      }
      return { data: [] };
    });

    const { container } = render(<MetricsExplorerPage />);

    await waitFor(() => {
      expect(screen.getByText('Metrics Explorer')).toBeInTheDocument();
    });

    // Simulate selecting a metric by directly setting the input and triggering change
    const metricInput = screen.getByPlaceholderText('Search metrics...');
    fireEvent.focus(metricInput);

    await waitFor(() => {
      // Dropdown should appear with the metric option
      expect(screen.getByRole('option', { name: 'http.request.duration' })).toBeInTheDocument();
    });

    // Click the metric option
    fireEvent.click(screen.getByRole('option', { name: 'http.request.duration' }));

    // Chart SVG should appear with the line chart
    await waitFor(() => {
      const svg = container.querySelector('svg[role="img"]');
      expect(svg).toBeInTheDocument();
      expect(svg?.getAttribute('aria-label')).toBe('Metric values line chart');
    });

    // Polyline should be rendered (the line in the chart)
    const polyline = container.querySelector('polyline');
    expect(polyline).toBeInTheDocument();
  });

  it('renders no data message when metric has empty results', async () => {
    mockApiClient.mockImplementation(async (path: string) => {
      if (path === '/v1/metrics/names') {
        return { data: ['http.request.duration'] };
      }
      if (path === '/v1/services') {
        return { data: [] };
      }
      if (path === '/v1/metrics') {
        return {
          metric_name: 'http.request.duration',
          aggregation: 'avg',
          interval: '1m',
          data: [],
        };
      }
      return { data: [] };
    });

    render(<MetricsExplorerPage />);

    await waitFor(() => {
      expect(screen.getByText('Metrics Explorer')).toBeInTheDocument();
    });

    // Select a metric
    const metricInput = screen.getByPlaceholderText('Search metrics...');
    fireEvent.focus(metricInput);

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'http.request.duration' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('option', { name: 'http.request.duration' }));

    // Should show no data message
    await waitFor(() => {
      expect(screen.getByText('No data available for the current selection')).toBeInTheDocument();
    });
  });
});


