# Product Spec — AutoPilotOps

## One-line pitch

AutoPilotOps detects technical and business risks, evaluates safety policies and executes automated playbooks before losses happen.

## Target users

### Small business

- Markets
- Restaurants
- Stores
- Clinics
- Local e-commerce

Pain:

- Stockout
- Expiring products
- Delayed orders
- Manual follow-ups
- Forgotten tasks

### Enterprise

- SRE teams
- Platform teams
- DevOps teams
- Support engineering
- Internal operations teams

Pain:

- Incident response toil
- SLA breach
- Deploy regression
- Manual escalation
- Weak auditability

## MVP demo

1. Login.
2. Run technical regression demo.
3. Verify signal processed.
4. Verify incident created.
5. Verify rollback approval requested.
6. Approve action.
7. Verify audit timeline.
8. Run retail stockout demo.
9. Verify purchase recommendation and task.

## Roadmap

- Real webhook delivery
- Email notifications
- Slack/Teams adapters
- Real rollback adapter with dry-run mode
- CSV inventory importer
- On-call schedule
- Cost anomaly signal
- Playbook builder UI
- OpenTelemetry metrics
- Testcontainers E2E suite
