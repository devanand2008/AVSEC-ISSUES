# AVS College Management System Production Test Results

## 1. Executive result

| Field | Result |
|---|---|
| Test environment | Windows local workspace; Docker PostgreSQL/Redis/MinIO/API/web; HTTP localhost |
| Commit tested | `2a711ccb83c64e349bb064d5a18401d745399df4` plus the working-tree changes present on 2026-07-29 |
| Database migration | PASS — 35 migration directories; local database reported up to date |
| Frontend build | PASS — `@college/web`, Next.js 16.2.12, 81 generated pages |
| Backend build | PASS — `@college/api`, NestJS build |
| Release decision | **BLOCKED — NOT APPROVED FOR PRODUCTION** |
| Production approved | **NO** |

The local code/build/test baseline is green, including a zero-vulnerability production dependency audit and healthy Docker API/web services. Production approval remains blocked because no real production/staging HTTPS configuration was supplied and provider, physical-device, installed-PWA, and realistic-volume tests remain unverified.

## 2. Counted result

Counting method: unique final assertions/checks only. Failed preliminary runs that were fixed and rerun are documented separately rather than counted twice.

| Outcome | Count |
|---|---:|
| Total tests/checks | 481 |
| Passed | 454 |
| Failed | 1 |
| Skipped | 26 |

Composition:

- 358 unit/integration assertions: 323 API and 35 web — all passed.
- 7 Flutter widget/model assertions — all passed.
- 22 Playwright project cases — 20 passed, 2 intentional duplicate-project skips.
- 40 responsive route/viewport checks — all passed.
- 3 PWA viewport/asset checks — passed; native install is a separate skip.
- 12 small-dataset latency checks — passed as smoke only.
- 15 build/database/security/backup gates — 14 passed, 1 failed.
- 24 additional unavailable-environment/provider/load cases — skipped, not passed.

## 3. Environment evidence

| Environment/browser | Status | Evidence |
|---|---|---|
| Local development | PASS | Prisma, Jest, Vitest, lint, typecheck |
| Local optimized web build | PASS | direct and Docker Next.js builds |
| Local API build | PASS | NestJS build |
| Flutter analysis and tests | PASS | Flutter 3.44.8; no analyzer issues; 7/7 tests |
| Flutter web release build | PASS | `build/web` generated successfully |
| Android APK build | SKIPPED | local Android SDK contains command-line tools only; platforms/build-tools are unavailable |
| Local Docker browser stack | PASS/PARTIAL | healthy services; API container was actually `NODE_ENV=development` |
| Desktop Chrome | PASS | final Playwright suite |
| Mobile Chrome profile | PASS | Pixel 7 emulation and required viewport audit |
| Tablet layouts | PASS | `768x1024` and `1024x768` |
| Edge | SKIPPED | no Edge project executed |
| Firefox | SKIPPED | no Firefox project executed |
| Staging | SKIPPED | no staging URL/configuration supplied |
| Production | SKIPPED | no production access supplied |
| Production-like HTTPS | SKIPPED | tested site was HTTP localhost |
| Physical mobile camera | SKIPPED | permission-denied UI was simulated; no real device |
| Installed PWA | SKIPPED | headless Chrome is incognito and cannot prove native installation |

## 4. Build and release-gate evidence

| Gate | Result | Evidence |
|---|---|---|
| `npm ci --include=dev` | PASS | npm exit 0; post-install `npm ls` exit 0 |
| Prisma validate | PASS | schema valid |
| Prisma generate | PASS | Prisma Client 7.9.1 generated |
| Prisma migration status | PASS | 35 migrations; database up to date |
| API build | PASS | Nest build exit 0 |
| Web build | PASS | optimized compile, TypeScript, and 81 pages |
| Flutter analyze | PASS | no issues found |
| Flutter web release build | PASS | release artifact generated in `apps/flutter_app/build/web` |
| Android APK build | SKIPPED | incomplete local Android SDK; no app-code compiler error was reached |
| Typecheck | PASS | all workspaces |
| Lint | PASS | all workspaces; zero warnings |
| `npm test` | PASS | API 323/323; web 35/35 |
| Playwright final suite | PASS | 20 passed, 2 intentional skips, one worker |
| Secret scan | PASS | no tracked student data, embedded secrets, or private keys detected |
| Production dependency audit | PASS | `npm audit --omit=dev --audit-level=high`: 0 vulnerabilities |
| Production environment preflight | **FAIL** | local `.env` is not production; Docker API also reports development mode |
| Backup/checksum | PASS | 961,044-byte custom dump; SHA-256 matched |
| Isolated restore | PASS | restored 40 users and 37 migration-history rows to a temporary database; temporary database removed |

The backup evidence file is `backups/college-20260729-121915.dump` with its `.sha256` sidecar.

## 5. Functional result by required report area

