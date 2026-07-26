# Implementation Plan

## Delivery principles

- Preserve the root Vite application as the legacy attendance/data-export baseline.
- Use a modular monolith, not microservices.
- PostgreSQL is authoritative; Redis and browser drafts are never sources of record.
- Enforce permission and scope constraints in NestJS before returning or mutating records.
- Make issue, attendance, status and assignment operations transactional and idempotent.
- Do not mark integrations as delivered when they are disabled or have only generated a fallback link.

## Target repository layout

```text
apps/
  api/                 NestJS REST, Socket.IO, jobs and Prisma
  web/                 Next.js App Router/PWA
packages/
  shared-types/        API/domain contracts without runtime secrets
  validation/          Shared Zod schemas where appropriate
docker/                Container and operational assets
docs/                  Detailed technical documentation
src/                   Preserved legacy root application
worker management system2/  Legacy independent WorkerMS prototype; not part of the maintained AVS app and safe to archive/remove after filesystem policy allows recursive deletion
```

The repository uses npm workspaces because pnpm is not installed in the audited environment. Commands in all documentation will match that decision.

## Phase 1 — audit and foundation

- Create mandatory audit/design/API/permission/progress documents.
- Add workspace manifests, strict TypeScript, ESLint/Prettier, environment validation and shared packages.
- Add PostgreSQL, Redis and MinIO Docker services with health checks.
- Create the Prisma schema and initial migration.
- Add structured logging, request IDs, consistent errors, Swagger and health endpoints.
- Add backup/restore scripts and legacy-browser export/import mapping.

Exit gate: clean install; infrastructure healthy; Prisma generate/migrate succeeds; API and web typecheck/lint/build pass.

## Phase 2 — authentication, RBAC and audit

- Implement users, credentials, roles, permissions, role mappings and typed scopes.
- Implement Argon2id login, HttpOnly access/refresh cookies, refresh rotation/reuse detection, CSRF checks, password change/reset and session revocation.
- Implement account status/first-login restrictions and login throttling.
- Add permission/scope decorators and guards plus append-only audit logging.
- Add admin user creation and validated CSV import preview/commit.

Exit gate: authentication/rotation/scope/IDOR tests pass; suspended users and revoked sessions cannot access protected routes.

## Phase 3 — college, academic and location master data

- Implement college/campus/department/programme/year/semester/section/subject services.
- Implement block/floor/room/asset/category CRUD with active filters and ordered lists.
- Add bulk imports/exports, room QR payloads and printable QR sheets.
- Add responsible teams, members and duty schedules.

Exit gate: hierarchy constraints, duplicate codes, inactive filtering and scope-restricted CRUD tests pass.

## Phase 4 — issue reporting

- Implement database-driven location/category/problem cascade.
- Implement duplicate candidates and explicit subscribe/create-different behavior.
- Implement transactional issue numbering, routing snapshot, SLA deadlines, history and in-app notification outbox.
- Implement issue workflow commands, comments, verification/reopen and immutable histories.
- Implement signed S3 uploads with MIME/extension/size checks and attachment metadata.
- Build responsive report wizard, queues, detail timeline and role dashboards.

Exit gate: the mandatory Room 101 electrical scenario passes through issue creation and assignment with no disconnected UI actions.

## Phase 5 — routing, SLA and notifications

- Implement deterministic routing specificity/priority/duty/workload ranking and fallback assignment.
- Implement configurable SLA/business hours and idempotent escalation jobs.
- Implement BullMQ outbox workers, attempts, retry/backoff, failed-job administration and provider interfaces.
- Implement Firebase push adapter and WhatsApp Cloud adapter/webhook verification behind feature flags.

Exit gate: provider failures never roll back issues; retries/failed state are observable; fallback status is truthful.

## Phase 6 — attendance integration

- Import legacy students/attendance through validated mappings.
- Implement subject/class assignments, attendance drafts, idempotent submission, locking and record uniqueness.
- Implement correction request/approval with immutable before/after history.
- Build student/faculty/coordinator/HOD/college views and scoped exports.

Exit gate: legacy sample counts reconcile; faculty/class/HOD boundaries and correction history tests pass.

## Phase 7 — messenger and announcements

- Implement scoped conversations/participants/messages/read receipts/attachments and moderation reports.
- Add Socket.IO authorization, room membership checks, delivery/read/typing events and reconnect recovery.
- Synchronize official groups from academic/role assignments.
- Implement targeted/scheduled announcements and acknowledgement.

Exit gate: unauthorized users cannot join or query conversations; private content is not exposed through admin list endpoints.

## Phase 8 — reports and administration

- Implement permission-filtered global search, dashboards and queued CSV/PDF exports.
- Implement notification center/preferences, audit viewer, settings, integration/failed-job and system-health pages.
- Complete administration pages for every configurable master/rule/SLA/template.

Exit gate: every export/query is scope-filtered and representative/HOD/maintenance negative tests pass.

## Phase 9 — hardening, testing and deployment

- Complete unit, integration and Playwright E2E suites.
- Add CSP/security headers, CORS/CSRF verification, upload abuse tests, dependency scanning and secret scanning.
- Validate production Docker builds, migrations, seed, backup and restore.
- Complete operator/user/integration documentation and final delivery report.

Exit gate: all Definition of Done checks have command evidence in `FINAL_DELIVERY_REPORT.md`; remaining limitations are explicitly identified and not represented as complete.

## Migration and release sequence

1. Export and checksum browser-local legacy data.
2. Back up PostgreSQL and object storage.
3. Apply additive migrations.
4. Seed roles/permissions/configuration only; never seed development credentials in production.
5. Import legacy data in preview then transactional commit mode.
6. Reconcile totals and sample attendance records.
7. Deploy API/workers, then web.
8. Run smoke/E2E/health checks.
9. Keep legacy app read-only for the agreed acceptance window.

## Testing strategy

- Unit: policy, routing, SLA, workflow, validation and provider adapters.
- API integration: PostgreSQL constraints, transactions, auth/session rotation, scopes and idempotency.
- Web component: forms, cascade selectors, permission states and offline drafts.
- E2E: mandatory administrator/student/electrician/verifier issue journey plus all negative authorization cases.
- Operations: empty/upgrade migrations, queue retry, object signed URL, backup/restore and container health.
