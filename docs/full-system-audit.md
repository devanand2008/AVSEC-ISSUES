# AVS College Management System — Full-System Audit

Audit date: 2026-07-28  
Workspace: `D:\COLLEGE MANAGEMENT SITE`  
Secrets: redacted; `.env` values were not copied into this report.

## Executive summary

The repository is already a substantial npm monorepo rather than an empty or demo
application. Its production web path is `apps/web` (Next.js App Router), its API is
`apps/api` (NestJS), and its database is PostgreSQL through Prisma 7.8 with a custom
generated-client output at `apps/api/src/generated/prisma`. Redis backs queues and
Socket.IO fan-out, and S3-compatible object storage (MinIO locally) stores private
files.

Most requested domains exist in code and schema: authentication, users/profiles,
roles/scopes, campus/academics, attendance, announcements, conversations,
broadcasts, issues/maintenance, delivery/WhatsApp, feedback, QR, learning/skills,
AI, notifications, imports, reports, audit, storage, and health.

The highest-risk finding is duplication rather than absence: there are two QR
systems and multiple legacy route aliases, and a tracked Flutter client contradicts
the web-only product brief. These should be consolidated incrementally. Deleting or
moving them without a migration would risk current users and imports, so this audit
does not perform destructive reorganization.

## Current project structure

```text
apps/
  api/                 NestJS API, Prisma schema/migrations, Jest tests
  web/                 Next.js PWA, Vitest tests, Playwright tests
  flutter_app/         Tracked secondary client (contradicts web-only brief)
packages/
  shared-types/
  validation/
docs/
scripts/
docker-compose.yml
docker-compose.production.yml
```

Root npm workspaces are `apps/*` and `packages/*`. The active workspaces are
`@college/api`, `@college/web`, `@college/shared-types`, and
`@college/validation`.

## Technology and runtime inventory

| Concern | Current implementation |
| --- | --- |
| Frontend | Next.js App Router in `apps/web/src/app` |
| Backend | NestJS entry point `apps/api/src/main.ts` |
| Database | PostgreSQL |
| ORM | Prisma 7.8 |
| Prisma schema | `apps/api/prisma/schema.prisma` |
| Generated client | `apps/api/src/generated/prisma` |
| Authentication | JWT access/refresh flow, server sessions and refresh-token records |
| Realtime | Socket.IO with Redis adapter and local fallback |
| Object storage | S3 API; MinIO in local Docker Compose |
| WhatsApp | Meta Cloud API template delivery with webhook verification |
| PWA | Next.js manifest, custom `/sw.js`, offline route, Firebase messaging worker |
| QR scanning | Browser camera plus image/manual fallbacks in web routes |
| Tests | Jest, Vitest, Playwright |
| Default timezone | Configured by environment; deployment must retain `Asia/Kolkata` |

## Module coverage

API modules found:

```text
academic admin ai announcements attendance audit auth conversations delivery
feedback health imports issues learn locations notifications qr reports routing
storage users
```

The Prisma schema contains the core requested models or their real application
equivalents, including user/session/security, campus/academic, attendance,
announcement, conversation/message, issue/maintenance, feedback/QR, notification,
WhatsApp, import/export, learning/skills, AI, audit, and idempotency records.

## Broken or inconsistent areas

1. **Chat broadcast validation (repaired 2026-07-28).** The create endpoint used a
   TypeScript interface. Nest's strict `forbidNonWhitelisted` validation therefore
   rejected `title` and every other submitted property. It now uses a decorated
   `CreateBroadcastDto`; a regression test covers the complete payload.
2. **QR route duplication (repaired for new feedback codes 2026-07-28).** New
   feedback QR URLs and scanner navigation now use `/feedback/scan/:token`.
   Resolution and submission use `/feedback/qr/:token/resolve` and
   `/feedback/qr/:token/submit`, so the server derives the target from the token.
   Legacy `/student/feedback/target/:token` pages remain as compatibility aliases
   for already printed codes. The separate generic entity QR system remains by
   design.
3. **Profile API aliases (repaired 2026-07-28).** Canonical `/profile/me`,
   `/profile/me/status`, `/profile/me/submit`, and `/admin/profiles` aliases now
   coexist with current user/student/admin routes. Profile-photo endpoints still
   require a dedicated object-storage workflow.
4. **DTO gaps.** Some user/profile controller bodies are typed as
   `Record<string, unknown>`. This avoids unsafe property assignment in services but
   does not provide complete declarative request validation or OpenAPI contracts.
5. **Tracked Flutter client.** `apps/flutter_app` is a large tracked application,
   while the current brief explicitly requires a PWA and says not to create a
   Flutter app. It is excluded from the npm and Docker builds, but remains a
   maintenance and scope ambiguity. It was not deleted because it contains user
   changes and deletion was not explicitly authorized.
