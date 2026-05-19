import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import ErrorGroupDetailPage from '../app/error-groups/[id]/page';

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'fingerprint-123' }),
}));

vi.mock('recharts', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const React = require('react');
  const passthrough =
    (name: string) =>
    ({ children }: { children?: React.ReactNode; [key: string]: unknown }) =>
      React.createElement('div', { 'data-recharts': name }, children);
  return {
    ResponsiveContainer: passthrough('ResponsiveContainer'),
    LineChart: passthrough('LineChart'),
    Line: passthrough('Line'),
    CartesianGrid: passthrough('CartesianGrid'),
    Tooltip: passthrough('Tooltip'),
    XAxis: passthrough('XAxis'),
    YAxis: passthrough('YAxis'),
  };
});

vi.mock('../lib/api', () => ({
  apiClient: vi.fn(),
}));

import { apiClient } from '../lib/api';

const mockApiClient = vi.mocked(apiClient);

describe('ErrorGroupDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiClient.mockImplementation(async (path: string) => {
      if (path === '/v1/error-groups/fingerprint-123') {
        return {
          data: {
            fingerprint: 'fingerprint-123',
            normalized_message: 'Payment authorization failed',
            example_message: 'Payment authorization failed: timeout',
            error_type: 'TimeoutError',
            service_name: 'checkout-service',
            environment: 'production',
            severity: 'ERROR',
            count: 42,
            affected_traces_count: 12,
            first_seen_at: '2026-05-18T12:00:00.000Z',
            last_seen_at: '2026-05-18T12:30:00.000Z',
            example_trace_id: 'trace-123',
          },
        };
      }
      if (path === '/v1/logs') {
        return {
          data: [
            {
              id: 'log-1',
              timestamp: '2026-05-18T12:30:00.000Z',
              received_at: '2026-05-18T12:30:00.100Z',
              tenant_id: 'tenant-1',
              project_id: 'project-1',
              service_name: 'checkout-service',
              environment: 'production',
              source: 'otel',
              severity: 'ERROR',
              message: 'Payment authorization failed: timeout',
              trace_id: 'trace-123',
              span_id: 'span-1',
              fingerprint: 'fingerprint-123',
              resource_attributes: {},
              attributes: {},
            },
          ],
        };
      }
      return { data: [] };
    });
  });

  it('renders the grouped error summary, related trace link, and logs', async () => {
    render(<ErrorGroupDetailPage />);

    await waitFor(() => {
      expect(screen.getByText('TimeoutError')).toBeInTheDocument();
    });

    expect(screen.getByText('Payment authorization failed')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('checkout-service')).toBeInTheDocument();
    expect(screen.getByText('Open example trace')).toHaveAttribute('href', '/traces/trace-123');
    expect(screen.getAllByText('Payment authorization failed: timeout').length).toBeGreaterThan(0);
    expect(screen.getByText('Open trace')).toHaveAttribute('href', '/traces/trace-123');
  });
});
