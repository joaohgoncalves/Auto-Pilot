import { ActionStatus, OutboxEventStatus } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

export class MetricsService {
  async tenantSummary(tenantId: string) {
    const [
      signalsTotal,
      actionsTotal,
      approvalsPending,
      incidentsOpen,
      recommendationsOpen,
      tasksOpen,
      rulesActive,
      failedActions,
      deadLetterActions,
      deadLetterEvents,
      outboxPending,
      outboxProcessed,
      outboxFailed,
      recoveredStaleLocks,
      actionRetries,
      avgApproval,
      oldestPendingOutbox,
      recentProcessedSignals,
      recentActionAttempts
    ] = await Promise.all([
      prisma.signal.count({ where: { tenantId } }),
      prisma.action.count({ where: { tenantId } }),
      prisma.approvalRequest.count({ where: { tenantId, status: 'PENDING' } }),
      prisma.incident.count({ where: { tenantId, status: { in: ['OPEN', 'INVESTIGATING', 'MITIGATING'] } } }),
      prisma.purchaseRecommendation.count({ where: { tenantId, status: 'OPEN' } }),
      prisma.operationalTask.count({ where: { tenantId, status: 'OPEN' } }),
      prisma.rule.count({ where: { tenantId, isActive: true } }),
      prisma.action.count({ where: { tenantId, status: ActionStatus.FAILED } }),
      prisma.action.count({ where: { tenantId, status: ActionStatus.DEAD_LETTER } }),
      prisma.deadLetterEvent.count({ where: { tenantId, status: 'OPEN' } }),
      prisma.outboxEvent.count({ where: { tenantId, status: OutboxEventStatus.PENDING } }),
      prisma.outboxEvent.count({ where: { tenantId, status: OutboxEventStatus.PROCESSED } }),
      prisma.outboxEvent.count({ where: { tenantId, status: { in: [OutboxEventStatus.FAILED, OutboxEventStatus.DEAD_LETTER] } } }),
      prisma.auditLog.count({ where: { tenantId, event: 'action.expired_lock_recovered' } }),
      prisma.actionAttempt.count({ where: { tenantId, attemptNo: { gt: 1 } } }),
      prisma.approvalRequest.findMany({
        where: { tenantId, decidedAt: { not: null } },
        select: { requestedAt: true, decidedAt: true },
        take: 500,
        orderBy: { decidedAt: 'desc' }
      }),
      prisma.outboxEvent.findFirst({
        where: { tenantId, status: OutboxEventStatus.PENDING },
        select: { createdAt: true, availableAt: true },
        orderBy: { createdAt: 'asc' }
      }),
      prisma.signal.findMany({
        where: { tenantId, processedAt: { not: null } },
        select: { receivedAt: true, processedAt: true },
        take: 500,
        orderBy: { processedAt: 'desc' }
      }),
      prisma.actionAttempt.findMany({
        where: { tenantId, finishedAt: { not: null } },
        select: { startedAt: true, finishedAt: true },
        take: 500,
        orderBy: { finishedAt: 'desc' }
      })
    ]);

    const approvalDurations = avgApproval
      .filter((approval) => approval.decidedAt)
      .map((approval) => approval.decidedAt!.getTime() - approval.requestedAt.getTime());
    const approvalAvgMs = approvalDurations.length > 0
      ? Math.round(approvalDurations.reduce((sum, value) => sum + value, 0) / approvalDurations.length)
      : 0;
    const signalDurations = recentProcessedSignals
      .filter((signal) => signal.processedAt)
      .map((signal) => signal.processedAt!.getTime() - signal.receivedAt.getTime());
    const actionDurations = recentActionAttempts
      .filter((attempt) => attempt.finishedAt)
      .map((attempt) => attempt.finishedAt!.getTime() - attempt.startedAt.getTime());
    const averageSeconds = (durationsMs: number[]) => durationsMs.length > 0
      ? durationsMs.reduce((sum, value) => sum + value, 0) / durationsMs.length / 1000
      : 0;
    const now = Date.now();
    const outboxOldestPendingSeconds = oldestPendingOutbox ? Math.max(0, (now - oldestPendingOutbox.createdAt.getTime()) / 1000) : 0;
    const queueLagSeconds = oldestPendingOutbox ? Math.max(0, (now - oldestPendingOutbox.availableAt.getTime()) / 1000) : 0;

    return {
      signalsTotal,
      actionsTotal,
      approvalsPending,
      incidentsOpen,
      recommendationsOpen,
      tasksOpen,
      rulesActive,
      failedActions,
      deadLetterActions,
      deadLetterEvents,
      outboxPending,
      outboxProcessed,
      outboxFailed,
      recoveredStaleLocks,
      actionRetries,
      approvalAvgMs,
      outboxOldestPendingSeconds,
      signalProcessingDurationSeconds: averageSeconds(signalDurations),
      actionExecutionDurationSeconds: averageSeconds(actionDurations),
      queueLagSeconds
    };
  }

