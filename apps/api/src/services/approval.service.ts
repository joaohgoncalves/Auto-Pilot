import { RiskLevel, type Action, type Prisma } from '@prisma/client';
import { audit, auditWithTx } from '../lib/audit.js';
import { minApproverRoleForRisk } from '../middleware/authz.js';
import { prisma } from '../lib/prisma.js';
import { asRecord } from '../lib/utils.js';

export function approvalExpiresAt(riskLevel: RiskLevel) {
  if (riskLevel === RiskLevel.HIGH) return new Date(Date.now() + 24 * 60 * 60 * 1000);
  if (riskLevel === RiskLevel.CRITICAL) return new Date(Date.now() + 4 * 60 * 60 * 1000);
  return null;
}

export interface EnsureApprovalInput {
  action: Action;
  reason?: string;
  requestId?: string | null;
  actorUserId?: string | null;
}

export class ApprovalService {
  constructor(private readonly db: typeof prisma | Prisma.TransactionClient = prisma) {}

  async ensureApprovalRequest(input: EnsureApprovalInput) {
    const payload = asRecord(input.action.payload);
    const approval = await this.db.approvalRequest.upsert({
      where: { actionId: input.action.id },
      update: {},
      create: {
        tenantId: input.action.tenantId,
        actionId: input.action.id,
        title: input.action.title,
        reason: input.reason ?? input.action.approvalReason ?? String(payload.reason ?? 'Action requires human approval.'),
        minApproverRole: minApproverRoleForRisk(input.action.riskLevel),
        selfApprovalAllowed: false,
        requestedById: input.action.createdById,
        expiresAt: approvalExpiresAt(input.action.riskLevel)
      }
    });

    const auditPayload = {
      tenantId: input.action.tenantId,
      signalId: input.action.signalId,
      actor: 'policy-engine',
      actorUserId: input.actorUserId ?? undefined,
      event: 'approval.requested',
      message: `Approval requested for action ${input.action.id}.`,
      resourceType: 'approval',
      resourceId: approval.id,
      requestId: input.requestId ?? undefined,
      correlationId: input.action.correlationId ?? undefined,
      metadata: { actionId: input.action.id, minApproverRole: approval.minApproverRole, expiresAt: approval.expiresAt }
    };

    if ('$transaction' in this.db) await audit(auditPayload);
    else await auditWithTx(this.db, auditPayload);

    return approval;
  }
}

export async function ensureApprovalRequest(action: Action, options: { reason?: string; requestId?: string | null; actorUserId?: string | null } = {}) {
  return new ApprovalService().ensureApprovalRequest({ action, ...options });
}
