# AVS College Management System Production Release Checklist

## Release state

**Current decision: BLOCKED — production approval is NO.**

The checklist reflects the test execution dated 2026-07-29 against commit `2a711ccb83c64e349bb064d5a18401d745399df4` plus the then-current working tree.

## 1. Source and build

- [x] Commit baseline recorded.
- [ ] Exact release source is committed and the working tree is clean.
- [x] `npm ci --include=dev` completed successfully.
- [x] Prisma schema validates.
- [x] Prisma Client generates.
- [x] Migration status reports the local database up to date.
- [x] NestJS API build passes.
- [x] `@college/web` optimized PWA build passes.
- [x] Flutter 3.44.8 analysis passes with no issues.
- [x] Flutter tests pass: 7/7.
- [x] Flutter web release artifact builds.
- [ ] Android APK/AAB builds with a complete Android SDK and release signing configuration.
- [x] Workspace typecheck passes.
- [x] Workspace lint passes with zero warnings.
- [x] Unit/integration tests pass: API 323/323; web 35/35.
- [x] Final serialized Playwright suite passes: 20 passed, 2 intentional skips.

## 2. Security

- [x] Tracked-source and built-web secret scan passes.
- [x] No real student password or production personal data was used.
- [x] Fake QA credentials were disabled/removed from temporary tooling after use.
- [x] Temporary QA admin is archived and sessions are revoked.
- [x] Core RBAC/IDOR/JWT/upload/QR/input-hardening automated tests pass.
- [x] Production dependency audit passes: 0 vulnerabilities.
- [x] The stale npm-registry SheetJS release is replaced with the supported SheetJS distribution.
- [ ] Production secrets are rotated and validated in the deployment environment.
- [ ] Production CORS, secure cookies, HSTS, CSP, and rate limits are verified through HTTPS.

## 3. Database, backup, and deletion

- [x] Fresh custom-format database backup created.
- [x] SHA-256 sidecar matches the backup.
- [x] Backup restored successfully into a separate temporary database.
- [x] Restored user and migration-history counts were queried.
- [x] Only the uniquely created temporary restore database was removed.
- [x] Automated dependency-report/archive/confirmation/reason/audit safeguards pass.
- [ ] A release-time backup is created immediately before production migration/deletion.
- [ ] Production restore runbook is rehearsed by the authorized operations owner.
- [ ] Test-data cleanup is run in staging with a reviewed dependency report.

## 4. Functional acceptance

- [x] Fake student login and admin-route denial pass.
- [x] Live issue creation, attachment, assignment, completion evidence, reporter verification, and close pass.
- [x] Attendance, escalation, repeated issue, timeline, QR, feedback, imports, AI safety, and authorization automated suites pass.
- [x] Live mobile messenger text/image flow passes with successful API responses and transport-safe attachment metadata.
- [x] Live Skill catalog/progress/assessment/compiler/certificate flow passes in the final serial suite.
- [ ] Full profile submit/reject/correct/photo workflow passes in staging.
- [ ] Full People and Campus CRUD/archive/restore/safe-cleanup workflow passes in staging.
- [ ] All announcement titles render exactly on every relevant live dashboard.
- [ ] Complete messenger PDF/multi-image/reply/react/edit/delete/reconnect/retry matrix passes.
- [ ] All QR target types and real HTTPS deep links pass.
- [ ] Faculty Learn PDF publish/unpublish/wrong-section/release-date flow passes.
- [ ] Complete 45-step acceptance flow passes uninterrupted on staging.

## 5. PWA, browsers, and responsive design

- [x] Manifest has no errors.
- [x] Required PNG icons and maskable icon entry exist.
- [x] Service worker registers and activates at root scope.
- [x] Install affordance is visible and fits mobile screens.
- [x] Required eight-viewport audit passes with no horizontal or field overflow.
- [x] People table switches to cards on mobile.
- [x] Audited mobile interactive targets are at least 40 px.
- [x] Desktop Chrome and Mobile Chrome emulation pass.
- [ ] Flutter Android artifact is installed and exercised on a physical Android device.
- [ ] Edge passes.
- [ ] Firefox passes.
- [ ] Physical Mobile Chrome camera/permission/scanner flow passes over HTTPS.
- [ ] Native PWA install, update, offline shell, push permission, and deep links pass.
- [ ] All required routes refresh successfully from the deployed HTTPS origin.

## 6. Integrations and configuration

- [ ] `npm run env:validate:production` passes against the release environment.
- [ ] API runs with `NODE_ENV=production`. **Current local API reports development.**
- [ ] Staging deployment URL and deployed version are recorded.
- [ ] Trusted production-like HTTPS environment is available.
- [ ] WhatsApp sandbox assignment/repeat/timeline/overdue/completion/reopen tests pass.
- [ ] WhatsApp failures persist delivery status without losing issue data.
- [ ] Firebase/push delivery is tested without exposing keys.
- [x] Online compiler calls have a 26-second total budget, provider fallback, and bounded transient retries.
- [ ] Online compiler providers have monitoring, circuit-breaker behavior, and a release-test sandbox.

## 7. Performance

- [x] Small-data latency smoke completes with HTTP 200 responses.
- [ ] Dataset contains at least 2,000 users and 100 sections.
- [ ] Dataset contains at least 50,000 attendance records.
- [ ] Dataset contains at least 10,000 messages.
- [ ] Dataset contains at least 5,000 issues.
- [ ] Dataset contains at least 5,000 feedback records.
- [ ] Dashboard, People, Attendance, Issues, Messages, QR, Feedback, upload, and report load tests pass.
- [ ] p50/p95/p99, throughput, error rate, CPU, memory, and slow SQL are recorded.
- [ ] Required indexes are added and their query plans are verified.

## 8. Required sign-off

- [ ] QA lead confirms no skipped test is reported as passed.
- [ ] Security owner accepts the dependency scan.
- [ ] Database owner accepts migration, backup, and restore evidence.
- [ ] Product owner accepts staging UAT.
- [ ] Operations owner confirms monitoring, alerting, rollback, and provider credentials.
- [ ] All BLOCKER and CRITICAL issues are closed.
- [ ] All release-gate HIGH issues are closed or formally accepted by authorized owners.
- [ ] Final release decision is changed from BLOCKED to APPROVED by an authorized human approver.

## Blocking actions

1. Provide a valid production configuration and trusted HTTPS staging deployment.
2. Complete the Android SDK/signing setup, native Flutter artifact build, Edge, Firefox, physical camera, installed-PWA, WhatsApp sandbox, and realistic-volume performance tests.
3. Execute the full uninterrupted acceptance workflow on the exact staged release artifact.
