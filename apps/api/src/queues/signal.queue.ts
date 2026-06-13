import { Queue } from 'bullmq';
import { bullConnection } from '../lib/bullmq.js';

export const signalQueue = new Queue('signal-processing', {
  connection: bullConnection(),
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: 100,
    removeOnFail: 500
  }
});

export async function enqueueSignal(signalId: string) {
  await signalQueue.add(
    'process-signal',
    { signalId },
    { jobId: `signal:${signalId}` }
  );
}