  toPrometheus(tenantId: string, summary: Awaited<ReturnType<MetricsService['tenantSummary']>>) {
    const labels = `tenant_id="${tenantId.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
    const metric = (name: string, help: string, value: number) => [
      `# HELP ${name} ${help}`,
      `# TYPE ${name} gauge`,
      `${name}{${labels}} ${value}`
    ].join('\n');

    return [
      metric('autopilotops_signals_total', 'Tenant-scoped signals stored.', summary.signalsTotal),
      metric('autopilotops_actions_total', 'Tenant-scoped actions stored.', summary.actionsTotal),
      metric('autopilotops_approvals_pending', 'Tenant-scoped pending approvals.', summary.approvalsPending),
      metric('autopilotops_incidents_open', 'Tenant-scoped open incidents.', summary.incidentsOpen),
      metric('autopilotops_recommendations_open', 'Tenant-scoped open recommendations.', summary.recommendationsOpen),
      metric('autopilotops_tasks_open', 'Tenant-scoped open tasks.', summary.tasksOpen),
      metric('autopilotops_rules_active', 'Tenant-scoped active rules.', summary.rulesActive),
      metric('autopilotops_actions_failed', 'Tenant-scoped failed actions.', summary.failedActions),
      metric('autopilotops_actions_dead_letter', 'Tenant-scoped dead-letter actions.', summary.deadLetterActions),
      metric('autopilotops_dead_letter_open', 'Tenant-scoped open dead-letter records.', summary.deadLetterEvents),
      metric('autopilotops_outbox_pending', 'Tenant-scoped pending outbox events.', summary.outboxPending),
      metric('autopilotops_outbox_processed', 'Tenant-scoped processed outbox events.', summary.outboxProcessed),
      metric('autopilotops_outbox_failed', 'Tenant-scoped failed/dead-letter outbox events.', summary.outboxFailed),
      metric('autopilotops_action_retries_total', 'Tenant-scoped action retry attempts.', summary.actionRetries),
      metric('autopilotops_actions_recovered_total', 'Tenant-scoped recovered stale action locks.', summary.recoveredStaleLocks),
      metric('autopilotops_approval_avg_ms', 'Average approval decision duration in milliseconds.', summary.approvalAvgMs),
      metric('outbox_pending_total', 'Pending outbox events.', summary.outboxPending),
      metric('outbox_oldest_pending_seconds', 'Age in seconds of the oldest pending outbox event.', summary.outboxOldestPendingSeconds),
      metric('signal_processing_duration_seconds', 'Average processing duration in seconds for recently processed signals.', summary.signalProcessingDurationSeconds),
      metric('action_execution_duration_seconds', 'Average execution duration in seconds for recently finished action attempts.', summary.actionExecutionDurationSeconds),
      metric('dead_letters_total', 'Open dead-letter records.', summary.deadLetterEvents),
      metric('approval_waiting_total', 'Pending approval requests.', summary.approvalsPending),
      metric('queue_lag_seconds', 'Seconds since the oldest pending outbox event became available.', summary.queueLagSeconds)
    ].join('\n');
  }
}

export const metricsService = new MetricsService();
