import { Worker } from 'bullmq';
import { env } from '../config/env.js';
import { bullConnection } from '../lib/bullmq.js';
import { prisma } from '../lib/prisma.js';
import { audit } from '../lib/audit.js';
import { executeActionById } from '../engines/action.engine.js';

export function startActionWorker() {
  const worker = new Worker(
    'action-execution',
    async (job) => {
      const { actionId } = job.data as { actionId: string; reason?: string };
      const workerId = `action-worker:${process.pid}`;
      const result = await executeActionById(actionId, { workerId, requestId: job.id });

      if (result.failed && result.retryable && job.attemptsMade + 1 < env.ACTION_MAX_ATTEMPTS) {
        throw new Error(result.reason ?? 'Retryable action execution failure');
      }

      return result;
    },
    { connection: bullConnection(), concurrency: env.ACTION_WORKER_CONCURRENCY }
  );

  worker.on('failed', async (job, error) => {
    const actionId = (job?.data as { actionId?: string } | undefined)?.actionId;
    if (!actionId) return;

    const action = await prisma.action.findUnique({ where: { id: actionId } });
    if (!action) return;

    await audit({
      tenantId: action.tenantId,
      signalId: action.signalId,
      actor: 'action-worker',
      event: 'queue.action_job_failed',
      message: `Action job ${job?.id ?? 'unknown'} failed. Durable retry/dead-letter state is stored in Action and DeadLetterEvent.`,
      resourceType: 'action',
      resourceId: action.id,
      requestId: job?.id,
      correlationId: action.correlationId,
      metadata: { attemptsMade: job?.attemptsMade, error: error.message, status: action.status }
    });
  });

  return worker;
}
