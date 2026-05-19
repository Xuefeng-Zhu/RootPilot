import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import TracesPage from '../app/traces/page';
import TraceDetailPage from '../app/traces/[traceId]/page';

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
    tenant_id: 'tenant-1',
    project_id: 'project-1',
    trace_id: 'trace-abc',
    span_id: 'span-root',
    parent_span_id: null,
    operation_name: 'GET /api/users',
    service_name: 'api-gateway',
    environment: 'production',
    source: 'otel',
    resource_attributes: { 'service.name': 'api-gateway' },
    attributes: { 'http.route': '/api/users' },
    duration_ms: 150,
    status_code: 'OK',
    status_message: '',
    timestamp: '2024-01-01T12:00:00.000Z',
    received_at: '2024-01-01T12:00:00.100Z',
    kind: 'SERVER',
  },
  {
    id: 's2',
    tenant_id: 'tenant-1',
    project_id: 'project-1',
    trace_id: 'trace-abc',
    span_id: 'span-child1',
    parent_span_id: 'span-root',
    operation_name: 'SELECT users',
    service_name: 'user-service',
    environment: 'production',
    source: 'otel',
    resource_attributes: { 'service.name': 'user-service' },
    attributes: { 'db.system': 'postgres' },
    duration_ms: 45,
    status_code: 'OK',
    status_message: '',
    timestamp: '2024-01-01T12:00:00.020Z',
    received_at: '2024-01-01T12:00:00.120Z',
    kind: 'CLIENT',
  },
  {
    id: 's3',
    tenant_id: 'tenant-1',
    project_id: 'project-1',
    trace_id: 'trace-abc',
    span_id: 'span-child2',
    parent_span_id: 'span-root',
    operation_name: 'cache.get',
    service_name: 'cache-service',
    environment: 'production',
    source: 'otel',
    resource_attributes: { 'service.name': 'cache-service' },
    attributes: { 'exception.type': 'CacheMiss', 'error.type': 'CacheMiss' },
    duration_ms: 5,
    status_code: 'ERROR',
    status_message: 'Cache miss',
    timestamp: '2024-01-01T12:00:00.080Z',
    received_at: '2024-01-01T12:00:00.180Z',
    kind: 'CLIENT',
  },
];

const traceSummary = {
  trace_id: 'trace-abc',
  start_time: '2024-01-01T12:00:00.000Z',
  timestamp: '2024-01-01T12:00:00.000Z',
  duration_ms: 150,
  root_service: 'api-gateway',
  root_operation: 'GET /api/users',
  status: 'ERROR',
  span_count: 3,
  error_count: 1,
  services: ['api-gateway', 'user-service', 'cache-service'],
  related_logs_count: 1,
  deployment: { near_deployment: true, deployment_id: 'deploy-1' },
};

const mockLogs = [
  {
    id: 'log-1',
    tenant_id: 'tenant-1',
    project_id: 'project-1',
    timestamp: '2024-01-01T12:00:00.080Z',
    received_at: '2024-01-01T12:00:00.180Z',
    service_name: 'cache-service',
    environment: 'production',
    source: 'otel',
    resource_attributes: {},
    attributes: {},
    severity: 'ERROR',
    message: 'Cache failed',
    trace_id: 'trace-abc',
    span_id: 'span-child2',
    fingerprint: 'cache-failed',
  },
];

