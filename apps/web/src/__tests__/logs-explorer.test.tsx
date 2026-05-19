import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import LogsExplorerPage from '../app/logs/page';

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

let intersectionCallback: IntersectionObserverCallback | null = null;
const mockIntersectionObserver = vi.fn(
  (callback: IntersectionObserverCallback, options?: IntersectionObserverInit) => {
    intersectionCallback = callback;
    return {
      root: options?.root ?? null,
      rootMargin: options?.rootMargin ?? '',
      thresholds: [0],
      observe: vi.fn(),
      unobserve: vi.fn(),
      disconnect: vi.fn(),
      takeRecords: vi.fn(() => []),
    };
  },
);

const mockLogs = [
  {
    id: 'log1',
    tenant_id: 't1',
    project_id: 'p1',
    timestamp: '2024-01-01T12:00:00Z',
    received_at: '2024-01-01T12:00:01Z',
    service_name: 'auth-service',
    environment: 'production',
    source: '',
    resource_attributes: { 'service.version': 'v1.2.3' },
    attributes: { 'http.route': '/api/login' },
    severity: 'ERROR',
    message: 'Connection failed',
    trace_id: 'trace-abc',
    span_id: 'span-abc',
    fingerprint: 'fingerprint-abc',
  },
  {
    id: 'log2',
    tenant_id: 't1',
    project_id: 'p1',
    timestamp: '2024-01-01T11:55:00Z',
    received_at: '2024-01-01T11:55:01Z',
    service_name: 'api-gateway',
    environment: 'staging',
    source: '',
    resource_attributes: {},
    attributes: {},
    severity: 'INFO',
    message: 'Request processed',
    trace_id: '',
    span_id: '',
    fingerprint: '',
  },
];

