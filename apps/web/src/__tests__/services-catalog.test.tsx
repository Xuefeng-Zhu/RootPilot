import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ServicesPage from '../app/services/page';

vi.mock('../lib/api', () => ({
  apiClient: vi.fn(),
}));

import { apiClient } from '../lib/api';

const mockApiClient = vi.mocked(apiClient);

const mockServices = [
  {
    service_name: 'checkout-service',
    environment: 'production',
    last_seen: '2026-05-18T12:00:00.000Z',
    log_count: 10,
    span_count: 10,
    metric_count: 8,
  },
  {
    service_name: 'auth-service',
    environment: 'staging',
    last_seen: '2026-05-18T11:55:00.000Z',
    log_count: 120,
    span_count: 90,
    metric_count: 30,
  },
  {
    service_name: 'search-service',
    environment: 'production',
    last_seen: '2026-05-18T11:50:00.000Z',
    log_count: 75,
    span_count: 40,
    metric_count: 18,
  },
];

function mockServiceCatalogApi() {
  mockApiClient.mockImplementation(
    async (path: string, options?: { params?: Record<string, unknown> }) => {
      if (path === '/v1/services') {
        return { data: mockServices };
      }
      if (path === '/v1/logs' && options?.params?.severity === 'ERROR') {
        return {
          data: [{ id: 'error-log-1', severity: 'ERROR', service_name: 'checkout-service' }],
          pagination: { cursor: null, hasMore: false },
        };
      }
      if (path === '/v1/logs' && options?.params?.severity === 'FATAL') {
        return {
          data: [{ id: 'fatal-log-1', severity: 'FATAL', service_name: 'checkout-service' }],
          pagination: { cursor: null, hasMore: false },
        };
      }
      if (path === '/v1/traces') {
        return {
          data: [
            {
              trace_id: 'trace-1',
              root_service: 'checkout-service',
              root_operation: 'POST /api/checkout',
              duration_ms: 100,
              span_count: 5,
              status: 'ERROR',
              timestamp: '2026-05-18T12:00:00.000Z',
            },
          ],
          pagination: { cursor: null, hasMore: false },
        };
      }
      return { data: [] };
    },
  );
}

describe('ServicesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockServiceCatalogApi();
  });

  it('renders service catalog filters and service rows', async () => {
    render(<ServicesPage />);

    await waitFor(() => {
      expect(screen.getByText('checkout-service')).toBeInTheDocument();
    });

    expect(screen.getByPlaceholderText('Filter services...')).toBeInTheDocument();
    expect(screen.getByLabelText('Filter services by environment')).toBeInTheDocument();
    expect(screen.getByLabelText('Filter services by health')).toBeInTheDocument();
    expect(screen.getByText('3 of 3 services')).toBeInTheDocument();
    expect(screen.getByText('auth-service')).toBeInTheDocument();
    expect(screen.getByText('search-service')).toBeInTheDocument();
  });

  it('filters services by name', async () => {
    render(<ServicesPage />);

    await waitFor(() => {
      expect(screen.getByText('checkout-service')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText('Filter services by name'), {
      target: { value: 'checkout' },
    });

    expect(screen.getByText('checkout-service')).toBeInTheDocument();
    expect(screen.queryByText('auth-service')).not.toBeInTheDocument();
    expect(screen.queryByText('search-service')).not.toBeInTheDocument();
    expect(screen.getByText('1 of 3 services')).toBeInTheDocument();
  });

  it('filters services by environment and clears filters', async () => {
    render(<ServicesPage />);

    await waitFor(() => {
      expect(screen.getByText('auth-service')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText('Filter services by environment'), {
      target: { value: 'production' },
    });

    expect(screen.getByText('checkout-service')).toBeInTheDocument();
    expect(screen.getByText('search-service')).toBeInTheDocument();
    expect(screen.queryByText('auth-service')).not.toBeInTheDocument();
    expect(screen.getByText('2 of 3 services')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));

    expect(screen.getByText('auth-service')).toBeInTheDocument();
    expect(screen.getByText('3 of 3 services')).toBeInTheDocument();
  });

  it('filters services by computed health', async () => {
    render(<ServicesPage />);

    await waitFor(() => {
      expect(screen.getByText('checkout-service')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText('Filter services by health'), {
      target: { value: 'Unhealthy' },
    });

    expect(screen.getByText('checkout-service')).toBeInTheDocument();
    expect(screen.queryByText('auth-service')).not.toBeInTheDocument();
    expect(screen.queryByText('search-service')).not.toBeInTheDocument();
    expect(screen.getByText('1 of 3 services')).toBeInTheDocument();
  });
});
