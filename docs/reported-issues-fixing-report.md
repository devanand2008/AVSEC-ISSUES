# Reported production issues fixing report

Date: 3 August 2026
Repository inspected: `D:\COLLEGE MANAGEMENT SITE` (existing AVS College Management System monorepo)
Frontend workspace: `apps/web` — Next.js 16 responsive PWA
Backend workspace: `apps/api` — NestJS 11 API
Prisma schema: `apps/api/prisma/schema.prisma`
Migrations: `apps/api/prisma/migrations/20260803194400_reported_issues_enum_extensions/migration.sql` and `apps/api/prisma/migrations/20260803194500_reported_issues_fixes/migration.sql`

## Audit and baseline

The root npm workspaces, authentication and permission guards, campus hierarchy, issues, attendance, AI, Learn/Skill, storage, conversations, broadcasts, notifications, environment validation, migrations, and existing Jest/Vitest/Playwright tests were inspected before implementation. No new application and no Flutter implementation were created for this work. Existing unrelated Flutter and untracked workspace changes were left untouched.

The pre-change Prisma validation, API build, and web build passed. The reported failures were therefore integration, data-model, access-control, and workflow defects rather than baseline compilation failures.

## Issue 1 — Floor selection

- Root cause: the report form's dependent location state was not reliably coupled to the selected block and had no complete loading/error/retry lifecycle. The backend query returned an empty list for an invalid or cross-college block instead of first validating the selected parent.
- Affected frontend: `apps/web/src/app/(portal)/report-issue/page.tsx`.
- Affected backend: `apps/api/src/modules/locations/locations.controller.ts`, `apps/api/src/modules/locations/locations.service.ts`.
- Affected database model: existing `Campus`, `Block`, and `Floor`; no destructive schema change.
- Implemented fix: added `GET /api/v1/campus/blocks/:blockId/floors`; it validates an active, non-archived block in the authenticated user's college and returns only its active, non-archived floors. The form now clears floor/location/asset state when a parent changes and shows loading, empty, failure, and retry states.
- Automated test: `reported-production-fixes.spec.ts` verifies college-safe active block validation and floor filtering. API/web type checks and production builds exercise the controller and client contract.
- Manual verification: select two different blocks in Issue Reporting and confirm that the floor value clears, only the new block's floors appear, and retry/empty messaging is visible when applicable.

## Issue 2 — Room or Area

- Root cause: the schema and issue DTO required `roomId`; common areas had no persisted model or supported issue location alternative.
- Affected frontend: `apps/web/src/app/(portal)/report-issue/page.tsx`, issue list/detail and escalation pages.
- Affected backend: location controller/service/DTO, issue DTO/service/routing, reports, routing administration.
- Affected database model: new `Area`; `Asset.roomId` and `Issue.roomId` are nullable; new `LocationType`, `Issue.areaId`, `Issue.customAreaName`, and area relations/indexes/check constraints.
- Implemented fix: added required ROOM/AREA selection, existing-area lookup, permitted custom-area entry, exact hierarchy endpoints, tenant/active validation, nullable room handling, area-aware duplicate detection and routing, and display support throughout issue screens.
- Automated test: area scope and active-area API tests in `reported-production-fixes.spec.ts`; registered area issue creation in `issues-hardening.spec.ts`; Prisma validation checks all relations.
- Manual verification: report once against a configured area and once with a custom area, then confirm the correct campus/block/floor/area is shown on the issue detail.

## Issue 3 — Specific Asset

- Root cause: assets were room-only and the report contract did not support temporary asset descriptions or an explicit no-asset choice.
- Affected frontend: report form and admin asset listing.
- Affected backend: location assets API, admin asset DTO/service, issue DTO/service.
- Affected database model: `Asset.areaId`, nullable `Asset.roomId`, single-location constraint, and `Issue.customAssetName`.
- Implemented fix: the form supports registered, custom, and no-specific-asset modes. Registered assets are loaded for exactly one selected room/area and are revalidated server-side against that location. Custom values are trimmed, limited to 150 characters, and reject script/HTML-like input; `assetId` and `customAssetName` cannot both be stored.
- Automated test: exact-one-location API coverage in `reported-production-fixes.spec.ts` and registered-area ownership validation in `issues-hardening.spec.ts`.
- Manual verification: submit room issues with a registered asset, custom asset, and no asset; inspect the stored issue/detail for the expected value.

## Issue 4 — Continue button

