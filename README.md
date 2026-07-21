# AVS Engineering College Campus Management System

This repository contains the AVS Engineering College campus management system for identity and scoped administration, attendance, campus issue routing, internal messaging, announcements, notifications, reporting, and bulk data onboarding. The maintained application is the npm workspace under `apps/` and `packages/`; the root Vite files are retained only as legacy reference material.

## Architecture

- `apps/web`: Next.js App Router, React, strict TypeScript, TanStack Query, responsive PWA shell.
- `apps/api`: NestJS REST API, Prisma/PostgreSQL, Argon2id authentication, permission/scope guards, BullMQ, private S3 uploads, Firebase Admin, and WhatsApp Cloud adapters.
- `packages/shared-types`, `packages/validation`: shared TypeScript contracts and validation.
- PostgreSQL is authoritative. Redis backs queues. MinIO is the local private S3-compatible store.

## Local installation

Requirements: Node.js 22+, npm 10+, Docker Desktop, and Docker Compose.

```powershell
Copy-Item .env.example .env
npm install
docker compose up -d postgres redis minio minio-init
npm run prisma:generate
npm run prisma:deploy
npm run seed
npm run dev
```

Replace every example secret before starting. Local defaults use PostgreSQL port `55432` and Redis port `56379` to avoid common host collisions. Open the web app at `http://localhost:3000`, the API at `http://localhost:4000/api/v1`, and development Swagger at `http://localhost:4000/api/docs`.

On Windows, use `START_AVS_APP.bat` for the main local/LAN startup. It checks Node.js/npm/Docker, starts the Docker web/API stack, detects the computer's LAN IPv4 address, prints the desktop URL, prints the mobile URL, and shows a QR code when possible. The default desktop URL is `http://localhost:3000`; phones on the same Wi-Fi use the displayed `http://LAN-IP:3000` URL. Run `START_AVS_APP.bat --check` for a non-destructive preflight.

The local Main Admin login is `deva1253@college.com` with college code `6201` and password `deva1253`; the account is named Devanand. The current cleaned local database keeps this account active with `must_change_password=false`, so the password-change page should not repeat on every login. Seed accounts use `DEVELOPMENT_ADMIN_PASSWORD`. Set `DEVELOPMENT_RESET_ADMIN_PASSWORD=true` only when you want seeding to overwrite the existing admin password, and set `DEVELOPMENT_ADMIN_MUST_CHANGE_PASSWORD=true` only when you want to force the change-password screen. Development seeding is blocked in production unless explicitly allowed.

## Data cleanup

A safe cleanup tool removes confirmed demo/sample data after a verified backup:

```powershell
npm run cleanup:data -- --dry-run
npm run cleanup:data -- --confirm --backup-file "D:\COLLEGE MANAGEMENT SITE\backups\college-20260716-200538.dump"
```

The latest cleanup preserved Devanand's Main Admin account and reduced targeted demo users/issues/announcements/attendance records to zero. See `DATA_CLEANUP_REPORT.md`.

## Implemented workflows

- Multi-role users, editable permission grants, typed college/location/academic scopes, session revocation, and server-enforced tenant predicates.
- Attendance session creation from valid faculty assignments, autosaved drafts, complete-roster submission, idempotency, correction approval/rejection, locks, histories, and scoped CSV export.
- Five-step issue reporting with QR/location prefill, optional room asset, duplicate handling, private evidence, deterministic routing, working-hours SLA, escalation, responsible-person workflow, reporter verification, and audit history.
- Participant-scoped direct and official conversations with search, read state, mute/pin, replies, edit/delete windows, reactions, private attachments, reporting, and an audited moderator queue.
- Audience-scoped announcements, in-app notifications, encrypted browser device registration, Firebase push delivery, WhatsApp template delivery, signed webhook reconciliation, and operator retry/resolve controls.
- CSV/XLSX preview-confirm imports for users, students, staff, academic/location masters, assets, responsible persons, and routing rules. Jobs retain checksums, row outcomes, progress, result JSON, and guarded rollback.
- Scoped dashboard/search, QR label sheets, CSV exports, integration settings, dependency readiness, tenant audit viewer, and failed-job operations UI.

## Private files

Issue and message files use short-lived signed upload/download URLs. Completion rechecks object size and content type, validates file signatures, computes SHA-256, and can call a fail-closed malware scanner when `MALWARE_SCAN_ENABLED=true`. The bucket must remain private.

## External providers

See `FIREBASE_SETUP.md`, `WHATSAPP_SETUP.md`, and `.env.example`. Provider credentials are optional: authoritative database writes and in-app notifications continue when external delivery is disabled. Live provider behavior still requires the institution's Firebase and Meta test/production projects.

## Quality commands

```powershell
npm run check
npm run test:e2e
npm run audit:production
```

`npm run check` validates Prisma, strict types, lint, tests, and production builds. Playwright requires a migrated, seeded PostgreSQL/Redis/MinIO stack plus running API and web services.

GitHub Actions repeats the locked install, production environment policy check, quality suite, dependency audit, both Compose renders, and production image build. Local production releases use `docker-compose.production.yml`; do not deploy the development Compose model by itself.

## Deployment and operations

Read `DEPLOYMENT.md`, `BACKUP_RESTORE.md`, `MOBILE_LAN_ACCESS.md`, and `FINAL_DELIVERY_REPORT.md`. Production requires TLS, strong secrets, exact CORS/origin configuration, secure cookies, a restricted database identity, Redis persistence, private object storage, reviewed migrations, backups, and provider webhook verification.

## Troubleshooting

- Port collision: change the host port variables in `.env` and keep service URLs consistent.
- Prisma cannot connect: start Docker Desktop and wait for PostgreSQL health.
- Signed upload fails: verify MinIO/S3 credentials, the private bucket, time synchronization, and configured size limits.
- Import remains queued: verify Redis and inspect `/admin/operations` for failed jobs.
- Push/WhatsApp is disabled: supply all documented provider credentials and inspect `/admin/settings` integration readiness.
