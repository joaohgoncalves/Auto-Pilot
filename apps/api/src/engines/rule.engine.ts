import { z } from 'zod';
import type { Prisma, Rule } from '@prisma/client';
import type { PlannedAction, RiskLevel } from '@autopilotops/shared';
import { prisma } from '../lib/prisma.js';
import { ruleEngineService } from '../services/rule-engine.service.js';
import type { CorrelationResult } from './correlation.engine.js';
import { matchesConditions } from './condition.engine.js';

export const ruleActionSchema = z.object({
  type: z.string().min(1),
  title: z.string().min(1).optional(),
  riskLevel: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  payload: z.record(z.unknown()).optional()
});

export const ruleActionsSchema = z.array(ruleActionSchema).min(1);

function defaultTitle(actionType: string, payload: Record<string, unknown>, correlation: CorrelationResult) {
  const name = String(payload.serviceName ?? payload.productName ?? payload.entityId ?? 'resource');
  const titles: Record<string, string> = {
    create_incident: `Create incident for ${name}`,
    request_rollback_approval: `Request rollback approval for ${name}`,
    create_purchase_recommendation: `Create purchase recommendation for ${name}`,
    create_discount_recommendation: `Create discount recommendation for ${name}`,
    create_operational_task: `Create operational task for ${name}`,
    notify_oncall: `Notify on-call for ${name}`,
    notify_manager: `Notify manager for ${name}`,
    schedule_recovery_check: `Schedule recovery check for ${name}`,
    schedule_followup_check: `Schedule follow-up check for ${name}`
  };
  return titles[actionType] ?? `Execute ${actionType}: ${correlation.diagnosis}`;
}

function materializePayload(actionType: string, explicitPayload: Record<string, unknown>, signalPayload: Record<string, unknown>, correlation: CorrelationResult) {
  if (actionType === 'create_operational_task') {
    return {
      title: explicitPayload.title ?? `Review ${String(signalPayload.productName ?? signalPayload.serviceName ?? 'signal')}`,
      description: explicitPayload.description ?? correlation.diagnosis,
      assignee: explicitPayload.assignee ?? (signalPayload.productName ? 'stock-manager' : 'ops-team'),
      dueInHours: explicitPayload.dueInHours ?? 4,
      ...signalPayload,
      ...correlation.context,
      ...explicitPayload
    };
  }

  if (actionType === 'request_rollback_approval') {
    return {
      ...signalPayload,
      ...correlation.context,
      reason: explicitPayload.reason ?? correlation.diagnosis,
      recommendedFix: explicitPayload.recommendedFix ?? correlation.context.recommendedFix,
      ...explicitPayload
    };
  }

  return { ...signalPayload, ...correlation.context, ...explicitPayload };
}

export async function evaluateRulesForSignal(input: {
  tenantId: string;
  signalId: string;
  type: string;
  payload: Record<string, unknown>;
  correlation: CorrelationResult;
  tx?: Prisma.TransactionClient;
}) {
  const db = input.tx ?? prisma;
  const rules = input.tx
    ? await db.rule.findMany({
      where: { tenantId: input.tenantId, triggerType: input.type, isActive: true },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }]
    })
    : await ruleEngineService.listActiveRules(input.tenantId, input.type);

  const matchedRules: Rule[] = [];
  const plannedActions: PlannedAction[] = [];

  for (const rule of rules) {
    const matched = matchesConditions(rule.conditions, input.payload, input.correlation);
    await db.ruleExecution.upsert({
      where: { tenantId_ruleId_signalId: { tenantId: input.tenantId, ruleId: rule.id, signalId: input.signalId } },
      update: { matched },
      create: { tenantId: input.tenantId, ruleId: rule.id, signalId: input.signalId, matched }
    });

    if (!matched) continue;
    matchedRules.push(rule);

    const actions = ruleActionsSchema.safeParse(rule.actions);
    if (!actions.success) continue;

    for (const action of actions.data) {
      plannedActions.push({
        type: action.type,
        title: action.title ?? defaultTitle(action.type, input.payload, input.correlation),
        riskLevel: action.riskLevel as RiskLevel,
        payload: materializePayload(action.type, action.payload ?? {}, input.payload, input.correlation),
        ruleId: rule.id,
        ruleName: rule.name,
        priority: rule.priority
      });
    }
  }

  return { matchedRules, plannedActions };
}