- Root cause: the earlier wizard mixed dependent/future-step requirements and silently prevented progression while asynchronous location data was unresolved.
- Affected frontend: `apps/web/src/app/(portal)/report-issue/page.tsx`.
- Affected backend: issue creation validation in `issues.service.ts` and `issue.dto.ts`.
- Affected database model: `Issue` location/asset fields and constraints.
- Implemented fix: each step validates only its visible fields, provides field-level messages, scrolls to the first invalid field, disables progression only during active dependent loads, preserves a non-submitted local draft, prevents duplicate final submission through mutation state plus idempotency, and retains previous values when moving back.
- Automated test: API location permutations and DTO/service validation are covered by issue tests; the optimized PWA build validates the complete client component.
- Manual verification: deliberately omit campus, floor, room/area, category, problem, title, and description in turn; confirm the relevant message and focus/scroll, then complete each step and submit once.

## Issue 5 — Half-day attendance

- Root cause: attendance had only whole-period status values, so later half-day changes could not be represented numerically or audited consistently.
- Affected frontend: `apps/web/src/components/attendance-marking-panel.tsx`.
- Affected backend: attendance service/DTO, attendance imports, analytics and reports.
- Affected database model: `AttendanceCode` gains both half-day values; `AttendanceRecord` gains morning/afternoon parts, `effectiveAttendanceValue`, and correction metadata; history gains previous/new part values and previous/new effective values.
- Implemented fix: half-day mappings produce 0.5, persist structured morning/afternoon values, preserve the complete before/after snapshot in append-only `AttendanceChangeHistory`, and feed the effective value into own, subject, class, daily, and reporting aggregates. Imports use the same canonical calculation. Legacy history rows remain readable with nullable new-effective values, while a not-valid check enforces the new value on newly inserted history.
- Automated test: half-day mapping, incomplete-pair rejection, approved correction update/history, and rejected-correction preservation in `reported-production-fixes.spec.ts`.
- Manual verification: mark present, request/approve a morning-present/afternoon-absent correction, then confirm record value 0.5 and unchanged historical original.

## Issue 6 — Class Sessions

- Root cause: attendance sessions existed, but the UI/API omitted session type and usable start/end time input, weakening session-level semantics.
- Affected frontend: attendance page and marking panel.
- Affected backend: attendance DTO/service.
- Affected database model: `AttendanceSession.sessionType`; existing `startsAt`, `endsAt`, status/version, and unique `[sectionId, subjectId, sessionDate, periodNumber]` are used; record uniqueness remains `[sessionId, studentUserId]`.
- Implemented fix: supports LECTURE, LAB, TUTORIAL, SEMINAR, ACTIVITY, and OTHER, optional validated time windows, active-roster loading, draft save, submission, optimistic version checks, lock/correction behavior, and auditable record upserts.
- Automated test: typed class-session/time-window test plus existing attendance workflow and service tests; Prisma enforces duplicate session/record constraints.
- Manual verification: create a timed lab, save a draft, submit a complete active roster, refresh, and confirm submitted/locked editing rules.

## Issue 7 — AVS Bot

- Root cause: the backend offered streaming only, while the page kept transient messages and did not hydrate conversations/history; standard clients had no `POST /ai/chat` completion contract.
- Affected frontend: `apps/web/src/app/(portal)/avs-bot/page.tsx`.
- Affected backend: `apps/api/src/modules/ai/ai.controller.ts`; the existing `AiChatService` remains the role-aware persistence/safety layer.
- Affected database model: existing `AiConversation`, `AiMessage`, settings, usage, feedback, and safety records.
- Implemented fix: added standard and streaming chat routes, conversation/history selection, persisted history reload, new-chat behavior, explicit retry actions in both the page and widget, suggestions, cancellation, streaming state, and scroll behavior. Secrets remain backend-only.
- Automated test: the standard endpoint's stream-to-response contract is tested in `reported-production-fixes.spec.ts`; existing AI safety tests cover restricted intent handling.
- Manual verification: with backend AI configuration enabled, create a conversation, stop/retry a response, refresh/login again, and confirm history persists without any API key in browser source/storage/network payloads.

## Issue 8 — Lesson Assessment

- Root cause: assessments were a rigid JSON quiz with no persisted attempt, configurable delivery policy, time limit, attempt limit, secure shuffled order, or durable result workflow.
- Affected frontend: Learn portal assessment runner/review.
- Affected backend: Learn DTO, controller, and service.
- Affected database model: expanded `CourseAssessment`; new `AssessmentAttempt`; `AssessmentResult.attemptId`.
- Implemented fix: supports configurable counts up to 200, more than five questions, question-bank validation at publish time, persisted attempts, expiration and attempt limits, cryptographically shuffled question/option orders, grading-safe option remapping, seven requested question families, pass percentage, result persistence, conditional correct answers/explanations, and result review. Both Learn and Skill expose start/submit routes.
- Automated test: more-than-five configuration/pass-score test, persisted random order/option order, attempt-limit test, and server-side result transaction in `learn.service.spec.ts`.
- Manual verification: publish a 10+ question assessment, start it on one device, refresh/continue, submit, inspect review policy, and confirm the saved result on another login.

