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
    id: 'summary-1',
    service_name: 'checkout-service',
    environment: 'production',
    first_seen_at: '2026-05-18T11:00:00.000Z',
    last_seen_at: '2026-05-18T12:00:00.000Z',
    last_seen: '2026-05-18T12:00:00.000Z',
    source_signals: { logs: true, traces: true, metrics: true, deployments: true },
    latest_version: 'v1.4.2',
    latest_deployment_id: 'deploy-1',
    request_count: 100,
    error_count: 14,
    log_count: 10,
    span_count: 10,
    metric_count: 8,
    deployment_count: 1,
    dependency_count: 3,
    avg_latency_ms: 182,
    p95_latency_ms: 842,
    health_status: 'degraded',
    updated_at: '2026-05-18T12:00:00.000Z',
  },
  {
    id: 'summary-2',
    service_name: 'auth-service',
    environment: 'staging',
    first_seen_at: '2026-05-18T11:00:00.000Z',
    last_seen_at: '2026-05-18T11:55:00.000Z',
    last_seen: '2026-05-18T11:55:00.000Z',
    source_signals: { logs: true, traces: true, metrics: true, deployments: false },
    latest_version: null,
    latest_deployment_id: null,
    request_count: 90,
    error_count: 0,
    log_count: 120,
    span_count: 90,
    metric_count: 30,
    deployment_count: 0,
    dependency_count: 1,
    avg_latency_ms: 40,
    p95_latency_ms: 90,
    health_status: 'healthy',
    updated_at: '2026-05-18T11:55:00.000Z',
  },
  {
    id: 'summary-3',
    service_name: 'search-service',
    environment: 'production',
    first_seen_at: '2026-05-18T11:00:00.000Z',
    last_seen_at: '2026-05-18T11:50:00.000Z',
    last_seen: '2026-05-18T11:50:00.000Z',
    source_signals: { logs: true, traces: true, metrics: true, deployments: false },
    latest_version: null,
    latest_deployment_id: null,
    request_count: 40,
    error_count: 1,
    log_count: 75,
    span_count: 40,
    metric_count: 18,
    deployment_count: 0,
    dependency_count: 2,
    avg_latency_ms: 120,
    p95_latency_ms: 260,
    health_status: 'warning',
    updated_at: '2026-05-18T11:50:00.000Z',
  },
];

describe('ServicesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiClient.mockResolvedValue({ data: mockServices });
  });

  it('renders service catalog filters and enriched service rows', async () => {
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
    expect(screen.getByText('v1.4.2')).toBeInTheDocument();
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

  it('filters services by backend health status', async () => {
    render(<ServicesPage />);

    await waitFor(() => {
      expect(screen.getByText('checkout-service')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText('Filter services by health'), {
      target: { value: 'degraded' },
    });

    expect(screen.getByText('checkout-service')).toBeInTheDocument();
    expect(screen.queryByText('auth-service')).not.toBeInTheDocument();
    expect(screen.queryByText('search-service')).not.toBeInTheDocument();
    expect(screen.getByText('1 of 3 services')).toBeInTheDocument();
  });
});
