import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import TracesPage from '../app/traces/page';
import TraceDetailPage from '../app/traces/[traceId]/page';

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
const mockUseParams = vi.mocked(useParams);
const mockUseRouter = vi.mocked(useRouter);
const mockUseSearchParams = vi.mocked(useSearchParams);
const mockReplace = vi.fn();

const mockSpans = [
  {
    id: 's1',
    trace_id: 'trace-abc',
    span_id: 'span-root',
    parent_span_id: null,
    operation_name: 'GET /api/users',
    service_name: 'api-gateway',
    duration_ms: 150,
    status_code: 'OK',
    status_message: '',
    timestamp: '2024-01-01T12:00:00.000Z',
    kind: 'SERVER',
  },
  {
    id: 's2',
    trace_id: 'trace-abc',
    span_id: 'span-child1',
    parent_span_id: 'span-root',
    operation_name: 'SELECT users',
    service_name: 'user-service',
    duration_ms: 45,
    status_code: 'OK',
    status_message: '',
    timestamp: '2024-01-01T12:00:00.020Z',
    kind: 'CLIENT',
  },
  {
    id: 's3',
    trace_id: 'trace-abc',
    span_id: 'span-child2',
    parent_span_id: 'span-root',
    operation_name: 'cache.get',
    service_name: 'cache-service',
    duration_ms: 5,
    status_code: 'ERROR',
    status_message: 'Cache miss',
    timestamp: '2024-01-01T12:00:00.080Z',
    kind: 'CLIENT',
  },
];

describe('TraceDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseParams.mockReturnValue({ traceId: 'trace-abc' });
    mockUseRouter.mockReturnValue({
      push: vi.fn(),
      replace: mockReplace,
      back: vi.fn(),
    });
    mockUseSearchParams.mockReturnValue(new URLSearchParams());
  });

  it('renders span waterfall with correct positioning and colors', async () => {
    mockApiClient.mockResolvedValue({ data: mockSpans });

    render(<TraceDetailPage />);

    await waitFor(() => {
      expect(screen.getByText('Trace Detail')).toBeInTheDocument();
    });

    // Operation names visible
    await waitFor(() => {
      expect(screen.getByText('GET /api/users')).toBeInTheDocument();
      expect(screen.getByText('SELECT users')).toBeInTheDocument();
      expect(screen.getByText('cache.get')).toBeInTheDocument();
    });

    // Service names visible
    expect(screen.getByText('api-gateway')).toBeInTheDocument();
    expect(screen.getByText('user-service')).toBeInTheDocument();
    expect(screen.getByText('cache-service')).toBeInTheDocument();

    // Duration values visible
    expect(screen.getByText('150ms')).toBeInTheDocument();
    expect(screen.getByText('45ms')).toBeInTheDocument();
    expect(screen.getByText('5ms')).toBeInTheDocument();

    // Trace ID shown
    expect(screen.getByText('trace-abc')).toBeInTheDocument();

    // Span count
    expect(screen.getByText(/3 spans/)).toBeInTheDocument();
  });

  it('renders waterfall bars with correct status colors', async () => {
    mockApiClient.mockResolvedValue({ data: mockSpans });

    const { container } = render(<TraceDetailPage />);

    await waitFor(() => {
      expect(screen.getByText('GET /api/users')).toBeInTheDocument();
    });

    // Check status color indicator dots
    const greenDots = container.querySelectorAll('.bg-green-500');
    const redDots = container.querySelectorAll('.bg-red-500');

    // OK spans get green (root + child1 = status indicators + bar elements)
    expect(greenDots.length).toBeGreaterThanOrEqual(2);
    // ERROR spans get red
    expect(redDots.length).toBeGreaterThanOrEqual(1);
  });

  it('renders spans with parent-child indentation', async () => {
    mockApiClient.mockResolvedValue({ data: mockSpans });

    const { container } = render(<TraceDetailPage />);

    await waitFor(() => {
      expect(screen.getByText('GET /api/users')).toBeInTheDocument();
    });

    // The root span should have 0px left padding, children should have 16px
    const indentedElements = container.querySelectorAll('[style*="padding-left"]');
    const paddings = Array.from(indentedElements).map(
      (el) => (el as HTMLElement).style.paddingLeft,
    );

    // Root span at depth 0 → 0px, child spans at depth 1 → 16px
    expect(paddings).toContain('0px');
    expect(paddings).toContain('16px');
  });

  it('renders related logs for spans with links back to the logs explorer', async () => {
    mockApiClient.mockImplementation(async (path: string) => {
      if (path === '/v1/traces/trace-abc') {
        return { data: mockSpans };
      }
      if (path === '/v1/logs') {
        return {
          data: [
            {
              id: 'log-1',
              span_id: 'span-child2',
              message: 'Cache failed',
              severity: 'ERROR',
              timestamp: '2024-01-01T12:00:00.080Z',
            },
          ],
          pagination: { cursor: null, hasMore: false },
        };
      }
      return { data: [] };
    });

    render(<TraceDetailPage />);

    await waitFor(() => {
      expect(screen.getByText('1 related log')).toBeInTheDocument();
    });

    expect(mockApiClient).toHaveBeenCalledWith(
      '/v1/logs',
      expect.objectContaining({
        params: expect.objectContaining({
          trace_id: 'trace-abc',
          from: '2024-01-01T11:59:00.000Z',
          to: '2024-01-01T12:01:00.150Z',
        }),
      }),
    );

    const relatedLogLink = screen.getByText('1 log').closest('a');
    expect(relatedLogLink).toHaveAttribute('href', '/logs?trace_id=trace-abc&span_id=span-child2');
  });

  it('renders 404 state when trace is not found', async () => {
    const { ApiError } = await import('../lib/api');
    mockApiClient.mockRejectedValue(new ApiError(404, 'Not found'));

    render(<TraceDetailPage />);

    await waitFor(() => {
      expect(screen.getByText('Trace Not Found')).toBeInTheDocument();
      expect(screen.getByText(/the requested trace does not exist/i)).toBeInTheDocument();
    });
  });

  it('renders error state when API fails with non-404 error', async () => {
    mockApiClient.mockRejectedValue(new Error('Server unavailable'));

    render(<TraceDetailPage />);

    await waitFor(() => {
      expect(screen.getByText('Failed to fetch trace details')).toBeInTheDocument();
    });
  });
});