## Issue 9 — AVS Skill compiler

- Root cause: the client used the legacy Learn route and provider responses were not normalized consistently; correct output could lose meaningful line endings or be reported through an ambiguous result shape.
- Affected frontend: Learn/Skill compiler in `learn-portal-client.tsx`.
- Affected backend: Learn DTO/controller/service.
- Affected database model: new `CompilerExecution` and `CompilerExecutionStatus` audit model.
- Implemented fix: added exact `POST /api/v1/skill/compiler/run`, limited languages to configured C/C++/Java/Python/JavaScript mappings, normalized Judge0/Piston status/output/error/time/memory fields, retained newlines, bounded provider retries/timeouts and output/source sizes, and stores only source hash/length plus result metadata. Code executes at external isolated compiler providers, never in the NestJS process.
- Automated test: all five language mappings, accepted output/newline normalization, compile/runtime/timeout status mapping, retry/fallback, and total timeout budget in `learn-compiler-retry.spec.ts`.
- Manual verification: run known-good and deliberately broken samples in all configured languages and confirm accepted/errors are displayed without server internals.

## Issue 10 — Certificate

- Root cause: the PDF was a plain text layout with no official visual, logo, verification QR, public verification route, preview, or print workflow.
- Affected frontend: Learn certificate list, `apps/web/src/app/certificates/verify/[certificateNumber]/page.tsx`, API blob helper.
- Affected backend: Learn certificate lookup/PDF renderer/controller.
- Affected database model: existing `LearningCertificate` with unique certificate number and student/course/result references.
- Implemented fix: A4 landscape branded PDF with AVS logo, professional double border, official AVS campus/building image, student/course/date/score/number, signature areas, and a QR containing only the public verification URL. Added public verification page plus preview/print and download actions.
- Automated test: PDF signature/size and official building URL test plus public verification result test in `reported-production-fixes.spec.ts`; existing Learn E2E checks the downloadable PDF contract.
- Manual verification: preview on desktop/mobile, print to PDF, scan QR, and compare the displayed record with the issued certificate.
- Approved image source: official AVS Engineering College campus image at `https://avsenggcollege.ac.in/NewsEvents/uploads/hero/01-campus-life.jpg`. Override with `AVS_CERTIFICATE_BUILDING_URL` when deploying an approved locally hosted copy.

## Issue 11 — AVS Learn Subjects

- Root cause: core subject scoping was already database-backed, but the exact subject resource upload integration route was split under staff storage paths and was not available through the requested Learn contract.
- Affected frontend: existing academic Learn and Learn portal clients (no hardcoded subject list was introduced).
- Affected backend: Learn service/controller and storage controller/module.
- Affected database model: existing Department → Programme → Semester → Section → Subject, `SubjectResource`, target sections, views, and course links.
- Implemented fix: retained role-specific PostgreSQL subject scoping, active/current published-resource filtering, linked matching courses/resources, and added `POST /api/v1/learn/subjects/:subjectId/resources` as a secure completion alias to the existing presigned upload workflow.
- Automated test: faculty subject/course matching in `reported-production-fixes.spec.ts`; existing storage/subject visibility tests cover student publication/section boundaries.
- Manual verification: compare a student in two sections and assigned faculty; confirm only current scoped subjects/resources appear and draft resources remain staff-only.

## Issue 12 — Attendance Correction access

- Root cause: navigation and GET access were limited to approval permission, preventing legitimate requesters from opening their own corrections.
- Affected frontend: navigation and attendance correction page.
- Affected backend: attendance controller/service.
- Affected database model: existing `AttendanceCorrectionRequest`, `AttendanceRecord`, and `AttendanceChangeHistory` plus new structured correction fields.
- Implemented fix: route visibility permits request or approve permissions; list/detail APIs apply college/session scope and restrict request-only users to their own records. Added detail endpoint, self-approval prevention, reviewer-only controls, optimistic approval, structured attendance update/history, and rejection without record mutation.
- Automated test: approval and rejection service tests in `reported-production-fixes.spec.ts`; navigation/permission unit tests cover route visibility.
- Manual verification: open `/attendance/corrections` as faculty requester and HOD reviewer, then confirm an unrelated/unauthorized user receives the controlled access response.

