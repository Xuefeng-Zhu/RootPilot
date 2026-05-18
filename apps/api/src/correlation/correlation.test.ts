import { describe, expect, it } from 'vitest';
import { createErrorFingerprint, normalizeErrorMessage } from './fingerprint.js';
import { calculateHealthStatus, riskLevelFromImpact } from './health.js';

describe('correlation health and impact helpers', () => {
  it('calculates deterministic service health statuses', () => {
    const now = new Date('2026-05-18T12:00:00.000Z');

    expect(
      calculateHealthStatus({
        requestCount: 100,
        errorCount: 0,
        p95LatencyMs: 120,
        lastSeenAt: now,
        now,
      }),
    ).toBe('healthy');

    expect(
      calculateHealthStatus({
        requestCount: 100,
        errorCount: 4,
        p95LatencyMs: 220,
        lastSeenAt: now,
        now,
      }),
    ).toBe('warning');

    expect(
      calculateHealthStatus({
        requestCount: 100,
        errorCount: 18,
        p95LatencyMs: 950,
        lastSeenAt: now,
        now,
      }),
    ).toBe('degraded');
  });

  it('normalizes dynamic identifiers in error messages', () => {
    expect(
      normalizeErrorMessage(
        'PaymentProviderTimeout: user_123 request req_abc failed at 2026-05-18T12:00:00Z after 500ms trace 4f9a6e1c2b3d4a5f',
      ),
    ).toBe(
      'paymentprovidertimeout: <id> request <id> failed at <timestamp> after <number>ms trace <hex>',
    );
  });

  it('groups similar dynamic errors into the same fingerprint', () => {
    const first = createErrorFingerprint({
      tenantId: 'tenant-1',
      projectId: 'project-1',
      serviceName: 'checkout-service',
      route: '/api/checkout',
      errorType: 'PaymentProviderTimeout',
      message: 'PaymentProviderTimeout: timeout exceeded after 500ms for user_123',
    });
    const second = createErrorFingerprint({
      tenantId: 'tenant-1',
      projectId: 'project-1',
      serviceName: 'checkout-service',
      route: '/api/checkout',
      errorType: 'PaymentProviderTimeout',
      message: 'PaymentProviderTimeout: timeout exceeded after 900ms for user_999',
    });

    expect(first.fingerprint).toBe(second.fingerprint);
    expect(first.id).toBe(second.id);
  });

  it('keeps different error types in different groups', () => {
    const timeout = createErrorFingerprint({
      tenantId: 'tenant-1',
      projectId: 'project-1',
      serviceName: 'checkout-service',
      route: '/api/checkout',
      errorType: 'PaymentProviderTimeout',
      message: 'Payment provider failed for user_123',
    });
    const inventory = createErrorFingerprint({
      tenantId: 'tenant-1',
      projectId: 'project-1',
      serviceName: 'checkout-service',
      route: '/api/checkout',
      errorType: 'InventoryReservationError',
      message: 'Payment provider failed for user_123',
    });

    expect(timeout.fingerprint).not.toBe(inventory.fingerprint);
  });

  it('calculates high deployment risk for bad deployment patterns', () => {
    expect(
      riskLevelFromImpact({
        errorCountBefore: 4,
        errorCountAfter: 87,
        p95LatencyBeforeMs: 210,
        p95LatencyAfterMs: 942,
        newErrorGroupsCount: 2,
      }),
    ).toBe('high');
  });
});
