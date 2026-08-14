# AVS Final Independent QA Report

**Assessment date:** 2026-08-14

**Production:** https://avs-college-portal.onrender.com

**Live executable commit:** `30b46ba793eed05db1907c101d62908bffc089bc`

**Live Render deployment:** `dep-d9vk2nbl550s73ankc6g`

**Tested code release:** `30b46ba793eed05db1907c101d62908bffc089bc`

## Release decision

**PRODUCTION RELEASE: BLOCKED**

The deployed service is online and its verified build, database, authentication,
student-registration, responsive-layout, persistence, security, and backup
checks are largely healthy. It cannot receive full-product approval against the
35-section acceptance specification because required product capabilities are
missing and the required phone logout action is unavailable.

This decision does not claim that the current service is down. It means that the
requested full AVS product scope is not acceptance-complete.

## Test totals

The counts below use the 35 numbered top-level acceptance sections as the unit,
so partial sections are not inflated into passes.

| Measure                             | Count |
| ----------------------------------- | ----: |
| Total top-level acceptance sections |    35 |
| Passed                              |     8 |
| Failed                              |     7 |
| Skipped or only partially verified  |    20 |

Additional executed evidence:

- API Jest: 71/71 suites and 580/580 tests passed on the staff-QR release.
- Web Vitest: 29/29 files and 205/205 tests passed.
- Responsive production crawl: 160/160 route-width checks reached the expected
  page with zero document overflow.
- Fresh production backup: one successful workflow run and one successful
  isolated PostgreSQL restore.
- Staff Feedback QR: four eligible profiles received four targets and four
  active QR codes; four PNG and four poster-PDF downloads passed. The People
  panel and preview passed at 320px and 1366px without overflow.

The first API Jest run had one 30-second import-test timeout (563/564 tests);
the exact focused test then passed, and the complete unchanged rerun passed
564/564. This is recorded as a timing-flake risk rather than hidden.

## Staff Feedback QR remediation

The People-profile QR blocker from the original independent run is resolved in
production release `30b46ba793eed05db1907c101d62908bffc089bc`, Render deployment
`dep-d9vk2nbl550s73ankc6g`.

- A protected backup at the exact release SHA completed successfully in GitHub
  Actions run `31816473266`, including encryption, isolated PostgreSQL restore,
  artifact upload, and database registration.
- Production generated exactly four person-linked targets and four QR codes:
  three `STAFF` and one `VICE_PRINCIPAL`.
- Repeating every ensure request reused the same target and QR (4/4); no
  duplicate target, QR, or token-hash groups exist.
- Four PNG and four poster-PDF downloads passed. People-profile preview and
  actions passed at 320px and 1366px with no document overflow.
- A read-only repeatable PostgreSQL snapshot confirmed four correct current
  role/type mappings, four active targets, four active unexpired QRs, production
  HTTPS scan routes, URL/hash consistency, and zero orphan, cross-college,
  inactive-user, or department-link anomalies.
- Eight recent `feedback.staff_qr_ensured` audit rows cover four creation and
  four idempotency calls. No audit token/hash fields were stored.
- Render is on the exact release with an empty normal startup command and no
  pending migration. All four health routes returned 200. The complete
  post-deploy log interval was paginated; after the deployment became live,
  295 rows over 1,036 seconds contained zero errors, warnings, 5xx, database,
  Redis, storage, authentication-error, or crash signals. The single 401 was
  the deliberate post-logout revocation check.
- The pre-existing non-staff cohort remains 52 active targets and 52 active QR
  rows, with one QR per target and 52 distinct valid-format token hashes. A
  durable pre-release row/hash digest was not captured, so byte-for-byte
  historical identity is not claimed.
- Inactive staff and stale role-to-target types are now rejected during target
  browse, QR scan, ticket issuance, and final submission. The profile panel
  offers synchronization rather than sharing a stale code.

This remediation removes only the People-profile QR blocker. It does not alter
the overall full-product BLOCKED decision for the remaining unrelated scope.

## Requested summary

