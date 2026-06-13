import type { PlannedAction } from '@autopilotops/shared';
import { correlateSignal } from './correlation.engine.js';

export interface DecisionResult {
  diagnosis: string;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  actions: PlannedAction[];
}

export function decideActions(type: string, payload: Record<string, unknown>): DecisionResult {
  const correlation = correlateSignal(type, payload);
  const actions: PlannedAction[] = [];

  if (type === 'service.error_rate_spike') {
    const serviceName = String(payload.serviceName ?? 'Unknown service');
    actions.push({
      type: 'create_incident',
      title: `Create incident for ${serviceName}`,
      riskLevel: 'LOW',
      payload: { serviceName, probableCause: correlation.diagnosis, recommendedFix: correlation.context.recommendedFix }
    });

    if (correlation.context.isRegression) {
      actions.push({
        type: 'request_rollback_approval',
        title: `Request rollback approval for ${serviceName}`,
        riskLevel: 'HIGH',
        payload: {
          serviceName,
          deploymentVersion: payload.deploymentVersion,
          reason: correlation.diagnosis,
          recommendedFix: correlation.context.recommendedFix
        }
      });
    }

    actions.push({
      type: 'notify_oncall',
      title: `Notify on-call for ${serviceName}`,
      riskLevel: 'LOW',
      payload: { serviceName, channel: 'webhook', message: correlation.diagnosis }
    });

    actions.push({
      type: 'schedule_recovery_check',
      title: `Schedule recovery check for ${serviceName}`,
      riskLevel: 'LOW',
      payload: { serviceName, delayMinutes: 5 }
    });
  }

  if (type === 'inventory.stockout_risk') {
    const productName = String(payload.productName ?? 'Unknown product');
    actions.push({
      type: 'create_purchase_recommendation',
      title: `Create purchase recommendation for ${productName}`,
      riskLevel: 'LOW',
      payload: { ...payload, ...correlation.context }
    });
    actions.push({
      type: 'create_operational_task',
      title: `Assign stock replenishment task for ${productName}`,
      riskLevel: 'LOW',
      payload: {
        title: `Replenish ${productName}`,
        description: correlation.diagnosis,
        assignee: 'stock-manager',
        dueInHours: 4
      }
    });
    actions.push({
      type: 'notify_manager',
      title: `Notify manager about ${productName}`,
      riskLevel: 'LOW',
      payload: { message: correlation.diagnosis }
    });
  }

  if (type === 'inventory.expiring_stock') {
    const productName = String(payload.productName ?? 'Unknown product');
    actions.push({
      type: 'create_discount_recommendation',
      title: `Create discount recommendation for ${productName}`,
      riskLevel: 'MEDIUM',
      payload: { ...payload, ...correlation.context }
    });
    actions.push({
      type: 'create_operational_task',
      title: `Assign expiration prevention task for ${productName}`,
      riskLevel: 'LOW',
      payload: {
        title: `Promote expiring stock: ${productName}`,
        description: correlation.diagnosis,
        assignee: 'store-operator',
        dueInHours: 2
      }
    });
  }

  if (actions.length === 0) {
    actions.push({
      type: 'create_operational_task',
      title: `Review signal ${type}`,
      riskLevel: correlation.riskLevel,
      payload: { title: `Review signal ${type}`, description: correlation.diagnosis }
    });
  }

  return {
    diagnosis: correlation.diagnosis,
    riskLevel: correlation.riskLevel,
    actions
  };
}
