import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AppShell } from '../components/app-shell';

vi.mock('next/navigation', () => ({
  usePathname: () => '/metrics',
}));

describe('AppShell', () => {
  it('renders the RootPilot shell, primary navigation, and active route', () => {
    render(
      <AppShell>
        <div>Metrics content</div>
      </AppShell>,
    );

    expect(screen.getByText('RootPilot')).toBeInTheDocument();
    expect(screen.getByLabelText('Primary navigation')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /metrics/i })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByLabelText('Search telemetry')).toBeInTheDocument();
    expect(screen.getByLabelText('Global time range')).toBeInTheDocument();
    expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    expect(screen.getByText('Metrics content')).toBeInTheDocument();
  });
});
