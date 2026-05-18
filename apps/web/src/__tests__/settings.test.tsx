import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import SettingsPage from '../app/settings/page';

// Mock clipboard API
Object.assign(navigator, {
  clipboard: {
    writeText: vi.fn().mockResolvedValue(undefined),
  },
});

describe('SettingsPage', () => {
  it('renders settings heading', () => {
    render(<SettingsPage />);
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  it('displays masked API key with only prefix visible', () => {
    render(<SettingsPage />);

    // The masked key should show the first 8 chars followed by bullets
    const maskedKeyElement = screen.getByText(/rootpilo•+/);
    expect(maskedKeyElement).toBeInTheDocument();

    // Full key should NOT be visible in the text
    expect(screen.queryByText('rootpilot_demo_key')).not.toBeInTheDocument();
  });

  it('renders copy button for API key', () => {
    render(<SettingsPage />);

    const copyButtons = screen.getAllByRole('button', { name: /copy/i });
    // At least one copy button for the API key
    expect(copyButtons.length).toBeGreaterThanOrEqual(1);
  });

  it('renders curl commands for all telemetry types', () => {
    render(<SettingsPage />);

    // Section headers for curl commands
    expect(screen.getByText('Log Ingestion')).toBeInTheDocument();
    expect(screen.getByText('Trace Ingestion')).toBeInTheDocument();
    expect(screen.getByText('Metric Ingestion')).toBeInTheDocument();
    expect(screen.getByText('Deployment Event')).toBeInTheDocument();
  });

  it('curl commands include API key, method, and endpoint', () => {
    const { container } = render(<SettingsPage />);

    // Check that curl commands contain the expected elements
    const preElements = container.querySelectorAll('pre');
    expect(preElements.length).toBe(4); // One for each telemetry type

    const allCommandsText = Array.from(preElements).map((el) => el.textContent).join('\n');

    // Each command should contain the API key
    expect(allCommandsText).toContain('X-API-Key: rootpilot_demo_key');

    // Each command should target localhost:4000
    expect(allCommandsText).toContain('http://localhost:4000/v1/ingest/logs');
    expect(allCommandsText).toContain('http://localhost:4000/v1/ingest/traces');
    expect(allCommandsText).toContain('http://localhost:4000/v1/ingest/metrics');
    expect(allCommandsText).toContain('http://localhost:4000/v1/events/deployments');

    // All use POST method
    expect(allCommandsText).toContain('curl -X POST');

    // All have Content-Type header
    expect(allCommandsText).toContain('Content-Type: application/json');
  });

  it('renders Quick Start Commands section heading', () => {
    render(<SettingsPage />);
    expect(screen.getByText('Quick Start Commands')).toBeInTheDocument();
  });
});
