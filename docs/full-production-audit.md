# AVS College Management System — Full Production Audit

Audit date: 2026-08-01  
Repository: `https://github.com/devanand2008/AVSEC-ISSUES`  
Local workspace: `D:\COLLEGE MANAGEMENT SITE`

This audit describes the active Next.js/NestJS product. The untracked legacy,
Flutter, worker-demo, logs, and learning-prototype directories were inspected as
repository clutter but were not treated as the production PWA.

## Canonical architecture

| Concern | Actual implementation |
|---|---|
| Frontend | `apps/web`, workspace `@college/web`, Next.js 16 App Router, React 19 |
| Backend | `apps/api`, workspace `@college/api`, NestJS 11 |
| Database | PostgreSQL through Prisma 7 |
| Prisma schema | `apps/api/prisma/schema.prisma` |
| Generated client | `apps/api/src/generated/prisma` |
| Monorepo | npm workspaces under `apps/*` and `packages/*` |
| State/data fetching | TanStack React Query and provider-local React state |
| CSS/UI | AVS CSS tokens and reusable custom components; Lucide icons |
| Realtime | NestJS/Socket.IO gateway with `socket.io-client` |
| QR scanner | `html5-qrcode` |
| File storage | Backend private-storage abstraction plus a dedicated Google Drive OAuth provider |
| WhatsApp | Meta Graph API delivery in the backend delivery module |
| PWA | `manifest.webmanifest`, install icons, registration component, and privacy-safe service worker |
| Timezone | Server configuration defaults to `Asia/Kolkata` |

## Current project structure

- `apps/web`: 92 App Router page files, PWA assets, role-aware navigation,
  responsive shell, feature pages, Vitest tests, and Playwright journeys.
- `apps/api`: 23 domain module directories covering access, academic data,
  authentication, people, campus, attendance, announcements, conversations,
  issues, maintenance routing, feedback/QR, learning/skills, AI, storage,
  Google Drive, encrypted backups, notifications/delivery, reports, imports,
  data maintenance, and audit.
- `apps/api/prisma`: 140 models, 55 enums, 37 migration directories, and the
  development seed.
- `packages/shared-types`, `packages/validation`: shared contracts and runtime
  validation.
- `docs`, `scripts`: deployment, recovery, security, import, backup, and
  verification material.

The existing npm-workspace layout is already canonical and was retained. Moving
the working application solely to match a suggested folder tree would introduce
deployment and import risk without improving runtime behavior.

## Implemented product coverage

- Authentication, forced temporary-password change, first-login/profile gates,
  password reset, suspended/archived states, cookie sessions, CSRF, throttling,
  and permission guards are implemented.
- People has server search/filter/pagination, responsive table/cards, archive,
  restore, dependency analysis, session revocation, anonymisation, and audit.
  Permanent anonymisation now requires a real completed same-college backup;
  the API does not trust the browser-provided backup reference.
- Campus and academics support hierarchy management, archive/test-data flags,
  dependency checks, academic assignments, and capacity. Section capacity is
  constrained to at most 70 by DTO validation and transaction/advisory-lock
  checks prevent a concurrent 71st active student.
- Attendance includes sessions, records, summaries, corrections, staff data,
  interventions, imports/exports, responsive focus mode, and expiring local
  drafts. PostgreSQL remains authoritative.
- Announcements support custom titles, categories, images, audience delivery,
  display/view/acknowledgement receipts, and dashboard/modal presentation.
- Messenger provides realtime conversations and atomic attachment workflows;
  database state is not marked sent before attachment completion.
- Issues implement opaque public references, repeated-report linking,
  occurrences, affected reporters, assignments, status history, evidence,
  resolution, reporter verification/reopen, SLA timestamps, and escalation.
- Feedback uses opaque tokens, backend target derivation, deep-link pages,
  manual/camera/image scanner states, QR administration, and scoped analytics.
- AVS Learn/Skill and AVS Bot routes/services exist. Bot configuration and keys
  are backend-only, with safety, authorization, context, and idempotency tests.