## Issue 13 — Assigned Issues

- Root cause: the assigned query/page did not consistently include active team membership and omitted resolved/verification-pending rows from every visible group, producing a false empty state.
- Affected frontend: `apps/web/src/app/(portal)/assigned/page.tsx`.
- Affected backend: access service and issue controller/service.
- Affected database model: existing Issue assignee/team/routing relations; new active issue statuses and area-aware location fields.
- Implemented fix: dedicated `GET /api/v1/maintenance/issues/assigned`, tenant/archive filtering, direct-or-active-team predicate (therefore including category/location routing through the matched team), complete active status set, SLA ordering, one paginated query, correct total count, and visible verification-pending group.
- Automated test: direct/team predicate and area scope tests in `reported-production-fixes.spec.ts`; existing AccessService tests validate independent assignment branches.
- Manual verification: assign one issue directly and one through a category/location routing team; confirm both appear, then move them through waiting/overdue/verification states.

## Issue 14 — Messenger

- Root cause: a socket joined only the currently opened conversation, so background conversations missed events; pending deliveries were not reconciled on reconnect and the UI lacked explicit failure/pending semantics.
- Affected frontend: `apps/web/src/app/(portal)/messages/page.tsx`.
- Affected backend: realtime gateway; existing conversation service already persists before emitting.
- Affected database model: existing Conversation/Participant/Message/Delivery/ReadReceipt and attachment models.
- Implemented fix: authenticated sockets join every active membership, reconnect uses bounded backoff and explicit Connecting/Connected/Reconnecting/Offline/Connection Failed states, queued delivery rows are marked delivered after authenticated rejoin, drafts remain in memory, offline sends become explicit in-memory pending messages with stable idempotency IDs, and retry occurs after reconnect without a false Sent marker or permanent plaintext history storage.
- Automated test: authenticated multi-room join/delivery reconciliation in `reported-production-fixes.spec.ts`; existing realtime tests cover participant authorization, event delivery serialization, and typing.
- Manual verification: open two accounts, exchange/read messages, disconnect one, queue a message, reconnect, and verify save-before-emit ordering plus delivery/read receipts.

## Issue 15 — Broadcast Recipients

- Root cause: the compose page called a recipients route that did not exist and the send path did not safely resolve selected users into durable in-app deliveries.
- Affected frontend: `apps/web/src/app/(portal)/admin/broadcasts/page.tsx`.
- Affected backend: broadcast controller/service/DTO.
- Affected database model: existing `Broadcast` and `BroadcastRecipient`; `BroadcastAudienceType` adds Programme, Academic Year, and Semester.
- Implemented fix: added `GET /api/v1/broadcast/recipients` with tenant-safe active/non-archived user filtering, server search and bounded pagination, role/department/programme/year/semester/section filters, safe response fields only, group count preview, individual multi-select, select-current-page, clear, and selected count. Individual broadcasts now send a validated `recipientIds` UUID array, persist `BroadcastRecipient` rows, atomically claim a send, create in-app notifications, enqueue the `broadcast.sent` outbox event, and mark only actual in-app deliveries as delivered. Audience groups cover all requested role and academic dimensions.
- Automated test: tenant, search, role, page/size, safe mapping in `reported-production-fixes.spec.ts`; DTO tests cover strict payload handling.
- Manual verification: filter by role/department/section, select one page, clear/reselect individuals, send a test broadcast, and compare persisted recipients with the preview count.

## Database safety and deployment order

The two migrations are additive and do not reset or delete production data. PostgreSQL enum extensions are committed in the first migration before the new values are referenced. The second migration backfills current attendance records without mutating append-only history, publishes existing assessments to preserve their current visibility, and creates the broadcast persistence types/tables when upgrading installations that did not previously have them. New room/area and asset constraints are added only after compatible defaults/nullability are established. The complete set of 39 migrations was also applied successfully to an empty disposable database.

Recommended rollout:

1. Take and verify a production backup.
2. Configure backend/web environment variables and an approved building-image URL or reachable official asset.
3. Run `npm run prisma:deploy -w @college/api` once against the target database.
4. Generate the Prisma client and deploy the API before the web bundle.
5. Deploy the PWA, invalidate only application/static caches as normal, and run tenant smoke tests.
6. Monitor API validation errors, compiler provider errors, AI rate/timeout metrics, socket reconnects, and broadcast delivery counts.

The old application can read most additive columns after rollback, but PostgreSQL enum values are intentionally not removed by rollback. Do not manually reverse this migration without a reviewed data migration.

