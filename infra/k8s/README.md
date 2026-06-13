# Kubernetes Deployment Notes

This folder is reserved for production manifests or Helm/Kustomize overlays.

Minimum production shape:

- API Deployment with `/health/live` liveness and `/health/ready` readiness probes.
- Worker Deployment with no public Service.
- Web Deployment behind an Ingress.
- Postgres and Redis as managed private services, not public pods for production.
- Secrets delivered through the cluster secret manager, not committed YAML.
- Migrations run as a pre-deploy Job using `npx prisma migrate deploy`.
- Structured logs shipped from stdout/stderr.