| Area | Status | Evidence and limitation |
|---|---|---|
| Authentication | PASS/PARTIAL | lifecycle, logout, token timing, guards, fake student login and archived-user denial passed; live email reset delivery not exercised |
| Permissions | PASS | RBAC/access/guard tests passed; live student received 403 for admin users and attendance mutation |
| Profiles | PARTIAL | profile/storage validation and eight-viewport layout passed; full live reject/correct/photo cycle not executed |
| People | PARTIAL | service tests and live search/history/responsive UI passed; no live permanent deletion was performed |
| Campus | PARTIAL | safe-location and room-type tests passed; admin pages rendered; full fake hierarchy cleanup workflow not executed live |
| Delete safety | PASS (automated) | archive requirement, permission, confirmation phrase, dependency report, backup reference, audit behavior covered in service tests |
| Attendance | PASS (automated) | workflow/invariant/permission tests passed; live student mutation denied |
| Announcements | PASS/PARTIAL | Unicode/custom-title and announcement tests passed; exact title on every live dashboard was not executed |
| Messenger | PARTIAL | live mobile text/image send and navigation passed with successful API responses; BigInt attachment payloads are transport-safe; full PDF/multi-image/reaction/edit/reconnect matrix was not completed |
| Issues | PASS | live create, idempotent replay, location/category/type, assignment, attachment, authorization, completion, reporter verification, and close passed |
| Repeated issues | PASS (automated) | duplicate-subscription and issue-hardening tests passed |
| Maintenance | PASS/PARTIAL | live acknowledge/start/finish passed; all staff-role variants not exercised live |
| Timeline | PASS (automated) | workflow validation and timeline-related tests passed |
| Escalation | PASS (automated) | SLA, grace period, recipient, and deduplication tests passed |
| Completion | PASS | live finish required uploaded completion evidence and reached verification pending, then closed |
| WhatsApp | SKIPPED live | notification/WhatsApp unit tests passed; six provider-sandbox scenarios were unavailable |
| QR generation | PASS/PARTIAL | QR validation/poster and UI management tests passed; every requested target type was not generated live |
| QR scanner | PARTIAL | invalid/disabled/permission UX and routing passed; physical HTTPS camera scan was skipped |
| Feedback routing | PASS/PARTIAL | deep-link/helper/backend tests and browser routing passed; no production HTTPS refresh test |
| Feedback submission | PASS/PARTIAL | rating/target/privacy backend tests and browser flow passed; staging analytics/provider behavior not exercised |
| Learn | PARTIAL | learning service tests passed; faculty PDF publish/unpublish and wrong-section live flow not fully executed |
| Skill | PASS | live catalog, progress, assessment, certificate, and separate strict compiler-provider checks passed on desktop and mobile |
| AVS Bot | PASS/PARTIAL | AI context, safety, knowledge, idempotency, Responses API, and 4 Flutter bot widget tests passed; live external-provider role conversations were not run |
| Imports | PASS | 23 Excel/CSV cases including multi-sheet, numeric/leading-zero passwords, duplicate, formula, domain, limit, and credential export behavior passed |
| PWA | PARTIAL | manifest, icons, active service worker, install UI, secure localhost context, and route build passed; native install/offline/push/deep-link app launch skipped |
| Responsive design | PASS | all eight required sizes across five key routes had no horizontal/field overflow or page errors; People switched table/cards; mobile targets were at least 40 px |
| Security | PASS/PARTIAL | functional security, secret scan, and zero-vulnerability production dependency audit passed; production HTTPS configuration remains unverified |
| Performance | PARTIAL | small-data smoke passed; required volume/load profile skipped |
| Backup and restore | PASS | checksum backup and isolated temporary-database restoration passed |

## 6. Browser and responsive evidence

Final Playwright result:

```text
22 project cases using 1 worker
20 passed
2 skipped (desktop-only duplicate of mobile behavior and mobile duplicate of API lifecycle)
0 failed
Duration: 1.8 minutes
```

The single-worker setting is required because the E2E suite shares fake users and a mutable local database. A prior concurrent run produced non-deterministic login/client timing. A later transient compiler-provider fallback led to the bounded retry fix; the complete final serial suite and an additional response-verified attachment-send case passed.

Responsive result:

```text
320x568, 360x800, 375x812, 390x844, 412x915,
768x1024, 1024x768, 1440x900

Routes: /profile, /admin/users, /issues, /feedback/scanner, /learn
Horizontal overflow: 0
Field overflow: 0
Page errors: 0
People table/card switch failures: 0
Sub-40px mobile interactive targets: 0
```

## 7. PWA evidence

- Manifest loaded with no manifest errors.
- PNG icons exist at 192 and 512 pixels, including a maskable entry.
- Service worker registration was active with root scope.
- Install UI was visible and fit 320 px and 390 px screens.
- Chrome DevTools reported only `in-incognito` as an installability limitation.
- Native install, upgrade, push delivery, offline navigation, and installed-app deep links remain skipped.

## 8. Performance evidence

Available dataset:

```text
users=40
sections=2
attendance_records=5
messages=45
issues=12
feedback_submissions=0
```

Read-only small-data smoke:

| Operation | Result |
|---|---|
| People search API | 200; p50 56 ms; max 93 ms |
| Attendance list API | 200; p50 26 ms; max 36 ms |
| Issue list API | 200; p50 27 ms; max 30 ms |
| Message list API | 200; p50 29 ms; max 39 ms |
| Learn catalog API | 200; p50 43 ms; max 53 ms |
| Authenticated web routes | 200; DOM content loaded 71–519 ms |

