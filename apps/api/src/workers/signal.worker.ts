import { Worker } from 'bullmq';
import { ActionStatus, type Prisma, SignalStatus } from '@prisma/client';
import { env } from '../config/env.js';
import { bullConnection } from '../lib/bullmq.js';
import { prisma } from '../lib/prisma.js';
import { audit, auditWithTx } from '../lib/audit.js';
import { decideActions } from '../engines/decision.engine.js';
import { evaluatePolicy } from '../engines/policy.engine.js';
import { correlateSignal } from '../engines/correlation.engine.js';
import { evaluateRulesForSignal } from '../engines/rule.engine.js';
import { createOutboxEvent, OUTBOX_TYPES } from '../lib/outbox.js';
import { minApproverRoleForRisk } from '../middleware/authz.js';

function payloadAsObject(payload: Prisma.JsonValue): Record<string, unknown> {
  return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
}

function approvalExpiresAt(riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL') {
  if (riskLevel === 'HIGH') return new Date(Date.now() + 24 * 60 * 60 * 1000);
  if (riskLevel === 'CRITICAL') return new Date(Date.now() + 4 * 60 * 60 * 1000);
  return null;
}

async function markSignalFailed(input: {
  signalId: string;
  tenantId: string;
  requestId?: string | null;
  correlationId?: string | null;
  jobId?: string;
  attemptsMade?: number;
  message: string;
}) {
  await prisma.$transaction(async (tx) => {
    await tx.signal.update({
      where: { id: input.signalId },
      data: { status: SignalStatus.FAILED, failedAt: new Date(), failureReason: input.message }
    });
    await auditWithTx(tx, {
      tenantId: input.tenantId,
      signalId: input.signalId,
      actor: 'signal-worker',
      event: 'signal.processing_failed',
      message: input.message,
      requestId: input.requestId ?? undefined,
      correlationId: input.correlationId ?? undefined,
      metadata: { jobId: input.jobId, attemptsMade: input.attemptsMade }
    });
  });
}

