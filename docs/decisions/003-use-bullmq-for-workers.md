# ADR 003 — Use BullMQ for async processing

## Status

Accepted

## Context

Signal ingestion should be fast and resilient. Processing may involve retries, API calls and database writes.

## Decision

Use BullMQ over Redis for asynchronous signal processing.

## Consequences

- API returns quickly with `202 Accepted`.
- Workers can retry failed jobs with exponential backoff.
- The processing path can be scaled independently.
