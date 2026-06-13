# ADR 007 — Action execution queue and session-bound access tokens

## Status

Accepted.

## Context

The previous hardening pass still executed approved actions directly inside the approval HTTP request. That couples user latency to side effects, makes retry behavior fragile and increases the risk of duplicated effects under concurrent requests or worker retries.

Refresh token rotation existed, but a reused rotated refresh token only failed the single request. It did not invalidate potentially compromised sibling sessions, and access tokens were not checked against refresh-session revocation.

## Decision

- Add a dedicated BullMQ queue named `action-execution`.
- Approval decisions only transition the action back to `PENDING` and enqueue a job.
- Action workers atomically claim actions by moving `PENDING` or retryable `FAILED` actions to `RUNNING`.
- Action effects remain idempotent through action-scoped unique constraints and upserts.
- Unknown action types fail as non-retryable.
- Add `RUNNING` and `CANCELED` action statuses.
- Add refresh token reuse detection. Reuse of a rotated token revokes all active sessions for the same user and tenant.
- Access tokens carry `sessionId`; protected routes verify that the backing session is still active.
- Login and refresh set httpOnly cookies for browser clients while retaining response-body tokens for API compatibility.

## Consequences

- HTTP approval requests are now fast and deterministic.
- Multiple workers can safely process the same queued action; only one can claim it.
- A logout or refresh rotation invalidates older access tokens associated with revoked sessions.
- The system now depends on the action worker being deployed alongside the signal worker.
