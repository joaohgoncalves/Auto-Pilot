# ADR 009 — Structural hardening, classified worker errors, JWT rotation, CSRF double-submit and scalable outbox claims

## Status
Accepted.

## Context
The first hardening round introduced durable outbox, dead-letter and action locks. The second round reduces coupling, improves failure classification, strengthens cookie-auth security and prepares the dispatcher for multiple workers.

## Decision
- Numeric conversion is centralized in `apps/api/src/lib/utils.ts`.
- `action.engine.ts` is now a compatibility facade over smaller services:
  - `action-claim.service.ts`
  - `action-execution.service.ts`
  - `action-side-effects.ts`
  - `action-error-classifier.ts`
  - `action-dead-letter.service.ts`
- Outbox dispatchers claim events atomically with `PROCESSING`, `claimedBy` and `processingStartedAt`.
- Long-running actions renew `heartbeatAt` and `lockExpiresAt` while executing.
- JWT access tokens are signed with the active secret and verified against current plus previous secrets.
- Cookie-auth mutating requests require Origin/Referer and double-submit CSRF token.
- Rule lookups can use Redis cache with tenant/type keys and invalidation on rule mutation.

## Consequences
- The action workflow is easier to test and reason about.
- Multiple outbox dispatcher processes are safer because they must claim rows before dispatching.
- Secret rotation can happen without logging everyone out at once.
- CSRF protection is stronger than Origin-only validation.
- Rule cache improves hot-path reads but still falls back to Postgres.

## Trade-offs
- The sandbox cannot run `prisma generate` when Prisma engines must be downloaded from `binaries.prisma.sh`.
- The Redis rule cache is intentionally short-TTL and invalidated on writes; it does not replace database consistency.
- Dispatcher claim is database-based rather than Redis lock-based to keep outbox ownership in one durability boundary.
