# Operations Guide

## Local execution

```bash
cp .env.example .env
npm ci
npm run db:generate
docker compose up -d postgres redis
npm run db:migrate
npm run db:seed
npm run dev:api
npm run dev:worker
npm run dev:web
```

## Production execution

```bash
npm ci
npm run db:generate
npm run db:migrate:deploy
npm run build
npm --workspace apps/api run start
npm --workspace apps/api run start:worker
npm --workspace apps/web run start
```

The worker process starts three components:

- Outbox dispatcher.
- Signal worker.
- Action worker.

## Healthchecks

- `GET /health/live`: process is alive.
- `GET /health/ready`: PostgreSQL and Redis are reachable.
- `GET /metrics`: Prometheus-style metrics scoped to the authenticated tenant. Requires `ADMIN` or `OWNER`.

## Failure handling

- The API writes `OutboxEvent` rows instead of directly publishing critical jobs.
- The outbox dispatcher retries failed dispatches with exponential backoff and moves exhausted events to `DEAD_LETTER`.
- BullMQ retries signal/action jobs with exponential backoff, but Redis is not treated as the durable dead-letter store.
- The signal worker marks a signal `PROCESSING` while working and only marks `PROCESSED` after actions, approvals, audits and outbox action events are committed.
- Actions are executed by a separate `action-execution` queue.
- Workers atomically claim actions by moving eligible actions to `RUNNING` and writing `lockedAt`, `lockedBy`, `heartbeatAt`, `lockExpiresAt`.
- A `RUNNING` action with expired `lockExpiresAt` can be reclaimed; the recovery is audited.
- Action attempts are persisted in `ActionAttempt` and counted in `Action.attemptCount`.
- Unknown action types are marked `FAILED`, non-retryable and audited.
- Actions that exceed `maxAttempts` move to `DEAD_LETTER` and create `DeadLetterEvent`.
- Approvals create an outbox-backed action execution event; they do not execute action effects inside the HTTP request.

## Dead-letter operations

List dead-letter records:

```bash
GET /dead-letter
```

Reprocess a record:

```bash
POST /dead-letter/:id/reprocess
```

Reprocessing an action dead letter resets its lock and attempt counter, marks it `PENDING` and writes a new outbox event. Reprocessing an outbox dead letter resets that outbox event to `PENDING`.

## Required environment variables

See `.env.example`. In production:

- `JWT_SECRET` must be a strong secret with at least 32 characters.
- `CORS_ORIGINS` must be explicit.
- `ACTION_LOCK_TTL_SECONDS` should exceed the expected longest normal action execution time.
- `OUTBOX_DISPATCH_INTERVAL_MS` and `OUTBOX_DISPATCH_BATCH_SIZE` control outbox throughput.

## Round 2 operations

CI should run `npm run db:generate` in an environment that can access or cache Prisma engines. Do not commit generated Prisma Client. Multiple outbox dispatchers can run because events are atomically claimed with `PROCESSING`, `claimedBy` and `processingStartedAt`. Actions renew heartbeats while running; stale locks can be reclaimed safely.
