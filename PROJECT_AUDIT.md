# Project Audit

## 2026-07-19 Final Master Audit Update

Workspace scan covered the maintained `apps`, `packages` and `scripts` source
trees. Current audited source/config inventory includes 273 TypeScript,
JavaScript, JSON and CSS files outside generated/build folders.

Findings:

- Frontend: Next.js App Router, React 19, strict TypeScript, TanStack Query,
  PWA manifest/service worker, AVS logo/icon assets and responsive app shell.
- Backend: NestJS REST API, Prisma/PostgreSQL, Redis/BullMQ, MinIO/S3 storage,
  Socket.IO realtime, request IDs, compression, validation pipes, RBAC and scope
  guards.
- Database: 17 Prisma migrations are present through
  `20260719202000_issue_qr_source`.
- Authentication: Argon2id credentials, session/refresh-token tables,
  `must_change_password`, `password_changed_at` and `first_login_completed_at`
  are implemented.
- Attendance: attendance sessions, records, correction requests, change history,
  analytics and role-scoped views exist.
- Issues: location/category/problem issue reporting, optional attachments,
  status/assignment history, routing rules and QR-origin fields exist.
- Announcements: admin creation, audiences, recipients/read receipts, image
  attachments, delivery attempts, one-time modal component and analytics routes
  exist.
- QR/camera: `/scan-qr`, backend `/qr/validate`, `/qr/analytics`, room QR
  labels and feedback QR management exist.
- PWA: manifest, service worker, offline page and AVS icons exist.
- BAT files: old launchers were consolidated into `START_AVS_APP.bat`; the repo
  now contains exactly one `.bat` file.
- Data cleanup: guarded cleanup tooling exists, but no cleanup was run in this
  pass because a fresh database dump could not be created.
- Backup: verified source archive created at
  `D:\AVS_BACKUPS\final-master-20260719-212416\project-source.tar.gz`.
- Blocker: Docker CLI timed out and local `pg_dump` is unavailable, so a new DB
  dump could not be verified during this pass.

Audit date: 16 July 2026  
Workspace: `D:\COLLEGE MANAGEMENT SITE`  
Institution: AVS Engineering College  
Main Admin: Devanand

## Current Stack

| Area           | Finding                                                                              |
| -------------- | ------------------------------------------------------------------------------------ |
| Frontend       | Next.js App Router in `apps/web`, React 19, TypeScript, TanStack Query, PWA shell    |
| Backend        | NestJS in `apps/api`, REST API under `/api/v1`, Socket.IO realtime channel           |
| Database       | PostgreSQL 17 through Prisma; Docker Compose service `postgres`                      |
| Queue/cache    | Redis with BullMQ                                                                    |
| Object storage | MinIO private S3-compatible bucket                                                   |
| Authentication | Argon2id password hashes, access/refresh cookies, CSRF/origin checks, session tables |
| Authorization  | Backend RBAC plus college/department/class/location/assignment scopes                |
| Runtime        | Docker Compose services: web, api, postgres, redis, minio                            |

## Modules Found

- Authentication, password change/reset, sessions and role guards.
- Main Admin dashboards, users, roles and permissions.
- Academic/campus master data: departments, programmes, sections, blocks, floors, rooms, subjects.
- Attendance sessions, records, correction flow, history and CSV export.
- Campus issue reporting with location/category/problem/asset routing, status histories and assignments.
- Messaging, conversations, announcements, notifications and delivery attempts.
- Bulk import, exports, audit logs, operations, settings and system health.

## Data Audit

Fresh backups were created before cleanup:

- Database: `backups\college-20260716-200538.dump`
- Project archive: `backups\project-20260716-200333.tar.gz`

Confirmed cleanup removed the known development seed identities, fake issues, fake announcements, seeded attendance records, notification recipients and demo delivery attempts. A duplicate non-admin Devanand test/student account was also removed after the confirmed cleanup.

Current database counts after cleanup:

| Table               | Count |
| ------------------- | ----: |
| users               |     1 |
| roles               |    18 |
| departments         |     3 |
| programmes          |     1 |
| sections            |     2 |
| rooms               |    18 |
| issues              |     0 |
| attendance_sessions |     1 |
| attendance_records  |     0 |
| announcements       |     0 |
| conversations       |    10 |
| messages            |     1 |

The configured Main Admin was the only user, with status `ACTIVE` and `must_change_password=false`; its identity is intentionally omitted. The remaining conversations are official department/class/team channels, plus one admin-created direct welcome message; they were not part of the confirmed demo signature. Master campus/academic rows were retained because they are operational structure, not disposable fake records.

## Security Findings

- API listens on `0.0.0.0` inside the container, but host exposure defaults to `127.0.0.1` unless the LAN runner sets `API_BIND_ADDRESS=0.0.0.0`.
- Database, Redis and MinIO ports remain bound to `127.0.0.1` in `docker-compose.yml`.
- CORS is now an allowlist built from `CORS_ALLOWED_ORIGINS` and `WEB_URL`.
- `.env.example` contains placeholders only; real secrets must stay in local `.env` or secret storage.
- Audit rows are append-protected by database triggers; cleanup had to explicitly preserve audit history while detaching removed demo actors.

## Performance Findings

- The maintained app already uses paginated/scoped API access rather than static dashboard values.
- Logo assets are optimized under `apps/web/public/images` and `apps/web/public/icons`.
- Docker health checks are enabled for API, web, PostgreSQL, Redis and MinIO.
- Heavy provider integrations are optional and do not block authoritative database writes when disabled.

## Mobile and UI Findings

- The app shell has a responsive sidebar, mobile header and bottom navigation.
- Previous sidebar/scroll fixes were applied so the admin navigation scrolls independently instead of blocking content.
- `START_AVS_APP.bat` starts web/API for LAN testing on `0.0.0.0`, detects the current IPv4 address and prints the phone URL.

## Preserved Features

The cleanup preserved Main Admin identity, roles, permissions, audit infrastructure, database migrations, master data, attendance implementation, issue routing, communication modules, settings and provider configuration.