| Area                   | Result                       | Evidence or limitation                                                                                                                                                                                                                                                                                                                                                |
| ---------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Main Admin             | PASS                         | Correct and wrong-password login, dashboard/auth identity, permission checks, logout 204, and post-logout 401 verified.                                                                                                                                                                                                                                               |
| Principal              | SKIPPED                      | No active Principal account or disposable Principal fixture exists in production.                                                                                                                                                                                                                                                                                     |
| Vice Principal         | PASS / PARTIAL               | Correct login, role, permission denial, first-password flow, logout, and revocation verified. Its People-profile feedback target, active QR, PNG, poster PDF, preview, and idempotent reuse are now verified. A real feedback submission was not created.                                                                                                             |
| HOD                    | SKIPPED                      | No active HOD account or disposable fixture exists.                                                                                                                                                                                                                                                                                                                   |
| Faculty                | SKIPPED / PARTIAL            | Existing Faculty accounts remain real and were not impersonated. Admin-side People-profile feedback targets and active QR generation/downloads were verified without changing their credentials or submitting feedback.                                                                                                                                               |
| Student                | PASS / PARTIAL               | Controlled TEST-student create, persistence, promotion, archive, and cleanup evidence passed. A current real Student was not repurposed for unrelated tests.                                                                                                                                                                                                          |
| Maintenance            | SKIPPED / PARTIAL            | No disposable Maintenance Staff account exists for the worker workflow. The existing Maintenance Admin StaffProfile received the generic Staff feedback target/QR through the same eligibility path without account impersonation.                                                                                                                                    |
| Student Registration   | PASS                         | B.E./B.Tech., all eight configured years, Study Years 1-4, exact semester pairs, PostgreSQL creation, refresh, promotion, archive, and cleanup were verified.                                                                                                                                                                                                         |
| Temporary Password     | PARTIAL                      | Mandatory change, policy rejection, session rotation, old-session revocation, and final credential login passed. Installed-PWA execution remains a device-only skip.                                                                                                                                                                                                  |
| Mobile Logout          | FAIL - BLOCKER               | At all six required phone widths the Profile page had no Logout and there was no mobile More -> Logout. API fallback logout correctly returned 204 and subsequent auth returned 401.                                                                                                                                                                                  |
| People                 | PASS for TEST Student        | Add, persistence, edit/promotion, archive, dependency-aware safe deletion, and authentication/authorization cleanup passed for a TEST Student. Generic staff permanent deletion was not attempted.                                                                                                                                                                    |
| People Profile QR      | PASS                         | Eligible StaffProfile pages now show permission-gated generation, status, copy, preview, PNG, and poster-PDF actions. Exactly four production targets/QRs were generated; repeated ensure calls reused the same records; phone and desktop geometry passed.                                                                                                           |
| Principal QR           | SKIPPED                      | The code path and question set exist, but production has no eligible active Principal StaffProfile. No fake Principal was created.                                                                                                                                                                                                                                    |
| Vice Principal QR      | PASS                         | Exactly one active Vice Principal target and QR was generated, downloaded, previewed, and idempotently rechecked.                                                                                                                                                                                                                                                     |
| HOD QR                 | SKIPPED                      | The code path and question set exist, but production has no eligible active HOD StaffProfile. No fake HOD was created.                                                                                                                                                                                                                                                |
| Faculty QR             | PASS / PARTIAL               | Two real Faculty-linked Staff targets/QRs were generated and verified without credential changes. A real Student was not used to submit feedback.                                                                                                                                                                                                                     |
| Staff Feedback         | PARTIAL                      | Secure person-linked targets and QRs are now live for all four eligible staff profiles. Submission/report workflow remains unmutated because no disposable Student/staff feedback fixture exists.                                                                                                                                                                     |
| QR Security            | PASS for safe probes         | Random token returned 400 without token reflection; target resolution is token-bound in the API; XSS-shaped input was rejected and created no record. Expired/revoked live tokens were not mutated.                                                                                                                                                                   |
| QR Mobile              | PARTIAL                      | Responsive manual/paste/gallery/camera UI exists. Physical HTTPS camera and OS gallery chooser were not certified by emulation.                                                                                                                                                                                                                                       |
| Regulations            | FAIL - BLOCKER               | No Regulation database model, API, or UI exists; attendance thresholds remain college-wide rather than regulation-scoped.                                                                                                                                                                                                                                             |
| Attendance             | PARTIAL                      | Statuses, sessions, corrections, calculations, roster filters, and automated coverage exist. No disposable live roster/session was available, and regulation-specific behavior cannot pass.                                                                                                                                                                           |
| Timetable              | FAIL - BLOCKER               | No timetable data model, API, UI, or collision engine exists.                                                                                                                                                                                                                                                                                                         |
| Announcements          | PARTIAL                      | Route, title/category contract, validation, and automated coverage pass. A new persistent archived announcement was not created after blockers were confirmed.                                                                                                                                                                                                        |
| Broadcast              | PARTIAL                      | Audience groups and validation exist; live delivery was skipped because there were no disposable recipient fixtures.                                                                                                                                                                                                                                                  |
| Messenger              | PARTIAL                      | Source/tests cover text, attachments, replies, reactions, edit/delete, receipts, reconnect, and retry. Live two-party mutations were skipped; no disposable pair exists.                                                                                                                                                                                              |
| Campus                 | FAIL / PARTIAL               | Campus, Block, Floor, and Room have lifecycle operations. Area supports only create/list, preventing the required safe lifecycle acceptance.                                                                                                                                                                                                                          |
| Assets                 | FAIL / PARTIAL               | Asset create/list/status exist, but edit/archive/restore/dependencies/safe-delete are incomplete. No TEST Asset was left in production.                                                                                                                                                                                                                               |
| Issues                 | PARTIAL                      | Issue and maintenance state-machine coverage exists. A new live issue was not created because safe TEST location/asset/worker prerequisites were absent.                                                                                                                                                                                                              |
| Duplicate Issues       | SKIPPED                      | Requires two disposable reporters and a safely removable TEST issue graph.                                                                                                                                                                                                                                                                                            |
| Maintenance            | PARTIAL                      | Assignment, acknowledge, start, progress, waiting, finish/photo, verify/reopen, and timeline capabilities exist; no disposable worker was available.                                                                                                                                                                                                                  |
| Escalation             | PARTIAL                      | SLA/escalation implementation and automated tests exist; a production overdue issue was not manufactured.                                                                                                                                                                                                                                                             |
| Preventive Maintenance | FAIL - BLOCKER               | No preventive-maintenance schedule model, API, UI, or due/overdue workflow exists.                                                                                                                                                                                                                                                                                    |
| Learn                  | FAIL / PARTIAL               | Upload, publish, student-scoped view, and archive exist. The required unpublish-to-draft operation is absent.                                                                                                                                                                                                                                                         |
| Skill                  | PARTIAL                      | Course/module/lesson/assessment/progress implementation and automated tests pass; no persistent live TEST learning record was added.                                                                                                                                                                                                                                  |
| Compiler               | SKIPPED                      | External Judge0/Piston paths and retry/error tests exist; an independent live sandbox/timeout run was not performed.                                                                                                                                                                                                                                                  |
| Certificate            | SKIPPED / PARTIAL            | Certificate PDF, number, logo, QR, and verification route exist. No disposable completed course/certificate existed; approved-building provenance is not modeled.                                                                                                                                                                                                     |
| Bot                    | SKIPPED / PARTIAL            | Source/tests enforce own-data boundaries. A real Student account was not repurposed to probe another student's private data.                                                                                                                                                                                                                                          |
| PWA                    | PARTIAL PASS                 | Chrome and Edge reported secure context, manifest/service-worker registration, offline page 200, protected-route login redirects, and collision-free 320x568 install UI. Installed-device behavior remains unverified.                                                                                                                                                |
| Responsive             | FAIL overall                 | 160/160 route-width layout checks passed with zero page overflow, but the mandatory phone Logout/More action failed all six required phone widths.                                                                                                                                                                                                                    |
| Supabase Persistence   | PASS                         | TEST Student survived refresh and same-code redeploy, appeared in PostgreSQL, then was safely archived and cleaned. Current production reports external persistent PostgreSQL and 42 applied migrations.                                                                                                                                                              |
| Backup                 | PASS with storage limitation | Fresh encrypted backup, checksums, isolated restore, schema/count comparison, registration, and plaintext cleanup passed. Google Drive/S3 are not configured.                                                                                                                                                                                                         |
| Security               | PARTIAL PASS                 | RBAC, CORS, CSRF, invalid JWT, secure cookie flags, rate limiting, WebSocket rejection, random QR guessing, XSS write prevention, permission-scoped People access, logout revocation, and bundle secret scan passed. Cross-college IDOR, existing-conversation IDOR, stored-XSS rendering, and MIME-spoof upload were safely skipped for lack of disposable fixtures. |