These numbers are not release-grade load evidence. All nine named operations at the required 2,000/100/50,000/10,000/5,000/5,000 record volumes are skipped.

## 9. Defects and observations

### BLOCKER

None demonstrated in the tested local scope.

### CRITICAL

None demonstrated in the tested local scope.

### HIGH

1. **ENV-REL-001 — production/staging configuration is unavailable.** Production preflight rejects the local `.env`; the running API container reports development mode. Staging HTTPS, provider sandboxes, production secrets/configuration, Edge, Firefox, physical camera, and installed-PWA evidence are absent.

### MEDIUM

1. **LEARN-REL-001 — compiler execution remains externally dependent.** The API now retries transient Judge0 and Piston failures within a combined 26-second budget, below the web client's 30-second timeout. Core Learn acceptance and provider availability are separate browser cases, and both desktop/mobile provider checks passed in the final run. Provider monitoring, a circuit breaker, and a deterministic release sandbox are still recommended.

### LOW

1. Headless Chrome cannot prove native PWA install because it runs incognito.
2. `/login` logs an expected unauthenticated `/auth/me` 401 in console-based PWA audit; this is not a functional failure but adds test-console noise.
3. The API image runs correctly but its monorepo-wide production dependency layer is broader than the API runtime and does not produce a clean in-container `npm ls` without additional workspace manifests. A dedicated API deployment manifest should be created as a packaging hardening follow-up.
4. The monorepo tooling tree contains React 18 at the root and React 19 in the web workspace. The standalone Next.js 16 build uses the declared web version and passes, while Vitest is pinned to one renderer through aliases. Consolidating the root tooling version requires a reviewed lockfile refresh.
5. The Flutter web JavaScript release build passes, but its WebAssembly dry run reports an upstream `socket_io_common` JS-interop incompatibility. The generated JavaScript artifact is unaffected; WASM deployment is not claimed.

## 10. Fixes made during verification

- Increased only the I/O-heavy Excel test timeout from 5 to 15 seconds; inputs and assertions are unchanged. The full API suite then passed.
- Replaced non-fake default E2E admin identities with `codex.qa.admin@college.test`.
- Serialized Playwright (`workers: 1`) because tests share mutable fixtures.
- Corrected the People responsive class from `users-mobile-list` to `users-card-list`.
- Raised sidebar close/CTA, People card action, and Learn tab hit areas to 44 px.
- Upgraded vulnerable production dependencies, replaced the stale registry SheetJS package with the supported SheetJS distribution, and reduced the production audit from 26 advisories to 0.
- Added explicit Linux native packages needed by Windows-generated lockfiles so clean Alpine API/web Docker builds load Canvas, Lightning CSS, and Sharp correctly.
- Added Docker dependency-cache mounts and bounded npm network retries for reproducible image builds.
- Added a bounded compiler-provider retry and regression tests for transient and permanent provider responses.
- Kept the complete compiler fallback budget below the browser request timeout and added a second bounded Judge0 attempt.
- Serialized `BigInt` attachment sizes before Redis/Socket.IO broadcasts, eliminating false HTTP 500 responses after committed message sends.
- Strengthened the messenger E2E test to fail on non-2xx mutation responses instead of trusting optimistic UI state.
- Centralized E2E credentials/configuration, loaded local development values without printing them, and blocked remote data mutation unless explicitly opted in.
- Changed feedback browser coverage to the canonical `/feedback/scanner` and `/feedback/scan/:token` routes.
- Split deterministic Learn acceptance from external compiler availability checks.
- Added PWA dialog focus trapping, Escape handling, focus restoration, and a regression test.
- Rebuilt and restarted the API/web containers, then reran responsive and browser tests.
- Archived the temporary QA admin, randomized its credential, revoked sessions, restored seed fixture credentials, and created an audit entry.

## 11. Skipped evidence

Skipped cases include Edge, Firefox, staging, production, production-like HTTPS, Android APK generation in the incomplete local SDK, native installed PWA, physical camera/device scan, six WhatsApp sandbox events, nine realistic-volume performance operations, the complete 45-step acceptance workflow as one uninterrupted staging run, and two intentional duplicate Playwright project cases.

## 12. Release decision and remaining actions

**Release decision: BLOCKED.**  
**Production approved: NO.**

Remaining actions:

1. Supply and pass a production configuration with `NODE_ENV=production`, trusted HTTPS origins, rotated secrets, and no development accounts.
2. Deploy the tested commit/source state to staging and rerun the complete browser, deep-link, integration, and 45-step acceptance workflow.
3. Run Edge, Firefox, physical Mobile Chrome camera, and native installed-PWA install/offline/update tests.
4. Run all six WhatsApp scenarios against a sandbox and verify delivery persistence/data minimization.
5. Run the full realistic-volume performance profile, inspect slow SQL, and add/validate indexes.
6. Monitor the external compiler providers and add a circuit breaker or deterministic sandbox before production sign-off.
7. Install a complete Android SDK, generate the signed Android artifact, and run the Flutter client on a physical Android device.
