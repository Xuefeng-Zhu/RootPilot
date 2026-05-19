import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import OverviewPage from '../app/page';

vi.mock('recharts', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const React = require('react');
  const passthrough =
    (name: string) =>
    ({ children }: { children?: React.ReactNode; [key: string]: unknown }) =>
      React.createElement('div', { 'data-recharts': name }, children);
  const chart = (name: string) => () => React.createElement('div', { 'data-recharts': name });
  return {
    ResponsiveContainer: passthrough('ResponsiveContainer'),
    AreaChart: chart('AreaChart'),
    Area: passthrough('Area'),
    LineChart: chart('LineChart'),
    Line: passthrough('Line'),
    CartesianGrid: passthrough('CartesianGrid'),
    Tooltip: passthrough('Tooltip'),
    XAxis: passthrough('XAxis'),
    YAxis: passthrough('YAxis'),
  };
});

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

describe('OverviewPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders summary cards with data from services', async () => {
    mockApiClient.mockImplementation(async (path: string) => {
      if (path === '/v1/services') {
        return {
          data: [
            {
              service_name: 'auth-service',
              environment: 'production',
              last_seen: '2024-01-01T00:00:00Z',
              log_count: 120,
              span_count: 50,
              metric_count: 30,
            },
            {
              service_name: 'api-gateway',
              environment: 'production',
              last_seen: '2024-01-01T00:00:00Z',
              log_count: 80,
              span_count: 25,
              metric_count: 10,
            },
          ],
        };
      }
      if (path === '/v1/deployments') {
        return {
          data: [
            {
              deployment_id: 'd1',
              timestamp: '2024-01-01T12:00:00Z',
              service_name: 'auth-service',
              environment: 'production',
              version: '1.2.0',
              git_sha: 'abc123',
              deployed_by: 'ci',
            },
          ],
          pagination: { cursor: null, hasMore: false },
        };
      }
      if (path === '/v1/logs') {
        return {
          data: [
            {
              id: 'log1',
              timestamp: '2024-01-01T11:00:00Z',
              service_name: 'auth-service',
              severity: 'ERROR',
              message: 'Connection timeout',
            },
          ],
          pagination: { cursor: null, hasMore: false },
        };
      }
      return { data: [] };
    });

    render(<OverviewPage />);

    await waitFor(() => {
      expect(screen.getByText('Overview')).toBeInTheDocument();
    });

    // Summary cards should show correct totals
    await waitFor(() => {
      expect(screen.getByText('Services')).toBeInTheDocument();
      expect(screen.getByText('Log Volume')).toBeInTheDocument();
      expect(screen.getByText('Trace Volume')).toBeInTheDocument();
      expect(screen.getAllByText('Error Rate').length).toBeGreaterThan(0);
    });

    expect(screen.getAllByText('2').length).toBeGreaterThan(0);
    expect(screen.getByText('200')).toBeInTheDocument(); // 120 + 80 logs
    expect(screen.getByText('75')).toBeInTheDocument(); // 50 + 25 traces
  });

  it('renders recent deployment events', async () => {
    mockApiClient.mockImplementation(async (path: string) => {
      if (path === '/v1/services') {
        return { data: [] };
      }
      if (path === '/v1/deployments') {
        return {
          data: [
            {
              deployment_id: 'd1',
              timestamp: '2024-01-01T12:00:00Z',
              service_name: 'auth-service',
              environment: 'production',
              version: '2.0.0',
              git_sha: 'abc',
              deployed_by: 'deploy-bot',
            },
            {
              deployment_id: 'd2',
              timestamp: '2024-01-01T11:00:00Z',
              service_name: 'api-gateway',
              environment: 'staging',
              version: '1.5.0',
              git_sha: 'def',
              deployed_by: '',
            },
          ],
          pagination: { cursor: null, hasMore: false },
        };
      }
      if (path === '/v1/logs') {
        return { data: [], pagination: { cursor: null, hasMore: false } };
      }
      return { data: [] };
    });

    render(<OverviewPage />);

    await waitFor(() => {
      expect(screen.getAllByText('Recent Deployments').length).toBeGreaterThan(0);
    });

    await waitFor(() => {
      expect(screen.getAllByText('auth-service').length).toBeGreaterThan(0);
      expect(screen.getAllByText('2.0.0').length).toBeGreaterThan(0);
      expect(screen.getByText(/deploy-bot/)).toBeInTheDocument();
      expect(screen.getAllByText('api-gateway').length).toBeGreaterThan(0);
      expect(screen.getAllByText('1.5.0').length).toBeGreaterThan(0);
    });
  });

  it('renders recent error logs', async () => {
    mockApiClient.mockImplementation(async (path: string) => {
      if (path === '/v1/services') {
        return { data: [] };
      }
      if (path === '/v1/deployments') {
        return { data: [], pagination: { cursor: null, hasMore: false } };
      }
      if (path === '/v1/logs') {
        return {
          data: [
            {
              id: 'log1',
              timestamp: '2024-01-01T11:30:00Z',
              service_name: 'payment-service',
              severity: 'ERROR',
              message: 'Payment processing failed',
            },
            {
              id: 'log2',
              timestamp: '2024-01-01T11:20:00Z',
              service_name: 'auth-service',
              severity: 'ERROR',
              message: 'Token expired',
            },
          ],
          pagination: { cursor: null, hasMore: false },
        };
      }
      return { data: [] };
    });

    render(<OverviewPage />);

    await waitFor(() => {
      expect(screen.getByText('Recent Errors')).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByText('Payment processing failed')).toBeInTheDocument();
      expect(screen.getByText('Token expired')).toBeInTheDocument();
    });
  });

  it('renders empty state messages when no data exists', async () => {
    mockApiClient.mockImplementation(async (path: string) => {
      if (path === '/v1/services') {
        return { data: [] };
      }
      if (path === '/v1/deployments') {
        return { data: [], pagination: { cursor: null, hasMore: false } };
      }
      if (path === '/v1/logs') {
        return { data: [], pagination: { cursor: null, hasMore: false } };
      }
      return { data: [] };
    });

    render(<OverviewPage />);

    await waitFor(() => {
      expect(screen.getByText(/no deployment events/i)).toBeInTheDocument();
      expect(screen.getByText(/no error-severity log entries/i)).toBeInTheDocument();
    });
  });

  it('renders error state when API call fails', async () => {
    mockApiClient.mockRejectedValue(new Error('Network error'));

    render(<OverviewPage />);

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });
  });
});
