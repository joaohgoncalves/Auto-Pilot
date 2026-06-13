import { Queue } from 'bullmq';
import { env } from '../config/env.js';
import { bullConnection } from '../lib/bullmq.js';

export const actionQueue = new Queue('action-execution', {
  connection: bullConnection(),
  defaultJobOptions: {
    attempts: env.ACTION_MAX_ATTEMPTS,
    backoff: { type: 'exponential', delay: 1500 },
    removeOnComplete: 100,
    removeOnFail: 500
  }
});

export function actionJobId(actionId: string, reason = 'execute') {
  return `action-${actionId}-${reason.replace(/[^A-Za-z0-9_-]/g, '_')}`;
}

export async function enqueueActionExecution(actionId: string, reason = 'execute') {
  await actionQueue.add(
    'execute-action',
    { actionId, reason },
    { jobId: actionJobId(actionId, reason) }
  );
}
