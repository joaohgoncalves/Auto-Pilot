# Terraform Deployment Notes

Recommended managed resources:

- Private Postgres with automated backups and point-in-time recovery.
- Private Redis with persistence enabled when supported by the provider.
- Container registry for API, worker, and web images.
- Secret manager entries for `JWT_SECRET`, `COOKIE_SECRET`, database credentials, and provider tokens.
- Object storage or managed backup policy for database dumps.
- Load balancer or ingress controller terminating TLS.

Keep runtime databases off public networks. Only nginx/ingress should receive public traffic.