export function startSignalWorker() {
  const worker = new Worker(
    'signal-processing',
    async (job) => {
      const { signalId } = job.data as { signalId: string };
      const workerId = `signal-worker:${process.pid}`;
      const signal = await prisma.signal.findUnique({
        where: { id: signalId },
        include: { tenant: true }
      });

      if (!signal) return;
      if (signal.status === SignalStatus.PROCESSED) {
        await audit({
          tenantId: signal.tenantId,
          signalId: signal.id,
          actor: 'signal-worker',
          event: 'signal.processing_skipped',
          message: `Signal ${signal.id} was already processed.`,
          requestId: signal.requestId,
          correlationId: signal.correlationId
        });
        return;
      }

      const claimed = await prisma.signal.updateMany({
        where: { id: signal.id, status: { not: SignalStatus.PROCESSED } },
        data: { status: SignalStatus.PROCESSING, failureReason: null, failedAt: null }
      });
      if (claimed.count !== 1) return;

      await audit({
        tenantId: signal.tenantId,
        signalId: signal.id,
        actor: 'signal-worker',
        event: 'signal.processing_started',
        message: `Started processing signal ${signal.id}.`,
        requestId: signal.requestId,
        correlationId: signal.correlationId,
        metadata: { workerId }
      });

      try {
        await prisma.$transaction(async (tx) => {
          const current = await tx.signal.findUnique({ where: { id: signal.id }, include: { tenant: true } });
          if (!current) return;
          if (current.status === SignalStatus.PROCESSED) return;

          const payload = payloadAsObject(current.payload);
          const correlation = correlateSignal(current.type, payload);
          const ruleDecision = await evaluateRulesForSignal({
            tenantId: current.tenantId,
            signalId: current.id,
            type: current.type,
            payload,
            correlation,
            tx
          });
          const fallbackDecision = ruleDecision.plannedActions.length === 0 ? decideActions(current.type, payload) : null;
          const plannedActions = ruleDecision.plannedActions.length > 0 ? ruleDecision.plannedActions : fallbackDecision?.actions ?? [];
          const diagnosis = correlation.diagnosis;
          const riskLevel = correlation.riskLevel;

          await tx.signal.update({
            where: { id: current.id },
            data: { diagnosis, riskLevel }
          });

          await auditWithTx(tx, {
            tenantId: current.tenantId,
            signalId: current.id,
            actor: 'decision-engine',
            event: 'decision.created',
            message: diagnosis,
            requestId: current.requestId,
            correlationId: current.correlationId,
            metadata: {
              workerId,
              riskLevel,
              matchedRules: ruleDecision.matchedRules.map((rule) => rule.name),
              fallbackUsed: ruleDecision.plannedActions.length === 0,
              actions: plannedActions.map((action) => action.type)
            }
          });

          for (const plannedAction of plannedActions) {
            const policy = evaluatePolicy({
              actionType: plannedAction.type,
              riskLevel: plannedAction.riskLevel,
              tenantPolicy: { autoExecuteMediumRisk: current.tenant.autoExecuteMediumRisk }
            });

            const dedupeKey = `${current.id}:${plannedAction.ruleId ?? 'fallback'}:${plannedAction.type}`;
            const action = await tx.action.upsert({
              where: { tenantId_dedupeKey: { tenantId: current.tenantId, dedupeKey } },
              update: {},
              create: {
                tenantId: current.tenantId,
                signalId: current.id,
                ruleId: plannedAction.ruleId,
                type: plannedAction.type,
                title: plannedAction.title,
                riskLevel: plannedAction.riskLevel,
                status: policy.mode === 'EXECUTE' ? ActionStatus.PENDING : policy.mode === 'REQUIRE_APPROVAL' ? ActionStatus.WAITING_APPROVAL : ActionStatus.SKIPPED,
                requiresApproval: policy.mode === 'REQUIRE_APPROVAL',
                approvalReason: policy.reason,
                dedupeKey,
                payload: plannedAction.payload as Prisma.InputJsonValue,
                maxAttempts: env.ACTION_MAX_ATTEMPTS,
                createdById: current.createdById,
                requestId: current.requestId,
                correlationId: current.correlationId
              }
            });

            await auditWithTx(tx, {
              tenantId: current.tenantId,
              signalId: current.id,
              actor: 'policy-engine',
              actorUserId: current.createdById,
              event: 'policy.evaluated',
              message: `${plannedAction.type}: ${policy.reason}`,
              resourceType: 'action',
              resourceId: action.id,
              requestId: current.requestId,
              correlationId: current.correlationId,
              metadata: { actionId: action.id, mode: policy.mode, ruleId: plannedAction.ruleId }
            });

            if (action.status === ActionStatus.PENDING) {
              await createOutboxEvent(tx, {
                tenantId: current.tenantId,
                type: OUTBOX_TYPES.EXECUTE_ACTION,
                payload: { actionId: action.id, reason: 'signal-policy' },
                dedupeKey: `action.execute:${action.id}:signal-policy`,
                requestId: current.requestId,
                correlationId: current.correlationId
              });
            } else if (action.status === ActionStatus.WAITING_APPROVAL) {
              const approval = await tx.approvalRequest.upsert({
                where: { actionId: action.id },
                update: {},
                create: {
                  tenantId: action.tenantId,
                  actionId: action.id,
                  title: action.title,
                  reason: policy.reason,
                  minApproverRole: minApproverRoleForRisk(action.riskLevel),
                  selfApprovalAllowed: false,
                  requestedById: action.createdById,
                  expiresAt: approvalExpiresAt(action.riskLevel)
                }
              });

              await auditWithTx(tx, {
                tenantId: action.tenantId,
                signalId: action.signalId,
                actor: 'policy-engine',
                actorUserId: current.createdById,
                event: 'approval.requested',
                message: `Approval requested for action ${action.id}.`,
                resourceType: 'approval',
                resourceId: approval.id,
                requestId: current.requestId,
                correlationId: action.correlationId,
                metadata: { actionId: action.id, minApproverRole: approval.minApproverRole, expiresAt: approval.expiresAt }
              });
            }
          }

          await tx.signal.update({
            where: { id: current.id },
            data: { status: SignalStatus.PROCESSED, processedAt: new Date() }
          });
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown signal processing error';
        await markSignalFailed({
          signalId: signal.id,
          tenantId: signal.tenantId,
          requestId: signal.requestId,
          correlationId: signal.correlationId,
          jobId: job.id,
          attemptsMade: job.attemptsMade,
          message
        });
        throw error;
      }
    },
    { connection: bullConnection(), concurrency: env.WORKER_CONCURRENCY }
  );

  worker.on('failed', async (job, error) => {
    const signalId = (job?.data as { signalId?: string } | undefined)?.signalId;
    console.error('Signal worker failed', job?.id, error);
    if (signalId) {
      const signal = await prisma.signal.findUnique({ where: { id: signalId } });
      if (signal) {
        await audit({
          tenantId: signal.tenantId,
          signalId: signal.id,
          actor: 'signal-worker',
          event: 'queue.signal_job_failed',
          message: `BullMQ signal job ${job?.id ?? 'unknown'} failed; durable state remains in Signal and OutboxEvent.`,
          requestId: signal.requestId,
          correlationId: signal.correlationId,
          metadata: { attemptsMade: job?.attemptsMade, error: error.message }
        });
      }
    }
  });

  return worker;
}
