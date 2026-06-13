# ADR 005 — Idempotent worker and approval workflow

## Decision

Use database constraints and upserts to make worker retries safe. Every `WAITING_APPROVAL` action has exactly one `ApprovalRequest`. Action side effects are unique per action.

## Context

BullMQ retries can duplicate side effects unless action creation and execution are idempotent.

## Consequences

- Retried jobs do not duplicate incidents, tasks or recommendations.
- Failed jobs are kept in Redis and action attempts are stored in PostgreSQL.
- Unknown action types fail loudly and produce audit records.