6. **Docker build memory.** The Nest build exceeded Node's default heap inside
   Docker. The API build stage now sets `NODE_OPTIONS=--max-old-space-size=4096`.
7. **Mojibake in source/comments.** Some files contain incorrectly decoded
   punctuation (for example `â€¦` and box-drawing comments). This is cosmetic but
   should be normalized in a dedicated mechanical change.

## Duplicate and unused candidates

- `apps/flutter_app` duplicates major PWA capabilities but is outside the npm
  production build.
- `/admin/communication/broadcast` re-exports `/admin/broadcasts`.
- Legacy feedback routes remain alongside `/feedback/...` to preserve printed-code
  compatibility; all newly generated URLs are canonical.
- QR functionality is split between `modules/feedback` and `modules/qr`.
- Root-level historical guides overlap with organized copies under `docs/`.
- Untracked legacy directories (`legacy`, `learn language`,
  `worker management system2`) are excluded from Docker and are not part of the
  npm monorepo. Ownership must be confirmed before archival/removal.

## Mock data and client persistence

No evidence was found that the main PWA uses mock JSON or `localStorage` as its
permanent database. `localStorage` is used for:

- a non-sensitive login identifier hint;
- expiring attendance drafts;
- an issue-report draft.

These are appropriate transient UX caches; permanent records are posted to the API.
Static arrays are used for UI enums/options, not as the system of record.

## Hardcoded and localhost URLs

Localhost defaults exist in runtime configuration for local development:

- web API fallback: `http://localhost:4000/api/v1`;
- Socket.IO fallback: `http://localhost:4000/realtime`;
- API `WEB_URL`, Redis, and MinIO development defaults.

Production validation rejects unsafe localhost/default-secret configurations.
QR URL construction must continue to use configured `WEB_URL`; the duplicate
feedback URL builder should be consolidated before issuing production codes.

## Prisma and database findings

- Schema: `apps/api/prisma/schema.prisma`
- Client import: `apps/api/src/generated/prisma/client`
- `PrismaService` correctly extends the generated `PrismaClient`.
- Prisma CLI and client versions match at 7.8.0.
- `prisma validate`: passed on 2026-07-28.
- `prisma generate`: passed on 2026-07-28.
- No destructive reset or `db push --force-reset` was used.
- Existing migrations and data must be preserved.

## Security findings

Positive controls observed:

- strict Nest validation with whitelist and `forbidNonWhitelisted`;
- backend permission decorators/guards;
- JWT/session/refresh-token models and lifecycle tests;
- rate limiting, CORS allow-listing, Helmet headers, audit records;
- S3 signed URLs and file metadata;
- hashed/opaque QR token handling in feedback workflows;
- WhatsApp webhook verification and server-only credentials;
- production environment validation and secret checks.

Items requiring continued hardening:

- replace remaining untyped controller bodies with DTOs;
- consolidate QR authorization and target resolution to prevent policy drift;
- exercise IDOR tests for every admin/profile alias;
- verify that service-worker caches never include authenticated API responses;
- run dependency audit in the deployment environment;
- keep `.env`, private imports, exports, credentials, and uploaded files untracked.

## Data migration requirements

No schema migration is required for the broadcast DTO repair. Future consolidation
should use non-destructive migrations:

1. Add canonical route/version metadata to QR records if required.
2. Keep legacy QR paths as redirects until issued-code usage falls to zero.
3. Backfill missing legacy announcement titles with the existing runtime fallback
   retained during transition.
4. If the Flutter client is retired, archive it in a separate repository only after
   confirming release and data-migration ownership.

## Recommended implementation order

1. Keep Prisma validate/generate, API/web typecheck, tests, and builds green.
2. Finish DTO coverage for profile/user endpoints.
3. Remove legacy feedback QR routes only after printed-code usage is confirmed to
   be zero.
4. Add integration tests for token resolution, refresh, revoked/expired codes, and
   target tampering.
5. Complete profile photo/object-storage and admin verification integration tests.
6. Exercise issue completion-photo, reporter verification, and escalation E2E flows.
7. Exercise announcement title, messenger image, Learn, Skill, and AVS Bot E2E flows.
8. Run responsive Playwright projects at the required viewport matrix.
9. Decide whether to archive the tracked Flutter client and untracked legacy trees.
10. Deploy only after production environment validation, migrations, backups, and
    provider credentials are confirmed.

## Verification snapshot (2026-07-28)

- Prisma validate: passed.
- Prisma generate: passed.
- All-workspace TypeScript: passed.
- All-workspace lint: passed.
- API tests: 313 passed.
- Web tests: 34 passed.
- NestJS build: passed.
- Next.js PWA build: passed.
- Sensitive-file preflight: passed.
- Playwright: timed out and remains unverified.
- Canonical feedback QR generation/resolve/submit: implemented and deployed.
- Canonical profile API aliases: implemented and deployed.
