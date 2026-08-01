# AVS College Management System Production Test Plan

## 1. Document control

| Field | Value |
|---|---|
| Test date | 2026-07-29 |
| System | AVS College Management System |
| Baseline commit | `2a711ccb83c64e349bb064d5a18401d745399df4` |
| Tested source state | Baseline commit plus the uncommitted working-tree changes present during testing |
| Actual web workspace | `@college/web` |
| Test owner | Independent Codex QA execution |

This plan applies the production testing master prompt without weakening requirements. A skipped test is never counted as passed. Only clearly fake accounts under `@college.local` or `@college.test` and records labelled as QA/E2E data may be used.

## 2. Objectives

1. Prove that dependencies install reproducibly and that Prisma, API, and PWA builds pass.
2. Verify authentication, authorization, data integrity, deletion safety, uploads, issue workflows, QR/feedback routing, messaging, learning, imports, PWA behavior, responsive behavior, and backup/restore controls.
3. Test security controls and scan tracked source and built web artifacts for embedded secrets.
4. measure a local latency baseline and run the realistic-volume load profile only in an isolated load environment.
5. Produce an evidence-based release decision. Approval is prohibited while a blocker or critical issue exists, while a required release gate fails, or while required production evidence is unavailable.

## 3. Environments and browsers

| Environment | Planned use | Required evidence |
|---|---|---|
| Local development | Unit/integration tests, API behavior, fake data | Command exits and assertion counts |
| Local production build | Optimized NestJS and Next.js builds | Successful compiler exits and route table |
| Local Docker stack | PostgreSQL, Redis, MinIO, API, web browser tests | Healthy services and real HTTP responses |
| Staging | Deployment, integrations, migration, UAT | Staging URL, deployment version, provider sandboxes |
| Production-like HTTPS | camera, secure cookies, deep links, PWA | Trusted HTTPS URL and device/browser evidence |
| Installed PWA | install/update/offline/deep-link behavior | Native installation on a non-incognito browser |

Browser matrix:

- Google Chrome desktop.
- Mobile Chrome using a Pixel 7 browser profile; repeat critical camera/install tests on a physical device.
- Microsoft Edge desktop.
- Firefox desktop.
- Viewports: `320x568`, `360x800`, `375x812`, `390x844`, `412x915`, `768x1024`, `1024x768`, and `1440x900`.

## 4. Test identities and data controls

The local E2E setup may create `codex.qa.admin@college.test` and use existing `student@college.local` and `electrician@college.local` seed fixtures. The QA administrator must be archived, its credential randomized, and its sessions revoked after execution. Seed fixture credentials must be restored from the current local development configuration and their test sessions revoked.

Campus, academic, announcement, issue, message, QR, feedback, import, and learning records must use a `Codex`, `QA`, `Playwright`, `.local`, or `.test` marker. No production password, mailbox password, student export, provider token, or real personal data may be used.

## 5. Entry criteria

- Repository and intended commit are identified.
- Node.js and npm meet the root package engine range.
- PostgreSQL, Redis, and object storage are available for integration tests.
- Required fake roles and seed data exist or can be safely provisioned.
- A backup path is writable.
- Staging, HTTPS, browser, device, and provider credentials are explicitly supplied before those tests are attempted.

## 6. Release gates

Run and retain the exit status for:

```text
npm ci --include=dev
npx prisma validate --schema=apps/api/prisma/schema.prisma
npx prisma generate --schema=apps/api/prisma/schema.prisma
npm exec --workspace=@college/api -- prisma migrate status
npm run build --workspace=@college/api
npm run build --workspace=@college/web
npm run typecheck
npm run lint
npm test
npm run test:e2e --workspace=@college/web
npm run security:check
npm run audit:production
npm run env:validate:production
```

The E2E suite must use one worker because its tests intentionally share mutable fake users and one database. Concurrency safety is tested separately at the service/database layer.

## 7. Functional coverage