## Build gate

The clean locked install and required code gates were run with Node.js 22.23.2
and npm 10.9.8.

| Gate                                  | Result                                       |
| ------------------------------------- | -------------------------------------------- |
| `npm ci --include=dev`                | PASS                                         |
| Prisma validate                       | PASS                                         |
| Prisma generate                       | PASS; Prisma Client 7.9.1                    |
| API typecheck                         | PASS                                         |
| API lint                              | PASS; zero warnings                          |
| API production build                  | PASS                                         |
| API Jest                              | PASS on complete rerun; 71 suites, 580 tests |
| Web typecheck                         | PASS                                         |
| Web lint                              | PASS; zero warnings                          |
| Web production build                  | PASS; 90 static pages                        |
| Web Vitest                            | PASS; 29 files, 205 tests                    |
| Production dependency audit           | PASS; zero vulnerabilities                   |
| Secure dependency-tree assertion      | PASS; `nanoid` 3.3.18                        |
| Sensitive-file scan                   | PASS                                         |
| Frontend bundle protected-secret scan | PASS; zero matches                           |

## Responsive production evidence

The production crawl covered 16 representative routes at each of these exact
viewports:

`320x568`, `360x800`, `375x812`, `390x844`, `412x915`, `430x932`,
`768x1024`, `1024x768`, `1366x768`, and `1440x900`.

