# ADR 008: Transactional outbox, durable dead-letter and action locks

## Status

Accepted.

## Context

The previous worker flow created database records and directly published BullMQ jobs in the same code path. That creates a consistency gap: the database can commit while BullMQ publish fails, BullMQ can receive a job while a database transaction rolls back, or the process can crash between both operations.

Actions also had a `RUNNING` state without an expiring lock. If a worker died after marking an action `RUNNING`, the action could remain stuck permanently.

BullMQ `removeOnFail` was being treated as dead-letter behavior, but Redis retained jobs are not a product-grade audit/reprocess model.

## Decision

Use PostgreSQL as the durable workflow source of truth.

- Write `OutboxEvent` inside the same Prisma transaction as critical domain changes.
- Publish outbox events to BullMQ from a separate dispatcher.
- Mark outbox events `PROCESSED`, `FAILED` or `DEAD_LETTER` after dispatch attempts.
- Add `lockedAt`, `lockedBy`, `heartbeatAt` and `lockExpiresAt` to actions.
- Claim actions atomically and allow reclaiming stale `RUNNING` locks.
- Add `Action.status = DEAD_LETTER` and a durable `DeadLetterEvent` table.
- Add admin list/reprocess endpoints for dead-letter operations.

## Consequences

Positive:

- Signal processing is crash-safe at critical boundaries.
- BullMQ/Redis outage does not lose committed work.
- Retries do not duplicate actions, approvals, incidents, tasks or recommendations because effects are protected by unique constraints and upserts.
- Stuck actions can be recovered by another worker.
- Dead-letter records are queryable, auditable and reprocessable.

Tradeoffs:

- The worker process has one more component: the outbox dispatcher.
- Operators must monitor outbox pending/failed/dead-letter counts.
- Manual reprocessing must be explicit and audited.