- Google Drive contains OAuth, encrypted token persistence, private hierarchy,
  resumable upload/download, retry, checksum, owner verification, and admin UI.
- Backups implement `pg_dump`/`pg_restore`, authenticated encryption, manifests,
  checksums, retention, Drive upload, scheduling, and restore-test records.
- The PWA service worker caches only public shell/static assets; authenticated
  pages and route payloads are deliberately network-only to avoid cross-user
  cache leakage.

## Role and navigation audit

The dashboard resolver now has explicit precedence for Main/Academic Admin,
Principal, Vice Principal, HOD, Faculty/Class Coordinator, Student/Class
Representative, all maintenance specialist roles, and general staff. Unknown or
general staff never fall through to a Student dashboard. Leadership, HOD,
Faculty, Student, Maintenance, Staff, and Admin presentations are distinct and
use scoped backend metrics rather than hardcoded counts.

Module navigation is filtered by both role and permission. The API remains the
security boundary; hiding a link is not used as authorization.

## Errors found and remediated in this audit

- Repaired an incomplete dependency installation with `npm ci --include=dev`.
- Removed duplicate `UsersService` dependency/deletion implementations. The
  retained flow preserves shared attendance/messages/issues while clearing
  personal data.
- Corrected Prisma field mismatches for guardian contact, address, normalized
  email, and profile photo data.
- Added service-level Main Admin permission and self-delete checks.
- Replaced fabricated deletion-backup UI values with completed backup records
  and added same-college backend verification.
- Corrected People pagination to use response metadata and wired the department
  filter to the server.
- Corrected Suspend/Archive/Restore so each sends the intended account status.
- Fixed Campus optional-code search, shared component prop mismatches, missing
  announcement import, undefined-safe avatar/action helpers, and debounce state.
- Removed hardcoded Faculty dashboard counts and fixed role dashboard fallthrough.
- Cleared all strict TypeScript and ESLint failures without `any` suppression or
  disabling rules.

## Broken or incomplete features

- Live Playwright E2E is blocked on this workstation: Docker Desktop is not
  installed, no PostgreSQL or Redis service is installed/listening, and the
  suite requires seeded fake accounts. This audit does not claim E2E passed.
- Google Drive OAuth, WhatsApp, OpenAI, and external notification delivery cannot
  be exercised here because their environment values are not configured. Unit
  and provider-contract tests pass, but production-provider acceptance remains.
- Student and Faculty dashboard APIs currently expose scoped operational issue
  metrics, not the full timetable/attendance/assignment aggregation requested
  by the master brief. Their pages link to the complete modules, but richer
  dashboard summary endpoints remain desirable.
- Physical phone camera, install prompt, push notification, and HTTPS deep-link
  behavior require testing on the final public origin.
- A real restore into a temporary PostgreSQL database was not executed in this
  audit because PostgreSQL tools/service are unavailable locally.

## Missing or partial reusable UI

The repository has reusable shell, headers, status/role badges, avatars, stats,
search, filter sheet, dialogs, skeletons, empty/error states, QR components, and
toasts. Some items named in the brief are still implemented inside feature pages
rather than as standalone shared components: responsive data table/mobile data
card, searchable select, upload-progress primitive, image/document viewers,
timeline, and pagination. Consolidating those is maintainability work, not a
current build blocker.

## TypeScript, Prisma, build, and test status

After remediation on 2026-08-01:

- Prisma validation: passed.
- Prisma generation: passed with Prisma Client 7.9.1.
- API strict typecheck: passed.
- Web strict typecheck: passed.
- Workspace lint with zero warnings: passed.
- NestJS production build: passed.
- Next.js production build: passed; 83 routes were generated after the final
  dashboard additions.
- API tests: 50 suites / 373 tests passed.
- Web tests: 12 files / 65 tests passed after dashboard-role coverage was added.
- Sensitive-file preflight: passed.
- Production npm dependency audit: zero vulnerabilities.

## Duplicate and unused material

