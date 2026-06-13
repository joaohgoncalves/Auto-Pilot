import type { RiskLevel } from '@autopilotops/shared';

export interface PolicyInput {
  riskLevel: RiskLevel;
  actionType: string;
  tenantPolicy: {
    autoExecuteMediumRisk: boolean;
  };
}

export interface PolicyDecision {
  mode: 'EXECUTE' | 'REQUIRE_APPROVAL' | 'RECOMMEND_ONLY';
  reason: string;
}

export function evaluatePolicy(input: PolicyInput): PolicyDecision {
  if (input.riskLevel === 'LOW') {
    return { mode: 'EXECUTE', reason: 'Low-risk actions are safe to execute automatically.' };
  }

  if (input.riskLevel === 'MEDIUM') {
    if (input.tenantPolicy.autoExecuteMediumRisk) {
      return { mode: 'EXECUTE', reason: 'Tenant policy allows automatic execution of medium-risk actions.' };
    }
    return { mode: 'REQUIRE_APPROVAL', reason: 'Medium-risk action requires approval by tenant policy.' };
  }

  if (input.riskLevel === 'HIGH') {
    return { mode: 'REQUIRE_APPROVAL', reason: 'High-risk actions require human approval.' };
  }

  return { mode: 'RECOMMEND_ONLY', reason: 'Critical-risk actions are recommendation-only by default.' };
}
