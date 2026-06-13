import { startActionWorker } from './workers/action.worker.js';
import { startOutboxDispatcher } from './workers/outbox.dispatcher.js';
import { startSignalWorker } from './workers/signal.worker.js';

const outboxDispatcher = startOutboxDispatcher();
const signalWorker = startSignalWorker();
const actionWorker = startActionWorker();

async function closeWorkers() {
  await Promise.all([outboxDispatcher.close(), signalWorker.close(), actionWorker.close()]);
}

process.on('SIGINT', async () => {
  await closeWorkers();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await closeWorkers();
  process.exit(0);
});
