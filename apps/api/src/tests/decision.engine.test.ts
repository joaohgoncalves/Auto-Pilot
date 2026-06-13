import { describe, expect, it } from 'vitest';
import { decideActions } from '../engines/decision.engine.js';
import { evaluatePolicy } from '../engines/policy.engine.js';

describe('decision engine', () => {
  it('detects deployment regression and requires rollback approval action', () => {
    const result = decideActions('service.error_rate_spike', {
      serviceName: 'Payments API',
      errorRateBefore: 0.8,
      errorRateNow: 17.4,
      lastDeploymentMinutesAgo: 6,
      deploymentVersion: '2026.06.09-1842'
    });

    expect(result.diagnosis).toContain('Probable deployment regression');
    expect(result.actions.map((a) => a.type)).toContain('request_rollback_approval');
  });

  it('creates purchase recommendation for stockout risk', () => {
    const result = decideActions('inventory.stockout_risk', {
      productName: 'Coca-Cola 2L',
      currentStock: 6,
      dailySalesAverage: 22,
      supplierLeadTimeDays: 1,
      minimumDisplayStock: 8
    });

    expect(result.actions.map((a) => a.type)).toContain('create_purchase_recommendation');
  });
});

describe('policy engine', () => {
  it('requires approval for high-risk actions', () => {
    const decision = evaluatePolicy({ actionType: 'request_rollback_approval', riskLevel: 'HIGH', tenantPolicy: { autoExecuteMediumRisk: false } });
    expect(decision.mode).toBe('REQUIRE_APPROVAL');
  });
});