- 160/160 document navigations returned the expected page.
- 160/160 loading states settled.
- 0 document-level horizontal-overflow failures.
- The Messenger controls initially reported as clipped were inside its
  intentionally translated, off-canvas pane; isolated geometry confirmed they
  do not widen the document.
- Initial form-width failures selected the hidden global-search input. Actual
  People, Announcement, and Issue controls were usable and not clipped.
- Initial QR-action failures were wording-regex false positives. Production
  rendered 25 QR rows with Bulk generate, Preview, PNG, SVG, PDF, Regenerate,
  Disable, and Archive actions inside a deliberate table scroller.
- All 14 initial transient/navigation event cases passed isolated reruns with
  HTTP 200, the correct page, no visible error state, and no console, request,
  404, 429, or 5xx event.
- The genuine failure is mobile Logout: neither Profile -> Logout nor More ->
  Logout exists at the required phone widths.

## Security evidence

Safe live tests did not create a domain record:

- Main Admin wrong-password request returned 401; correct login returned 200.
- Vice Principal access to a Main-Admin-only resource returned 403.
- Protected POST without CSRF returned 403; the same invalid request with valid
  CSRF reached validation and returned 400 without a write.
- Access and refresh cookies were Secure, HttpOnly, SameSite=Lax. The CSRF
  double-submit cookie was Secure and SameSite=Lax, intentionally readable by
  the client.
- Invalid JWT and post-logout authentication returned 401.
- Hostile-Origin GET and OPTIONS requests returned 403 without an allow-origin
  response header.
- A bounded nonexistent-user login series reached 429 rate limiting.
- Missing-token and invalid-token Socket.IO clients were immediately
  disconnected.
- A random 256-bit feedback QR guess returned 400 and was not reflected.
- An XSS-shaped announcement title returned 400; before/after list checks proved
  the unique marker was not stored.
- Main Admin could read an existing People resource; Vice Principal received 403. Random People/conversation UUIDs returned only 403/404.
- Frontend static bundles contained no protected credential, token, database
  URL, or private-key marker from the protected local candidate set.

Tests requiring durable hostile payloads, file uploads, a second college, or a
conversation provably outside the lower-privilege user's scope were skipped to
avoid altering real college data.

## Database and persistence evidence

The controlled student-registration acceptance used a namespaced TEST Student
and ended with safe cleanup:

