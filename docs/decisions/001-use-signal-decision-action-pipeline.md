# ADR 001 — Use signal → decision → action pipeline

## Status

Accepted

## Context

The platform must support both technical incidents and business operations. A generic case/task model would be too limited.

## Decision

Use a signal-driven pipeline:

```txt
signal -> correlation -> decision -> policy -> action -> audit
```

## Consequences

- The system can process API failures and stockout risks using the same architecture.
- New domains can be added by creating new correlation and decision logic.
- Actions remain auditable and policy-controlled.