describe('LogsExplorerPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    intersectionCallback = null;
    vi.stubGlobal('IntersectionObserver', mockIntersectionObserver);
  });

  it('renders filter controls and fetches logs on mount', async () => {
    mockApiClient.mockImplementation(async (path: string) => {
      if (path === '/v1/services') {
        return { data: [{ service_name: 'auth-service', environment: 'production' }] };
      }
      if (path === '/v1/logs') {
        return { data: mockLogs, pagination: { cursor: null, hasMore: false } };
      }
      return { data: [] };
    });

    render(<LogsExplorerPage />);

    await waitFor(() => {
      expect(screen.getByText('Logs Explorer')).toBeInTheDocument();
    });

    // Default time range buttons are visible
    expect(screen.getByText('15m')).toBeInTheDocument();
    expect(screen.getAllByText('1h').length).toBeGreaterThan(0);
    expect(screen.getByText('6h')).toBeInTheDocument();
    expect(screen.getByText('24h')).toBeInTheDocument();
    expect(screen.getByText('7d')).toBeInTheDocument();

    // Logs rendered in table
    await waitFor(() => {
      expect(screen.getByText('Connection failed')).toBeInTheDocument();
      expect(screen.getByText('Request processed')).toBeInTheDocument();
    });
  });

  it('triggers API call with time range filter when time range is changed', async () => {
    mockApiClient.mockImplementation(async (path: string) => {
      if (path === '/v1/services') {
        return { data: [] };
      }
      if (path === '/v1/logs') {
        return { data: [], pagination: { cursor: null, hasMore: false } };
      }
      return { data: [] };
    });

    render(<LogsExplorerPage />);

    // Wait for initial load
    await waitFor(() => {
      expect(mockApiClient).toHaveBeenCalledWith('/v1/logs', expect.anything());
    });

    const initialCallCount = mockApiClient.mock.calls.filter(
      ([path]) => path === '/v1/logs',
    ).length;

    // Click 24h time range
    fireEvent.click(screen.getByText('24h'));

    // New API call should be made with updated time range
    await waitFor(() => {
      const newCallCount = mockApiClient.mock.calls.filter(([path]) => path === '/v1/logs').length;
      expect(newCallCount).toBeGreaterThan(initialCallCount);
    });
  });

  it('triggers API call with service filter when service is selected', async () => {
    mockApiClient.mockImplementation(async (path: string) => {
      if (path === '/v1/services') {
        return {
          data: [
            { service_name: 'auth-service', environment: 'production' },
            { service_name: 'api-gateway', environment: 'staging' },
          ],
        };
      }
      if (path === '/v1/logs') {
        return { data: mockLogs, pagination: { cursor: null, hasMore: false } };
      }
      return { data: [] };
    });

    render(<LogsExplorerPage />);

    await waitFor(() => {
      expect(screen.getByText('Connection failed')).toBeInTheDocument();
    });

    // Select a service from dropdown
    const serviceSelect = screen.getByDisplayValue('All Services');
    fireEvent.change(serviceSelect, { target: { value: 'auth-service' } });

    // Verify API was called with service_name param
    await waitFor(() => {
      const logCalls = mockApiClient.mock.calls.filter(([path]) => path === '/v1/logs');
      const lastCall = logCalls[logCalls.length - 1];
      expect(lastCall[1]).toMatchObject({
        params: expect.objectContaining({ service_name: 'auth-service' }),
      });
    });
  });

  it('renders empty state when no logs match filters', async () => {
    mockApiClient.mockImplementation(async (path: string) => {
      if (path === '/v1/services') {
        return { data: [] };
      }
      if (path === '/v1/logs') {
        return { data: [], pagination: { cursor: null, hasMore: false } };
      }
      return { data: [] };
    });

    render(<LogsExplorerPage />);

    await waitFor(() => {
      expect(screen.getByText('No results found')).toBeInTheDocument();
    });
  });

  it('renders error state when API fails', async () => {
    const { ApiError } = await import('../lib/api');
    mockApiClient.mockImplementation(async (path: string) => {
      if (path === '/v1/services') {
        return { data: [] };
      }
      if (path === '/v1/logs') {
        throw new ApiError(500, 'Internal server error');
      }
      return { data: [] };
    });

    render(<LogsExplorerPage />);

    await waitFor(() => {
      expect(screen.getByText('Internal server error')).toBeInTheDocument();
    });
  });

  it('loads the next page automatically when the infinite loader enters view', async () => {
    mockApiClient.mockImplementation(
      async (path: string, options?: { params?: Record<string, unknown> }) => {
        if (path === '/v1/services') {
          return { data: [] };
        }
        if (path === '/v1/logs') {
          if (options?.params?.cursor === 'next-cursor') {
            return { data: [mockLogs[1]], pagination: { cursor: null, hasMore: false } };
          }
          return {
            data: [mockLogs[0]],
            pagination: { cursor: 'next-cursor', hasMore: true },
          };
        }
        return { data: [] };
      },
    );

    render(<LogsExplorerPage />);

    await waitFor(() => {
      expect(screen.getByText('Connection failed')).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: 'Load More' })).not.toBeInTheDocument();
    await waitFor(() => {
      expect(intersectionCallback).toBeTypeOf('function');
    });

    act(() => {
      intersectionCallback!(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    });

    await waitFor(() => {
      expect(screen.getByText('Request processed')).toBeInTheDocument();
    });
    const logCalls = mockApiClient.mock.calls.filter(([path]) => path === '/v1/logs');
    expect(logCalls[logCalls.length - 1]?.[1]).toMatchObject({
      params: expect.objectContaining({ cursor: 'next-cursor' }),
    });
  });

  it('renders summary and applies a facet filter', async () => {
    mockApiClient.mockImplementation(async (path: string) => {
      if (path === '/v1/services') {
        return { data: [] };
      }
      if (path === '/v1/logs') {
        return {
          data: mockLogs,
          pagination: { cursor: null, hasMore: false },
          summary: {
            total: 12,
            error_count: 2,
            warning_count: 1,
            from: '2024-01-01T11:00:00Z',
            to: '2024-01-01T12:00:00Z',
          },
          facets: {
            services: [{ value: 'checkout-service', count: 5 }],
            severities: [{ value: 'ERROR', count: 2 }],
            environments: [],
            error_types: [],
            http_routes: [],
            fingerprints: [],
            versions: [],
          },
        };
      }
      return { data: [] };
    });

    render(<LogsExplorerPage />);

    await waitFor(() => {
      expect(screen.getByText(/matching logs/)).toBeInTheDocument();
      expect(screen.getByText('checkout-service')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('checkout-service'));

    await waitFor(() => {
      const logCalls = mockApiClient.mock.calls.filter(([path]) => path === '/v1/logs');
      const lastCall = logCalls[logCalls.length - 1];
      expect(lastCall[1]).toMatchObject({
        params: expect.objectContaining({ service_name: 'checkout-service' }),
      });
    });
  });

  it('opens a structured drawer and queries nearby logs', async () => {
    mockApiClient.mockImplementation(async (path: string) => {
      if (path === '/v1/services') {
        return { data: [] };
      }
      if (path === '/v1/logs/around') {
        return { data: [mockLogs[0]] };
      }
      if (path === '/v1/logs') {
        return { data: mockLogs, pagination: { cursor: null, hasMore: false } };
      }
      return { data: [] };
    });

    render(<LogsExplorerPage />);

    await waitFor(() => {
      expect(screen.getByText('Connection failed')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Connection failed'));

    expect(screen.getByText('Log Detail')).toBeInTheDocument();
    expect(screen.getByText('Resource attributes')).toBeInTheDocument();
    expect(screen.getByText('Custom attributes')).toBeInTheDocument();

    fireEvent.click(screen.getByText('View logs around this event'));

    await waitFor(() => {
      expect(mockApiClient).toHaveBeenCalledWith(
        '/v1/logs/around',
        expect.objectContaining({
          params: expect.objectContaining({ log_id: 'log1', trace_id: 'trace-abc' }),
        }),
      );
    });
  });

  it('applies saved local query defaults', async () => {
    mockApiClient.mockImplementation(async (path: string) => {
      if (path === '/v1/services') {
        return { data: [] };
      }
      if (path === '/v1/logs') {
        return { data: [], pagination: { cursor: null, hasMore: false } };
      }
      return { data: [] };
    });

    render(<LogsExplorerPage />);

    await waitFor(() => {
      expect(screen.getByText('Checkout errors last 30m')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Checkout errors last 30m'));

    await waitFor(() => {
      const logCalls = mockApiClient.mock.calls.filter(([path]) => path === '/v1/logs');
      const lastCall = logCalls[logCalls.length - 1];
      expect(lastCall[1]).toMatchObject({
        params: expect.objectContaining({
          service_name: 'checkout-service',
          severity: 'ERROR',
        }),
      });
    });
  });

  it('fetches fingerprint groups when group mode is selected', async () => {
    mockApiClient.mockImplementation(async (path: string) => {
      if (path === '/v1/services') {
        return { data: [] };
      }
      if (path === '/v1/logs/groups') {
        return {
          data: [
            {
              fingerprint: 'fp-1',
              normalized_message: 'timeout',
              example_message: 'timeout after 1000ms',
              count: 4,
              first_seen_at: '2024-01-01T11:00:00Z',
              last_seen_at: '2024-01-01T12:00:00Z',
              service_name: 'checkout-service',
              severity: 'ERROR',
              example_trace_id: 'trace-abc',
            },
          ],
        };
      }
      if (path === '/v1/logs') {
        return { data: [], pagination: { cursor: null, hasMore: false } };
      }
      return { data: [] };
    });

    render(<LogsExplorerPage />);

    fireEvent.click(screen.getByText('Groups'));

    await waitFor(() => {
      expect(screen.getByText('timeout after 1000ms')).toBeInTheDocument();
      expect(mockApiClient).toHaveBeenCalledWith('/v1/logs/groups', expect.anything());
    });
  });
});
