import { ActionStatus, RiskLevel, Severity, type Action } from '@prisma/client';
import { audit } from '../lib/audit.js';
import { prisma } from '../lib/prisma.js';
import { asRecord, toNumber } from '../lib/utils.js';
import type { ActionWithSignal, ActionWorkerOptions } from './action.types.js';
import { notificationService } from './notification.service.js';
import { resolveActionProvider } from '../providers/action-provider.registry.js';

export class UnknownActionTypeError extends Error {
  constructor(actionType: string) {
    super(`Unknown action type: ${actionType}`);
    this.name = 'UnknownActionTypeError';
  }
}

export async function markExecuted(action: Action) {
  return prisma.action.update({
    where: { id: action.id },
    data: {
      status: ActionStatus.EXECUTED,
      executedAt: new Date(),
      errorMessage: null,
      errorCode: null,
      lastError: null,
      lockedAt: null,
      lockedBy: null,
      heartbeatAt: null,
      lockExpiresAt: null
    }
  });
}

export class ActionSideEffectsService {
  async execute(action: ActionWithSignal, options: ActionWorkerOptions = {}) {
    const payload = asRecord(action.payload);
    const signal = action.signal;
    const provider = resolveActionProvider(action);

    if (provider) {
      const result = await provider.execute({ action, signal, ...options });
      await audit({
        tenantId: action.tenantId,
        signalId: signal?.id,
        actor: options.actor ?? 'action-provider',
        event: 'action.provider_executed',
        message: `Action ${action.id} executed by ${result.provider}.`,
        resourceType: 'action',
        resourceId: action.id,
        requestId: options.requestId,
        correlationId: action.correlationId,
        metadata: {
          provider: result.provider,
          externalId: result.externalId,
          statusCode: result.statusCode,
          message: result.message,
          ...result.metadata
        }
      });
      return;
    }

    if (action.type === 'create_incident') {
      const incident = await prisma.incident.upsert({
        where: { actionId: action.id },
        update: {},
        create: {
          tenantId: action.tenantId,
          signalId: signal?.id,
          actionId: action.id,
          title: `P1 Incident: ${String(payload.serviceName ?? 'Unknown service')}`,
          serviceName: String(payload.serviceName ?? 'Unknown service'),
          severity: action.riskLevel === RiskLevel.CRITICAL ? Severity.CRITICAL : Severity.HIGH,
          probableCause: String(payload.probableCause ?? payload.reason ?? 'Unknown cause'),
          recommendedFix: String(payload.recommendedFix ?? 'Run diagnostics')
        }
      });
      await audit({
        tenantId: action.tenantId,
        signalId: signal?.id,
        actor: options.actor ?? 'action-engine',
        event: 'incident.created',
        message: `Incident ${incident.id} created by action ${action.id}.`,
        resourceType: 'incident',
        resourceId: incident.id,
        requestId: options.requestId,
        correlationId: action.correlationId,
        metadata: { incidentId: incident.id, actionId: action.id }
      });
      return;
    }

    if (action.type === 'create_purchase_recommendation') {
      const recommendation = await prisma.purchaseRecommendation.upsert({
        where: { actionId: action.id },
        update: {},
        create: {
          tenantId: action.tenantId,
          signalId: signal?.id,
          actionId: action.id,
          productSku: String(signal?.entityId ?? payload.productSku ?? 'UNKNOWN'),
          productName: String(payload.productName ?? 'Unknown product'),
          currentStock: toNumber(payload.currentStock),
          dailySalesAverage: toNumber(payload.dailySalesAverage),
          supplierLeadTimeDays: toNumber(payload.supplierLeadTimeDays, 1),
          suggestedQuantity: Math.ceil(toNumber(payload.suggestedQuantity, 1)),
          riskLevel: action.riskLevel,
          supplierName: payload.supplierName ? String(payload.supplierName) : payload.primarySupplier ? String(payload.primarySupplier) : null
        }
      });
      await audit({
        tenantId: action.tenantId,
        signalId: signal?.id,
        actor: options.actor ?? 'action-engine',
        event: 'purchase_recommendation.created',
        message: `Purchase recommendation ${recommendation.id} created.`,
        resourceType: 'purchase_recommendation',
        resourceId: recommendation.id,
        requestId: options.requestId,
        correlationId: action.correlationId,
        metadata: { recommendationId: recommendation.id, actionId: action.id }
      });
      return;
    }

    if (action.type === 'create_discount_recommendation' || action.type === 'create_operational_task') {
      const dueInHours = toNumber(payload.dueInHours, action.type === 'create_discount_recommendation' ? 2 : 8);
      const task = await prisma.operationalTask.upsert({
        where: { actionId: action.id },
        update: {},
        create: {
          tenantId: action.tenantId,
          signalId: signal?.id,
          actionId: action.id,
          title: action.type === 'create_discount_recommendation'
            ? `Apply ${String(payload.suggestedDiscountPercent ?? 15)}% discount: ${String(payload.productName ?? 'Product')}`
            : String(payload.title ?? action.title),
          description: action.type === 'create_discount_recommendation'
            ? `Discount recommended to reduce expiration loss. Expected leftover: ${String(payload.expectedLeftover ?? 0)} units.`
            : String(payload.description ?? 'Operational follow-up required.'),
          assignee: payload.assignee ? String(payload.assignee) : null,
          dueAt: new Date(Date.now() + dueInHours * 60 * 60 * 1000)
        }
      });
      await audit({
        tenantId: action.tenantId,
        signalId: signal?.id,
        actor: options.actor ?? 'action-engine',
        event: 'task.created',
        message: `Operational task ${task.id} created.`,
        resourceType: 'task',
        resourceId: task.id,
        requestId: options.requestId,
        correlationId: action.correlationId,
        metadata: { taskId: task.id, actionId: action.id }
      });
      return;
    }

    if (action.type === 'notify_oncall' || action.type === 'notify_manager') {
      const channel = String(payload.channel ?? 'simulated');
      const recipient = String(payload.recipient ?? (action.type === 'notify_oncall' ? 'oncall' : 'manager'));
      const delivery = await notificationService.simulateDelivery({ tenantId: action.tenantId, actionId: action.id, channel, recipient, payload });
      await audit({
        tenantId: action.tenantId,
        signalId: signal?.id,
        actor: 'notification-worker',
        event: 'notification.simulated',
        message: `Notification simulated for action ${action.id}.`,
        resourceType: 'notification_delivery',
        resourceId: delivery.id,
        requestId: options.requestId,
        correlationId: action.correlationId,
        metadata: payload
      });
      return;
    }

    if (action.type === 'schedule_recovery_check' || action.type === 'schedule_followup_check') {
      await audit({
        tenantId: action.tenantId,
        signalId: signal?.id,
        actor: 'recovery-engine',
        event: 'recovery_check.scheduled',
        message: `Recovery/follow-up check scheduled for action ${action.id}.`,
        resourceType: 'action',
        resourceId: action.id,
        requestId: options.requestId,
        correlationId: action.correlationId,
        metadata: payload
      });
      return;
    }

    if (action.type === 'request_rollback_approval') {
      await audit({
        tenantId: action.tenantId,
        signalId: signal?.id,
        actor: options.actor ?? 'action-engine',
        event: 'rollback.simulated',
        message: `Approved rollback action ${action.id} was simulated safely. No external deploy system is integrated.`,
        resourceType: 'action',
        resourceId: action.id,
        requestId: options.requestId,
        correlationId: action.correlationId,
        metadata: payload
      });
      return;
    }

    throw new UnknownActionTypeError(action.type);
  }
}