describe('TracesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseParams.mockReturnValue({ traceId: 'trace-abc' });
    mockUseRouter.mockReturnValue({
      push: vi.fn(),
      replace: mockReplace,
      back: vi.fn(),
    });
    mockUseSearchParams.mockReturnValue(new URLSearchParams());
  });

  it('hydrates trace filters from URL params for metrics drilldowns', async () => {
    const from = '2026-05-18T07:00:00.000Z';
    const to = '2026-05-19T07:00:00.000Z';
    mockUseSearchParams.mockReturnValue(
      new URLSearchParams({
        from,
        to,
        service: 'db-service',
        environment: 'production',
      }),
    );
    mockApiClient.mockResolvedValue({
      data: [
        {
          trace_id: 'trace-db',
          root_service: 'db-service',
          root_operation: 'SELECT checkout',
          duration_ms: 120,
          span_count: 3,
          status: 'OK',
          timestamp: '2026-05-18T07:30:00.000Z',
        },
      ],
      pagination: { cursor: null, hasMore: false },
    });

    render(<TracesPage />);

    await waitFor(() => {
      expect(mockApiClient).toHaveBeenCalledWith(
        '/v1/traces',
        expect.objectContaining({
          params: expect.objectContaining({
            from,
            to,
            service: 'db-service',
            environment: 'production',
            limit: 50,
          }),
        }),
      );
    });

    expect(screen.getByDisplayValue('db-service')).toBeInTheDocument();
    expect(screen.getByDisplayValue('production')).toBeInTheDocument();
    expect(screen.getByText('Custom')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('SELECT checkout')).toBeInTheDocument();
    });
  });
});