function mockTraceDetailApi() {
  mockApiClient.mockImplementation(async (path: string, options?: { params?: unknown }) => {
    if (path === '/v1/traces/trace-abc') {
      return { data: mockSpans, summary: traceSummary };
    }
    if (path === '/v1/traces/trace-abc/logs') {
      const spanId = (options?.params as { span_id?: string } | undefined)?.span_id;
      return {
        data: spanId ? mockLogs.filter((log) => log.span_id === spanId) : mockLogs,
      };
    }
    if (path === '/v1/traces/trace-abc/similar') {
      return {
        data: [
          {
            trace_id: 'trace-similar',
            start_time: '2024-01-01T11:58:00.000Z',
            timestamp: '2024-01-01T11:58:00.000Z',
            duration_ms: 210,
            status: 'OK',
            error_count: 0,
          },
        ],
      };
    }
    return { data: [] };
  });
}

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

  it('renders trace summary, waterfall, service breakdown, errors, logs, and similar traces', async () => {
    mockTraceDetailApi();

    render(<TraceDetailPage />);

    await waitFor(() => {
      expect(screen.getByText('Trace Detail')).toBeInTheDocument();
    });

    expect(screen.getAllByText('GET /api/users').length).toBeGreaterThan(0);
    expect(screen.getAllByText('SELECT users').length).toBeGreaterThan(0);
    expect(screen.getAllByText('cache.get').length).toBeGreaterThan(0);
    expect(screen.getByText('Critical Path').closest('section')).toHaveTextContent(
      '195ms across 2 spans',
    );
    expect(screen.getByText('Service Breakdown')).toBeInTheDocument();
    expect(screen.getAllByText('Errors').length).toBeGreaterThan(0);
    expect(screen.getByText('Cache miss')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('Cache failed')).toBeInTheDocument();
    });
    expect(screen.getByText('trace-similar')).toBeInTheDocument();
    expect(screen.getByText('Near deployment').closest('a')).toHaveAttribute(
      'href',
      '/deployments/deploy-1',
    );
  });

  it('selects spans and filters related logs by span id', async () => {
    mockTraceDetailApi();

    render(<TraceDetailPage />);

    await waitFor(() => {
      expect(screen.getAllByText('SELECT users').length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getAllByText('SELECT users')[0]!);
    expect(screen.getByText('span-child1')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'span-child2' } });

    await waitFor(() => {
      expect(mockApiClient).toHaveBeenCalledWith(
        '/v1/traces/trace-abc/logs',
        expect.objectContaining({
          params: { span_id: 'span-child2' },
        }),
      );
    });
  });

  it('renders 404 state when trace is not found', async () => {
    const { ApiError } = await import('../lib/api');
    mockApiClient.mockRejectedValue(new ApiError(404, 'Not found'));

    render(<TraceDetailPage />);

    await waitFor(() => {
      expect(screen.getByText('Trace Not Found')).toBeInTheDocument();
      expect(screen.getByText(/requested trace does not exist/i)).toBeInTheDocument();
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

  it('hydrates trace filters from URL params and calls the trace query API', async () => {
    const from = '2026-05-18T07:00:00.000Z';
    const to = '2026-05-19T07:00:00.000Z';
    mockUseSearchParams.mockReturnValue(
      new URLSearchParams({
        from,
        to,
        service: 'db-service',
        environment: 'production',
        status: 'ERROR',
        operation: 'SELECT',
      }),
    );
    mockApiClient.mockImplementation(async (path: string) => {
      if (path === '/v1/services') {
        return { data: [{ service_name: 'db-service', environment: 'production' }] };
      }
      if (path === '/v1/traces') {
        return {
          data: [
            {
              trace_id: 'trace-db',
              root_service: 'db-service',
              root_operation: 'SELECT checkout',
              start_time: '2026-05-18T07:30:00.000Z',
              timestamp: '2026-05-18T07:30:00.000Z',
              duration_ms: 120,
              span_count: 3,
              error_count: 1,
              services: ['db-service'],
              status: 'ERROR',
              near_deployment: false,
              deployment_id: null,
            },
          ],
          pagination: { cursor: null, hasMore: false },
          summary: {
            latency_buckets: [
              { bucket: '<100ms', count: 0 },
              { bucket: '100-300ms', count: 1 },
              { bucket: '300-1000ms', count: 0 },
              { bucket: '1-3s', count: 0 },
              { bucket: '>3s', count: 0 },
            ],
          },
        };
      }
      return { data: [] };
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
            status: 'ERROR',
            operation: 'SELECT',
            limit: 50,
          }),
        }),
      );
    });

    expect(screen.getByDisplayValue('db-service')).toBeInTheDocument();
    expect(screen.getByDisplayValue('production')).toBeInTheDocument();
    expect(screen.getByDisplayValue('ERROR')).toBeInTheDocument();
    expect(screen.getByText('Custom')).toBeInTheDocument();
    expect(screen.getByText('100-300ms')).toBeInTheDocument();
    expect(screen.getByText('SELECT checkout')).toBeInTheDocument();
  });

  it('updates the URL when filters change', async () => {
    mockApiClient.mockImplementation(async (path: string) => {
      if (path === '/v1/services') return { data: [] };
      if (path === '/v1/traces') {
        return {
          data: [],
          pagination: { cursor: null, hasMore: false },
          summary: { latency_buckets: [] },
        };
      }
      return { data: [] };
    });

    render(<TracesPage />);

    fireEvent.change(screen.getByPlaceholderText('Any service'), {
      target: { value: 'checkout-service' },
    });

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith(
        expect.stringContaining('service=checkout-service'),
        { scroll: false },
      );
    });
  });
});
