# AVS College Management System — Production Product Audit

Audit date: 2026-07-28  
Scope: the active npm/Next.js/NestJS product in `D:\COLLEGE MANAGEMENT SITE`  
Secret values are intentionally omitted.

## Verified architecture

| Area | Implementation |
| --- | --- |
| Frontend | `apps/web`, Next.js 16 App Router PWA |
| Backend | `apps/api`, NestJS 11 |
| API entry point | `apps/api/src/main.ts` |
| Database | PostgreSQL 17 locally |
| ORM | Prisma 7.8 |
| Schema | `apps/api/prisma/schema.prisma` |
| Generated client | `apps/api/src/generated/prisma` |
| Object storage | Private S3-compatible storage; MinIO locally |
| Realtime | Socket.IO with Redis adapter |
| WhatsApp | Meta Business Cloud API templates and verified webhook |
| QR | Server-generated opaque tokens, SHA-256 token lookup, `qrcode` |
| PWA | Manifest, custom service worker, offline route, Firebase messaging worker |

The npm monorepo structure is valid and should not be mass-moved while the worktree
contains unrelated user changes. `apps/flutter_app` is tracked but excluded from
the npm and Docker product; it conflicts with the PWA-only scope and requires an
owner decision before archival.

## Production readiness status

Already present and tested:

- access/refresh authentication, rotation, sessions, logout, rate limits;
- backend roles, permissions, scope guards, audit records;
- profile workflow, people administration, archive/restore/safe deletion;
- campus and academic management with dependency reporting;
- attendance, corrections, imports, summaries, and role reports;
- custom announcement titles, Tamil/Unicode validation, legacy fallback;
- atomic messenger attachments, persistent storage, realtime delivery;
- issue routing, repeat occurrences, maintenance, evidence, verification, SLA;
- WhatsApp failure isolation and delivery records;
- token-bound feedback QR resolve and submit on canonical PWA routes;
- Learn, Skill, AVS Bot, notifications, reports, imports, and data maintenance;
- production builds, test suites, Docker health checks, and secret preflight.

Repairs in this production pass:

- persistent profile-photo presign/verify/process/thumbnail/replace/delete flow;
- database-backed notification preferences replacing frontend-only toggles;
- canonical profile endpoints and canonical feedback QR routes from the prior pass.

## Broken, missing, or incomplete

1. Full Playwright E2E previously stalled and has not produced a passing report.
2. Real WhatsApp, Firebase, SMTP, OpenAI, public S3, and HTTPS camera checks need
   production-owned credentials and devices.
3. Profile images use an original key plus a deterministic thumbnail suffix rather
   than a separate `FileRecord`; metadata is audited but not modeled as a general
   file row.
4. Several profile controller payloads still use `Record<string, unknown>` and
   should move to explicit role-specific DTOs.
5. Delete/archive coverage is strong for people, campus, academic years,
   announcements, issues, imports, sessions, and orphan uploads, but is not uniform
   across every Skill/notification/QR administration screen requested by the brief.
6. Legacy feedback routes remain intentionally for already printed codes.
7. Some source files contain mojibake punctuation that should be normalized in a
   separate mechanical change.

## Duplicate and unused candidates

- `apps/flutter_app`: secondary client outside the production PWA build.
- `/admin/communication/broadcast`: alias of `/admin/broadcasts`.
- `/student/feedback/target/:token`: compatibility alias for canonical
  `/feedback/scan/:token`.
- root historical documentation duplicates files under `docs/`.
- untracked legacy directories are excluded from Docker and require owner approval
  before removal.

## Mock data and transient storage

No mock JSON is used as the main database. `localStorage` is limited to a login
identifier hint and expiring form/attendance drafts. A frontend-only notification
preference mock was found and replaced with persistent PostgreSQL data in this
pass.

## Localhost and configuration

Localhost fallbacks exist only for local development (API, web, Redis, MinIO,
Socket.IO). Production validation rejects development mode, localhost production
URLs, known placeholder secrets, and incomplete providers. QR builders use the
configured public web URL and now emit `/feedback/scan/:token`.

## Deletion and data-maintenance controls

Existing controlled maintenance requires:

- Main/Super Admin role plus `data.maintenance`;
- dry-run counts;
- college scoping;
- backup reference;
- job-bound typed confirmation phrase;
- revalidation of counts immediately before execution;
- reason and audit log.

It supports safe archival of academic years, attendance, assignments,
announcements, and closed issues, and cleanup of failed imports, expired sessions,
and orphaned uploads. Hard deletion is limited to records proven safe by the
workflow. There is no unrestricted “delete all”.

## Data migration

This pass adds one non-destructive migration:

`20260728173000_profile_preferences`

It adds a JSONB notification-preference column with safe defaults. It does not
delete or rewrite existing profile, attendance, issue, or academic data.

## Security risks and required operations

- Run migrations only after a verified backup.
- Use HTTPS and managed secrets in production.
- Keep S3 buckets private and preserve short signed-URL expiry.
- Configure malware scanning if the college requires synchronous scanning.
- Complete E2E/IDOR/file tests against an isolated copy of production-like data.
- Do not remove legacy routes or secondary clients until ownership and usage are
  confirmed.

## Recommended order

1. Validate and deploy the non-destructive profile-preference migration.
2. Run all typecheck, lint, test, build, and Docker health gates.
3. Complete isolated Playwright profile-photo, QR, issue, and messenger flows.
4. Validate HTTPS camera and PWA installation on real Android/iOS devices.
5. Configure provider credentials and execute failure/retry acceptance tests.
6. Fill remaining safe-delete UI gaps module-by-module.
7. Archive Flutter/legacy trees only with explicit owner approval.

## Verified production-pass snapshot

Verification completed on 2026-07-29:

- A pre-migration PostgreSQL backup was created at
  `backups/college-20260728-231753.dump`.
- Backup SHA-256:
  `FA3CD4BA5ACA2D128BF9C9DBD4132497EE6C405F301FA88B60586129B10AD4D2`.
- The API startup applied `20260728173000_profile_preferences` successfully.
- PostgreSQL confirms `users.notification_preferences` exists as `jsonb`.
- Prisma validation and client generation passed.
- Typecheck and lint passed across all workspaces.
- API tests passed: 318/318 in 41 suites.
- Web tests passed: 34/34 in 9 files.
- NestJS and Next.js PWA production builds passed; the PWA generated 81 routes.
- The sensitive-file preflight passed.
- Fresh API and web Docker images were deployed. API, web, PostgreSQL, Redis, and
  MinIO are healthy; `http://localhost:4000` and
  `http://localhost:3000/profile` return HTTP 200.

The local Docker deployment is a production-build verification environment, not an
internet production launch. Public HTTPS, managed secrets, production provider
credentials, physical-device camera testing, and the stalled Playwright browser
suite remain operational acceptance items.
