import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ServiceMapPage from '../app/service-map/page';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('../lib/api', () => ({
  apiClient: vi.fn(),
}));

import { apiClient } from '../lib/api';

const mockApiClient = vi.mocked(apiClient);

describe('ServiceMapPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiClient.mockResolvedValue({
      nodes: [
        {
          id: 'checkout-service',
          name: 'checkout-service',
          environment: 'production',
          health_status: 'degraded',
          request_count: 100,
          error_count: 12,
          avg_latency_ms: 182,
          p95_latency_ms: 842,
          last_seen_at: '2026-05-18T12:00:00.000Z',
          latest_version: 'v1.4.2',
          latest_deployment_id: 'deploy-1',
        },
        {
          id: 'payment-service',
          name: 'payment-service',
          environment: 'production',
          health_status: 'warning',
          request_count: 90,
          error_count: 10,
          avg_latency_ms: 214,
          p95_latency_ms: 931,
          last_seen_at: '2026-05-18T12:00:00.000Z',
          latest_version: null,
          latest_deployment_id: null,
        },
      ],
      edges: [
        {
          id: 'checkout-service->payment-service:payment.chargeCard',
          source: 'checkout-service',
          target: 'payment-service',
          operation_name: 'payment.chargeCard',
          call_count: 90,
          error_count: 10,
          avg_duration_ms: 214,
          p95_duration_ms: 931,
          last_seen_at: '2026-05-18T12:00:00.000Z',
          example_trace_id: 'trace-123',
        },
      ],
    });
  });

  it('renders service graph nodes, filters, and dependency count', async () => {
    render(<ServiceMapPage />);

    await waitFor(() => {
      expect(screen.getByText('checkout-service')).toBeInTheDocument();
    });

    expect(screen.getByLabelText('Filter service map by environment')).toBeInTheDocument();
    expect(screen.getByLabelText('Filter service map by time range')).toBeInTheDocument();
    expect(screen.getByText('2 services, 1 dependencies')).toBeInTheDocument();
    expect(screen.getByText('payment-service')).toBeInTheDocument();
  });
});
