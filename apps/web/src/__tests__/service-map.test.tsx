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
          id: 'production:checkout-service->payment-service:payment.chargeCard',
          environment: 'production',
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

  it('draws dependencies between nodes in the matching environment', async () => {
    mockApiClient.mockResolvedValueOnce({
      nodes: [
        {
          id: 'checkout-service',
          name: 'checkout-service',
          environment: 'production',
          health_status: 'healthy',
          request_count: 100,
          error_count: 1,
          avg_latency_ms: 120,
          p95_latency_ms: 220,
          last_seen_at: '2026-05-18T12:00:00.000Z',
          latest_version: 'v1.4.2',
          latest_deployment_id: 'deploy-1',
        },
        {
          id: 'checkout-service',
          name: 'checkout-service',
          environment: 'staging',
          health_status: 'warning',
          request_count: 50,
          error_count: 3,
          avg_latency_ms: 160,
          p95_latency_ms: 320,
          last_seen_at: '2026-05-18T12:00:00.000Z',
          latest_version: 'v1.4.3',
          latest_deployment_id: 'deploy-2',
        },
        {
          id: 'payment-service',
          name: 'payment-service',
          environment: 'production',
          health_status: 'healthy',
          request_count: 90,
          error_count: 1,
          avg_latency_ms: 140,
          p95_latency_ms: 250,
          last_seen_at: '2026-05-18T12:00:00.000Z',
          latest_version: null,
          latest_deployment_id: null,
        },
        {
          id: 'payment-service',
          name: 'payment-service',
          environment: 'staging',
          health_status: 'warning',
          request_count: 40,
          error_count: 2,
          avg_latency_ms: 190,
          p95_latency_ms: 360,
          last_seen_at: '2026-05-18T12:00:00.000Z',
          latest_version: null,
          latest_deployment_id: null,
        },
      ],
      edges: [
        {
          id: 'production:checkout-service->payment-service:payment.chargeCard',
          environment: 'production',
          source: 'checkout-service',
          target: 'payment-service',
          operation_name: 'payment.chargeCard',
          call_count: 90,
          error_count: 1,
          avg_duration_ms: 140,
          p95_duration_ms: 250,
          last_seen_at: '2026-05-18T12:00:00.000Z',
          example_trace_id: 'trace-123',
        },
      ],
    });

    const { container } = render(<ServiceMapPage />);

    await waitFor(() => {
      expect(screen.getAllByText('checkout-service')).toHaveLength(2);
    });

    const line = container.querySelector('svg line');
    expect(Number(line?.getAttribute('y1'))).toBeCloseTo(620 / 3, 1);
    expect(Number(line?.getAttribute('y2'))).toBeCloseTo(620 / 3, 1);
  });
});
