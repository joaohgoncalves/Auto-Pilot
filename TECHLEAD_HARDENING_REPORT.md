# Tech Lead Hardening Report

## Scope implemented

This hardening pass focused on consistency, recoverability, tenant isolation and browser-session security.

## Changed areas

- `prisma/schema.prisma`
  - Added `SignalStatus.PROCESSING`.
  - Added `ActionStatus.DEAD_LETTER`.
  - Added `OutboxEventStatus`.
  - Added `OutboxEvent`.
  - Added `DeadLetterEvent`.
  - Added action lock/recovery fields: `lockedAt`, `lockedBy`, `heartbeatAt`, `lockExpiresAt`.
  - Added action failure fields: `attemptCount`, `maxAttempts`, `errorCode`, `lastError`, `failedAt`, `deadLetteredAt`.
  - Added indexes and unique constraints for tenant-scoped idempotency.

- `prisma/migrations/20260610193000_transactional_outbox_dead_letter_locks/migration.sql`
  - Real SQL migration for outbox/dead-letter/lock additions.

- `apps/api/src/workers/signal.worker.ts`
  - Signal is marked `PROCESSING` before work.
  - Signal is marked `PROCESSED` only after actions, approvals, audits and action outbox events are committed.
  - Action jobs are not enqueued directly from the signal worker.
  - Signal processing is idempotent through upsert/unique constraints.

- `apps/api/src/workers/outbox.dispatcher.ts`
  - New dispatcher for pending outbox events.
  - Publishes durable events to BullMQ.
  - Retries failed dispatches and creates `DeadLetterEvent` when exhausted.

- `apps/api/src/engines/action.engine.ts`
  - Atomic action claim with expiring locks.
  - Stale `RUNNING` recovery.
  - Attempt counting.
  - Durable action dead-lettering.
  - Lock cleanup on success/failure.

- `apps/api/src/routes/actions.routes.ts`
  - Manual retry now writes an outbox event instead of direct BullMQ enqueue.
  - Approval approve now writes the execution outbox event in the same transaction.
  - Added `GET /dead-letter`.
  - Added `POST /dead-letter/:id/reprocess`.

- `apps/api/src/routes/signals.routes.ts`
  - Signal ingestion writes a signal and signal-processing outbox event atomically.
  - Duplicate `idempotencyKey` returns the existing signal instead of duplicating workflow effects.

- `apps/api/src/routes/demo.routes.ts`
  - Demo signal creation now uses outbox instead of direct queue publish.

- `apps/api/src/routes/health.routes.ts`
  - `/metrics` is tenant-scoped and includes signals, actions, approvals, incidents, recommendations, tasks, rules, failures, dead-letter and outbox counters.

- `apps/api/src/lib/csrf.ts`
  - New CSRF Origin/Referer validation for mutating cookie-auth requests.

- `apps/api/src/app.ts`
  - Registers CSRF validation hook.

- `apps/api/src/lib/outbox.ts`
  - Shared helpers for outbox/dead-letter writes inside Prisma transactions.

- `apps/api/src/lib/audit.ts`
  - Added transaction-aware audit writes.

- `apps/api/src/worker.ts`
  - Starts outbox dispatcher alongside signal/action workers.

- Tests/documentation/package scripts updated.

## Key decisions

1. PostgreSQL is the source of truth for workflow durability.
2. BullMQ remains the execution transport, not the durable event store.
3. Action side effects remain idempotent using action-scoped unique constraints and upserts.
4. Dead-letter is persisted in PostgreSQL and is reprocessable through explicit admin operations.
5. Metrics remain tenant-scoped; no platform-wide role was introduced in this pass.
6. CSRF protection is implemented via Origin/Referer validation to avoid requiring a frontend token migration immediately.

## Validation performed in this environment

Passed:

```bash
npm test
```

Result: 7 API/shared test files passed; DB/Redis-dependent tests were skipped because Prisma client could not be generated.

Blocked by environment:

```bash
npm run db:generate
npm run lint
npm run typecheck
npm run build
```

Reason: Prisma attempted to download engine binaries from `binaries.prisma.sh`, but the sandbox returned DNS resolution failure: `getaddrinfo EAI_AGAIN binaries.prisma.sh`. Because `@prisma/client` remained ungenerated, TypeScript reported missing generated Prisma exports such as `ActionStatus`, `Role`, `PrismaClient`, etc.

## Required validation outside this sandbox

Run in a network-enabled development environment:

```bash
npm ci
npm run db:generate
docker compose up -d postgres redis
npm run db:migrate
npm run lint
npm run typecheck
npm test
RUN_INTEGRATION_TESTS=true npm --workspace apps/api test
npm run build
```

## Remaining risks

- Full Prisma generation/migration/typecheck must be run in a network-enabled environment.
- Integration tests need expansion for every acceptance case, especially auth refresh reuse, tenant-A vs tenant-B resource access, and stale action recovery under concurrent workers.
- Outbox dispatcher is in-process. A larger production deployment should add leader election or partitioning if many worker replicas dispatch outbox events.
- Action heartbeats are recorded at claim time. Long-running real external actions should periodically update `heartbeatAt` and extend `lockExpiresAt`.
