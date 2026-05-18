import { render, screen, waitFor, fireEvent } from '@testing-library/react';
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

const mockLogs = [
  { id: 'log1', tenant_id: 't1', project_id: 'p1', timestamp: '2024-01-01T12:00:00Z', received_at: '2024-01-01T12:00:01Z', service_name: 'auth-service', environment: 'production', source: '', resource_attributes: {}, attributes: {}, severity: 'ERROR', message: 'Connection failed', trace_id: '', span_id: '', fingerprint: '' },
  { id: 'log2', tenant_id: 't1', project_id: 'p1', timestamp: '2024-01-01T11:55:00Z', received_at: '2024-01-01T11:55:01Z', service_name: 'api-gateway', environment: 'staging', source: '', resource_attributes: {}, attributes: {}, severity: 'INFO', message: 'Request processed', trace_id: '', span_id: '', fingerprint: '' },
];

describe('LogsExplorerPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    expect(screen.getByText('1h')).toBeInTheDocument();
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
      ([path]) => path === '/v1/logs'
    ).length;

    // Click 24h time range
    fireEvent.click(screen.getByText('24h'));

    // New API call should be made with updated time range
    await waitFor(() => {
      const newCallCount = mockApiClient.mock.calls.filter(
        ([path]) => path === '/v1/logs'
      ).length;
      expect(newCallCount).toBeGreaterThan(initialCallCount);
    });
  });

  it('triggers API call with service filter when service is selected', async () => {
    mockApiClient.mockImplementation(async (path: string) => {
      if (path === '/v1/services') {
        return { data: [{ service_name: 'auth-service', environment: 'production' }, { service_name: 'api-gateway', environment: 'staging' }] };
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
});
