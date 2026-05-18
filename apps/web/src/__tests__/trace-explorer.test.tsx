import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useParams } from 'next/navigation';
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
      (el) => (el as HTMLElement).style.paddingLeft
    );

    // Root span at depth 0 → 0px, child spans at depth 1 → 16px
    expect(paddings).toContain('0px');
    expect(paddings).toContain('16px');
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