## Verification results

- Prisma validation: passed — `npm run prisma:validate -w @college/api`.
- Prisma generation: passed — Prisma Client 7.9.1 generated successfully.
- Migration deployment: passed — all 39 migrations applied from zero to an empty disposable PostgreSQL database, and the two production-fix migrations applied to the existing local database.
- Type checks: passed for API and web.
- Lint: passed for API, web, shared types, and validation workspaces with zero warnings.
- Backend build: passed — Nest production build through root `npm run build`.
- PWA build: passed — Next.js optimized production build; all 83 routes generated, including corrections and certificate verification.
- Focused automated tests: passed — 49/49 across production fixes, issues, Learn assessments, and compiler.
- Full automated tests: passed — API 51/51 suites and 408/408 tests; web 12/12 files and 65/65 tests (`npm run check`).
- Phone/end-to-end test: an earlier local run passed 20/20 executed Chromium/Pixel 7 scenarios with 2 provider-dependent compiler cases skipped. A final rerun after the last migration/reporting refinements was blocked when Docker Desktop's Linux engine became unavailable during a cold image rebuild; no contrary application failure was observed.
- Sensitive-file preflight: passed — no tracked secrets, private keys, or sensitive student-data artifacts (`npm run security:check`).
- Production dependency audit: passed — 0 vulnerabilities (`npm run audit:production`).
- Docker packaging/runtime follow-up (5 August 2026): passed. Docker Desktop was repaired after its `E:` data drive reached 100% usage, 30.24 GB of inactive build cache was reclaimed, the final API and web images built successfully, all five Compose services became healthy, and the web/login/API live-health endpoints returned HTTP 200. The API Docker startup was also corrected so strict production bootstrap runs only in production mode, and the Nest build once again emits the expected `dist/main.js` entrypoint.

## End-to-end verification matrix

The required 50-step scenario is mapped to these automated/manual groups:

- Steps 1–14: campus/block/floor/room/area, registered/custom/no asset, wizard continuation, and issue submission — campus/issue API tests plus Issue Reporting desktop/mobile smoke.
- Steps 15–23: half-day value, session draft/submit, correction approval, and student summary — attendance unit/service tests plus attendance smoke.
- Steps 24–25: role-aware AVS Bot standard/streaming API, conversation persistence, and UI states — AI controller/safety tests plus configured-provider smoke.
- Steps 26–31: persisted assessment attempt/result, compiler acceptance, and certificate PDF/QR — Learn/compiler/certificate tests and Learn E2E.
- Steps 32–36: scoped subjects and active direct/team maintenance assignments — Learn/access/issue tests and portal smoke.
- Steps 37–39: socket authentication, membership rooms, persistence-before-emit, delivery/reconnect/read — realtime/conversation tests and two-account smoke.
- Steps 40–44: recipient search/group filters/selection/send/delivery — broadcast service/DTO tests and admin smoke.
- Steps 45–50: Pixel 7 project, Prisma validate/generate, API/PWA builds, and full Jest/Vitest run — commands/results in this report.

## Remaining errors and manual configuration

- No known compile, Prisma, migration, lint, unit/integration-test, or previously executed E2E defect remains.
- Final Docker image and local Compose runtime verification are complete. The post-change Playwright rerun remains recommended before production rollout; the previously recorded Chromium/Pixel 7 run remains the latest browser E2E result.
- A live OpenAI response requires backend-only `AVS_BOT_ENABLED`, `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_MAX_OUTPUT_TOKENS`, and `OPENAI_REQUEST_TIMEOUT_MS`.
- Production must set correct `WEB_URL`, API/socket origins, CORS origins, storage settings, and secure cookies. Never add the OpenAI key to any `NEXT_PUBLIC_*` value.
- Judge0/Piston availability and sandbox/network policy are external operational dependencies; production should point to an approved managed/self-hosted isolated provider if public endpoints are not acceptable.
- For deterministic certificate rendering, host the approved AVS campus image internally and set `AVS_CERTIFICATE_BUILDING_URL`.
- Live multi-user socket, email/push, AI-provider, compiler-provider, and broadcast delivery smoke tests require deployed infrastructure and test accounts. The guarded online compiler E2E is the only automated scenario not executed in this local environment.

## Production readiness

The implementation is schema-valid, migration-clean from an empty database, type-safe, lint-clean, production-buildable, Docker-verified, tenant-scoped, and covered by targeted regression tests. Production readiness is conditional on supplying the backend-only configuration and completing the final Playwright plus environment-dependent live smoke checks with test records.
