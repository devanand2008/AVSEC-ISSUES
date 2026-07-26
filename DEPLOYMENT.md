# Deployment

## Prerequisites

- Node.js 22+ and npm 10+, or the supplied non-root Node 24 Alpine images.
- PostgreSQL 17+ with backups and a restricted application identity.
- Persistent Redis configured for queues and suitable eviction policy.
- A private S3-compatible bucket with lifecycle/retention policy.
- TLS ingress, an exact non-local HTTPS `WEB_URL`, and the number of trusted proxy hops in `TRUST_PROXY`.

## Release sequence

1. Copy `.env.example` into the deployment secret manager. Replace every password, JWT/CSRF secret, storage credential, encryption key, and provider secret. Set `NODE_ENV=production`, `COOKIE_SECURE=true`, `SWAGGER_ENABLED=false`, `SEED_DEVELOPMENT_DATA=false`, a positive `TRUST_PROXY` hop count, and the exact allowed origin. Production startup rejects documented example values and localhost database/web URLs.
2. Set the container-reachable `DATABASE_URL` (normally using host `postgres`), public `NEXT_PUBLIC_API_URL`/`NEXT_PUBLIC_SOCKET_URL`, and any Firebase public variables before building; Next.js compiles public variables into the web bundle.
3. Run `npm ci`, `npm run prisma:generate`, `npm run check`, and `npm run audit:production` in CI.
4. Render and build the production override, which removes infrastructure host ports and applies a read-only/non-root application runtime:

```powershell
docker compose -f docker-compose.yml -f docker-compose.production.yml --profile full config --quiet
docker compose -f docker-compose.yml -f docker-compose.production.yml --profile full build
```

5. Back up PostgreSQL and object storage, verify backup hashes, and review every pending SQL file. The two migration directories added on 15 July 2026 still require target deployment verification.
6. Apply migrations from the release image:

```powershell
docker compose -f docker-compose.yml -f docker-compose.production.yml --profile full run --rm api npm run prisma:deploy -w @college/api
```

7. Start the stack and verify `/api/v1/health/ready/dependencies`; it returns only minimal orchestrator readiness and checks PostgreSQL, Redis, and object storage. Authenticated operators with `system.health` can inspect component detail at `/api/v1/health/ready` and `/admin/operations`. The Compose API healthcheck uses the configured `API_PREFIX`, not a hardcoded route.
8. Run smoke/Playwright checks for login and session rotation, authorization negatives, attendance submission/correction, issue routing/files/lifecycle, messaging/files/moderation, imports/jobs, and provider-disabled behavior before shifting traffic.
9. Run a restore drill against an isolated database and verify row counts and `_prisma_migrations`.

On Windows, `START_AVS_APP.bat` is the supported local/LAN launcher. Production deployment should still run the locked verification pipeline manually or in CI before applying migrations: `npm ci`, `npm run env:validate:production`, `npm run check`, `npm run audit:production`, `docker compose config --quiet`, image build, fresh PostgreSQL backup plus checksum gate, migration, and API/web readiness checks. The database backup does not replace the required object-storage snapshot.

The production override assumes one TLS reverse-proxy hop by default. Set `TRUST_PROXY` to the exact hop count and do not publish the PostgreSQL, Redis, or MinIO ports. The API and web ports remain localhost-bound for a same-host ingress; change that topology only with an explicit firewall/private-network review.

## Providers and files

Firebase, WhatsApp, and malware scanning are independently configurable. Test each against an institution-owned sandbox before production enablement. Keep service-account and Meta secrets server-side. WhatsApp webhooks require the configured verify token and app secret. If attachments are enabled in production, configure `MALWARE_SCAN_ENABLED=true` and a reachable scanner returning `{ "clean": true }` only for accepted content.

Never expose the object bucket publicly. Preserve signed URL expiry, file size limits, type/signature verification, and tenant key prefixes.

## Rollback

Roll back application images independently. Prefer a reviewed forward corrective migration; restore a database only through the incident procedure. Preserve audit/history/outbox evidence and reconcile queues/providers after recovery. See `BACKUP_RESTORE.md`.
# Smart Campus Module Deployment

After pulling this upgrade, run:

```powershell
npm run prisma:deploy -w @college/api
npm run prisma:generate -w @college/api
npm run seed -w @college/api
npm run build
```

Production camera scanning requires HTTPS for `/student/feedback/scanner`.