| Area | Planned coverage |
|---|---|
| Authentication | valid/invalid/unknown/suspended/archived/temp-password login, first-login change, refresh rotation, logout, logout-all, expiry, reset, rate limit, log/response redaction |
| Permissions | all named roles, cross-role API denial, department/section scope, permanent-delete permission |
| Profiles | view/edit/draft/photo/delete/submit/verify/reject/correct/change password; immutable official fields |
| People | search/filter/page/view/edit/role/status/archive/restore; dependency report and permanent-delete safeguards |
| Campus | campus/block/floor/room CRUD, archive/restore, dependency protection, test-data filtering and cleanup |
| Academics | department/program/year/semester/section/subject and role assignments; 70-student limit and concurrent 71st rejection |
| Attendance | time windows, override, class/period/subject modes, correction/history/percentage/low attendance, XLSX import/export and invariants |
| Announcements | custom and Unicode titles, exact rendering, search/filter, legacy title, XSS rejection |
| Messenger | text/image/multi-image/PDF, reply/react/edit/delete/read/typing/reconnect/retry, persistence, attachment authorization |
| Issues | database categories, reporting/routing/notification, repeated-issue deduplication, public number, location and reporter visibility |
| Maintenance | assignment through finish, authorization, timeline revision/history/timezone, overdue escalation deduplication, completion photo and reporter verification |
| WhatsApp | sandbox delivery for assignment, repeat, timeline, overdue, completion, reopen; failure isolation and data minimization |
| QR and feedback | secure URL-only QR, valid/invalid/expired/revoked/repeated scans, camera controls, deep-link refresh, target integrity, ratings/privacy/analytics |
| AVS Learn/Skill/Bot | scoped resources, courses/progress/quiz/certificate, provider-backed compiler, role-scoped AI responses and secret isolation |
| Imports | multi-sheet/header/year detection, numeric passwords, duplicates, invalid rows, dry-run/batch/rollback/report, formula injection |
| PWA/responsive | manifest/icons/service worker/offline shell/install/update/push/camera/deep links, required routes after refresh, eight viewports |
| Security | IDOR, XSS, injection, JWT tampering, refresh expiry, role bypass, upload abuse, QR guessing, CORS, throttling, source/build secret scan, dependency audit |
| Backup/delete | checksum backup, isolated restore, dependency report, reason/confirmation/audit requirements, real-data protection |
| Performance | named endpoint latency plus required record volumes, concurrency, slow-query inspection, index remediation |

## 8. Data integrity and destructive-test procedure

1. Create and checksum a fresh PostgreSQL custom-format backup.
2. Generate the dependency report before attempting permanent deletion.
3. Confirm the target is clearly fake and archived.
4. Require the exact confirmation phrase, a reason, and a backup reference.
5. Verify the audit record and retained-history behavior.
6. Test restoration only in a uniquely named temporary database unless explicit approval is given to overwrite another database.
7. Confirm the temporary database did not pre-exist, validate restored counts, then remove only that temporary database.

## 9. Performance method

The realistic-volume test requires an isolated database populated with at least 2,000 users, 100 sections, 50,000 attendance records, 10,000 messages, 5,000 issues, and 5,000 feedback records. Record p50, p95, p99, maximum latency, error rate, throughput, CPU, memory, and slow SQL for dashboard, people, attendance, issues, message pagination, QR resolve, feedback submit, upload, and report generation.

A small local dataset may be used only for a smoke baseline and must be labelled as non-representative.

## 10. Severity and exit criteria

| Severity | Definition |
|---|---|
| BLOCKER | Testing/deployment cannot proceed or critical data is endangered |
| CRITICAL | exploitable authentication/authorization/data-loss/secret issue or a master-prompt release-block condition |
| HIGH | release-gate failure or serious security/reliability problem requiring remediation before release |
| MEDIUM | important functional/reliability/accessibility defect with a workaround |
| LOW | minor usability, observability, or cosmetic defect |

Production approval requires passing Prisma/API/web builds, critical automated tests, secret scanning, production configuration, staging/HTTPS/PWA/device checks, provider-sandbox checks, and high-volume performance testing, with no unresolved blocker or critical issue and no unaccepted release-gate failure.