- Root contains old runtime logs and repeated guides also present under `docs/`.
- `legacy/`, `learn language/`, `worker management system2/`, and
  `apps/flutter_app/` are outside the active PWA build. They materially enlarge
  search, install, and audit scope.
- These directories may contain user/reference material, so this audit did not
  delete them. A separate, approved archival cleanup should move them outside
  the production repository after ownership is confirmed.

## Mock data and local persistence

- `apps/api/prisma/seed.ts` intentionally creates clearly fake `.local` users,
  campus, feedback, and workflow records for development/E2E. It must not be run
  against a production tenant.
- No dashboard counts are intentionally hardcoded after this audit.
- `localStorage` is used only for non-secret login hints and expiring unsent
  attendance/issue drafts. PostgreSQL remains the permanent source of truth.

## Hardcoded URLs and credentials

- Frontend and socket clients have localhost development fallbacks. Production
  origins are environment-driven and CSP-connected origins are generated from
  configuration.
- Development seed email addresses are fake and passwords are environment-driven.
- No tracked secret or private key was found. Secret values are deliberately not
  reproduced in this document.

## Mobile and accessibility risks

- Responsive shell, mobile bottom navigation, cards, focus attendance mode,
  filter sheets, safe-area handling, touch sizing, focus CSS, skip behavior, and
  semantic labels exist.
- Static inspection and component tests cannot prove no clipping/overflow at all
  required viewports. The 320–1440 px matrix remains a Playwright/device gate.
- No automated axe/WCAG browser report was produced in this environment. Final
  keyboard, screen-reader, contrast, zoom, dialog focus, and live-region checks
  remain acceptance work.

## Performance risks

- Large record domains use server-side pagination and scoped database queries;
  dashboard counts are transactionally grouped and routes are App Router split.
- The application avoids caching authenticated pages in the service worker.
- No live database load/profile result was possible without PostgreSQL. Slow
  query logs, index hit rates, N+1 traces, upload queue throughput, and 95th/99th
  percentile latency must be measured against production-like data.

## Database and migration risks

- The schema has 37 migrations, including recent AI, maintenance, profile,
  announcement, and Google Drive/backup changes. Validation/generation proves
  schema correctness, not that a target production database has applied them.
- Run a pre-migration encrypted backup and `prisma migrate deploy` against a
  staging copy first. Then execute the restore test before production rollout.
- Permanent anonymisation depends on completed backup rows; Google Drive and
  backup configuration must be operational for Main Admin workflows.

## Storage risks

- Google Drive is disabled/unconfigured in the current local environment. OAuth
  redirect origin, owner account authorization, root folders, encryption key,
  quota, retries, and authorized downloads require staging acceptance.
- Do not expose raw Drive links and do not place PostgreSQL live data files in
  Drive. The code follows this boundary; deployment configuration must preserve it.

## Security risks

- Positive controls: CSRF, HttpOnly sessions, JWT/session guards, scoped access,
  explicit permissions, throttling, Helmet/CSP, structured error filtering,
  log redaction, opaque public IDs/tokens, encrypted Drive tokens/backups, and
  same-college deletion/backup checks.
- The CSP still allows inline scripts/styles required by the current Next.js/CSS
  setup. A nonce/hash-based CSP is a future hardening opportunity.
- Provider credentials, public HTTPS, database TLS, key rotation, restore drills,
  audit retention, and incident alerting are deployment responsibilities.

## Required implementation and release order

1. Provision staging PostgreSQL/Redis and apply all migrations after an encrypted backup.
2. Seed only the dedicated fake E2E tenant and run all Playwright desktop/mobile journeys.
3. Configure and authorize the expected Google Drive owner; verify private upload/download and restore test.
4. Exercise real WhatsApp, email, push, and OpenAI integrations with non-production recipients.
5. Complete physical-device PWA/camera/deep-link/accessibility testing on HTTPS.
6. Add richer role dashboard aggregate endpoints for timetable, attendance, people, and learning summaries.
7. Run load tests and database query profiling with production-scale synthetic data.
8. Archive duplicate/legacy material only after explicit owner approval.
9. Repeat security review, backup restore drill, and release checklist before production traffic.