- UI create and PostgreSQL row verification passed.
- B.E. / CSE / 2026-2027 / Study Year 1 / Semester 1 / Section A placement
  passed.
- Browser refresh and People-list persistence passed.
- Same-code Render redeploy preserved the record.
- Promotion to 2027-2028 / Study Year 2 / Semester 3 / CSE-B passed, including
  capacity count changes and two membership-ledger records.
- Archive closed the active membership and Section scope.
- Restore-tested-backup-gated safe cleanup removed credential, role, scope, and
  raw TEST identifiers while retaining an anonymized historical tombstone.
- A database-wide text/JSON scan found zero raw acceptance-marker occurrences.

The final executable release changed only the production dependency security
pin/validator above the accepted application runtime. A fresh read-only audit
on the live executable confirmed:

- 2 active degree types.
- 8 active programmes and 8 active Academic Years, exactly one current.
- 512 active semesters and 896 active sections.
- Every programme/year group contains Semesters 1-8.
- 0 invalid programme shapes, section study-year mappings, capacity ranges, or
  Academic-Year date relationships.
- 0 active TEST memberships, credentials, roles, scopes, sessions, refresh
  tokens, password-reset tokens, or devices.

## Fresh backup and restore

GitHub Actions run
[31769146636](https://github.com/devanand2008/AVSEC-ISSUES/actions/runs/31769146636)
completed successfully for repository commit
`244f7a888033006943cf7a75c7589bd61a8a3755`.

- Purpose: controlled `PRE_DELETION` backup only; no deletion, migration, or
  deployment followed.
- Backup database record:
  `8dd91a42-d64f-43a0-8976-43a942184399`.
- Status: `RESTORE_TESTED`.
- Encryption: AES-256-GCM.
- Plain, encrypted, and manifest SHA-256 fields: valid.
- Isolated restore: PASSED.
- Schema and table-count comparison: MATCHED.
- Restored point-in-time snapshot: 144 public tables and 7,160 rows.
- Artifact: `avs-2026-08-14_09-42-52-IST`, 946,164 bytes, expires
  2026-09-13.
- Plaintext temporary files were removed/shredded by the workflow.

Storage limitation: Google Drive and S3 have zero connected production
destinations. The retained GitHub artifact is hosted by a public repository, so
it must not be described as a private recovery copy. The full SQL payload is
encrypted, but the artifact also contains schema, manifest, checksum, and log
files.

## Blockers and severity

### BLOCKERS

1. Required mobile Logout/More action is absent on the six requested phone
   widths.
2. Regulation masters and regulation-scoped rules do not exist.
3. Timetable and collision protection do not exist.
4. Preventive-maintenance scheduling and due/overdue workflow do not exist.
5. Area and Asset lack the complete safe lifecycle required by the acceptance
   prompt.
6. AVS Learn lacks the requested unpublish-to-draft operation.
7. Safe disposable production fixtures do not exist for every requested role
   and multi-user workflow; real College accounts were correctly left alone.

### CRITICAL

No confirmed Critical-severity security, data-corruption, or availability defect
was found in the executed checks.

### HIGH

- Mobile users at 320-375 px cannot access the only existing topbar logout
  control.
- Missing Regulations, Timetable, and Preventive Maintenance functions make
  requested workflows impossible rather than merely untested.
- Incomplete Area/Asset lifecycle prevents safe end-to-end TEST-data cleanup.

### MEDIUM

- Google Drive/S3 backup mirroring is disabled; the sole fresh artifact is tied
  to a public GitHub repository and expires after 30 days.
- One API import-limit test showed host-load sensitivity before the exact full
  rerun passed.
- Installed-PWA, physical camera/gallery, Firefox/Safari, external compiler
  sandbox, and load testing remain uncertified.
- A few initial security requests encountered transient 502/503/429 responses;
  bounded reruns and current health checks passed.

### LOW

No unresolved Low-severity defect was promoted from the responsive detector;
its Messenger, form, QR, and route-event flags were independently disproved.

## Final statement

The production service is healthy and several major workflows are proven, but
the requested **full product release is BLOCKED**. Re-test and reconsider
approval only after the blockers above are implemented, safe disposable role
fixtures are available, and the skipped physical-device/multi-user security
checks are completed.
