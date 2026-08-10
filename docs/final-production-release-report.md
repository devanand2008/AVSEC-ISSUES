# AVS College Management System

# Final Production Release Report

**Report state:** DEPLOYED - VERIFIED WEB RELEASE WITH DOCUMENTED LIMITS

**Last updated:** 2026-08-11 (Asia/Kolkata)

**Public URL:** https://avs-college-portal.onrender.com/

**Repository:** https://github.com/devanand2008/AVSEC-ISSUES

## Release Identity

| Item                               | Verified value                                                        |
| ---------------------------------- | --------------------------------------------------------------------- |
| Executable release commit          | `4c64bc1216c7370fc79bcfd7b1cf60fe00f4e442`                            |
| Initial acceptance deployment      | `dep-d9t15k8ae00c73b61g00`                                            |
| Same-commit persistence deployment | `dep-d9t19legekts739hhtn0`                                            |
| Current live commit                | `34cca0a3e2caacb407deb6ab35219ef4fb37379f`                            |
| Current live deployment            | `dep-d9t22r7avr4c7397kdeg` (`live`)                                   |
| Full clear-cache redeploy          | PASS                                                                  |
| Render service                     | Existing `avs-college-portal` service; no replacement service created |
| Database mode                      | `EXTERNAL_PERSISTENT`                                                 |
| Production database                | `avs_college_import_20260806`                                         |

The tested application commit was deployed to the existing Render service. A
second Render deployment of the exact same commit was used to prove PostgreSQL
persistence. The later documentation-only commits changed no executable source.
At the user's request, the latest `main` commit received a full clear-cache
Render rebuild and deployment, followed by health, Main Admin login/logout,
Profile, Reports, mobile, database, storage, and runtime-log checks. No database
reset, force-reset, destructive storage mirror, or new Render service was used.

## Production Outcome

The web application is live and operational. The previously reported mobile
Profile and Reports 404 errors are fixed: Profile opens `/profile`, Reports opens
`/admin/exports`, and both render successfully while authenticated. The empty
feedback-filter 400 errors, backup inventory 500, invalid-origin CORS 500,
Supabase signed-download endpoint issue, announcement audience leaks, logout
session-cache window, and identified responsive-layout defects were also fixed.

At the final 2026-08-11 health check:

| Endpoint                     | Result                                           |
| ---------------------------- | ------------------------------------------------ |
| `/health`                    | HTTP 200, `ready`, `EXTERNAL_PERSISTENT`         |
| `/health/live`               | HTTP 200, `ok`                                   |
| `/health/ready`              | HTTP 200, PostgreSQL `up`, configuration `valid` |
| `/health/ready/dependencies` | HTTP 200, `ready`                                |

HSTS is present on API, frontend, manifest, service worker, and offline assets.
Disallowed CORS origins return HTTP 403 without an allow-origin header instead of
the previous HTTP 500.

Across 1,635 retained rows for the executable acceptance deployment, there were
no level-50 application errors and no HTTP 5xx responses. The non-error signals
were three known Nest route-conversion warnings, four transient gateway
connection retries while ports 3000/4000 started, and expected
authentication/logout HTTP 401s. The exact post-ready audit for the final full
redeployment covered 146 log rows without pagination: zero error-level rows,
zero warning-level rows, zero fatal signals, zero HTTP 5xx responses, and zero
database, Redis, storage, crash, or unhandled-error signals. The HTTP 401 rows
were expected invalidated-token and unauthenticated `/auth/me` checks.

## Main Admin Authentication

| Check                                      | Result                                                    |
| ------------------------------------------ | --------------------------------------------------------- |
| Account identity                           | `deva1253@college.com`                                    |
| Status and role                            | `ACTIVE`, `MAIN_ADMIN`                                    |
| Forced password change                     | Disabled after controlled rotation                        |
| Replacement credential                     | Stored outside Git in the protected local credential file |
| Fresh login and `/auth/me`                 | PASS                                                      |
| Profile API                                | PASS                                                      |
| Backup inventory API                       | HTTP 200                                                  |
| Logout                                     | HTTP 204                                                  |
| Same access token immediately after logout | HTTP 401                                                  |

The publicly exposed old password was invalidated. It is not the live password
and must not be restored. The replacement secret is intentionally not included
in this report, source control, logs, or chat.

## Database Cutover and Integrity

The original 7,425-row figure is the exact authoritative source snapshot before
the documented transient cleanup. That cleanup removed 671 refresh tokens, 452
sessions, 12 password-reset tokens, 32 idempotency records, and 25 pending outbox
records. It is therefore not the expected live total after cutover.

The final read-only production snapshot contained 143 public tables and 6,887
rows. It is not bootstrap-like, no protected baseline table is below its
post-cleanup floor, and the live database is the intended restored Supabase
database.

| Data                          | Final live count |
| ----------------------------- | ---------------: |
| Users / credentials           |          45 / 45 |
| Student / staff profiles      |          13 / 13 |
| Roles / permissions           |         19 / 104 |
| Issues / issue attachments    |          23 / 29 |
| Conversations / messages      |          24 / 70 |
| Announcements                 |                4 |
| Attendance sessions / records |            3 / 5 |
| AVS Skill courses             |               17 |
| Modules / lessons             |         34 / 513 |
| Assessments                   |            1,019 |
| Student progress              |               45 |
| Learning certificates         |                2 |
| Audit logs                    |            1,052 |

Migration state is clean: 40 local migration directories, 40 applied migrations,
four retained rolled-back audit records, zero failed migrations, zero pending
local migrations, and zero database-only migration directories.

### Source-to-live progress variance

The source snapshot contained 46 `student_progress` rows. An exact identifier and
natural-key comparison found 45 unchanged rows live, no extra rows, and one
removed completion belonging to the active Main Admin. The related account,
course, and lesson remain intact, and that user retains 23 other progress rows.
The application deliberately supports marking a completed lesson incomplete,
which deletes that one progress row. Render retained one successful authenticated
`POST /api/v1/learn/progress` mutation after the isolated restore; this is strong
evidence that the difference is a user "mark incomplete" action, but request-body
auditing is unavailable, so it is an inference rather than direct proof. A stale
completion was not reinserted because doing so would overwrite mutable user state
without evidence that the removal was accidental.

## Controlled Live Transaction and Persistence

A uniquely marked TEST student was created through the production API with an
ACTIVE STUDENT role, coherent department/programme/semester/section assignment,
student profile, and SECTION scope. Its public identifier and creation timestamp
were unchanged after the same executable commit was redeployed.

A selected-recipient TEST announcement was created and published. It reached
exactly one recipient, remained published across the same-commit redeployment,
and retained the same database identity. Both issue and attendance CSV exports
returned their corrected endpoints and produced exact request-linked audit rows.

Cleanup completed safely:

- The TEST announcement is `ARCHIVED`.
- Its notification recipient residue is absent.
- The final TEST student is `ARCHIVED`.
- Acceptance sessions were closed; no transaction-specific sessions remain.
- Permanent anonymization was correctly refused because the verified backup
  predates the test-user creation. The archived record was not bypass-deleted by
  direct SQL.

Earlier repair attempts also left four clearly marked archived TEST users. They
remain non-active because no post-creation restore-tested backup exists to satisfy
the application's permanent-deletion safety gate.

## Object Storage

| Check                               | Result    |
| ----------------------------------- | --------- |
| Supabase private objects            | 108       |
| Total bytes                         | 2,686,456 |
| Unique database references          | 102       |
| Present references                  | 98        |
| Known historical missing references | 4         |
| New reference regression            | None      |

All 108 objects were read and matched their stored size, MIME metadata, and
SHA-256. The four absent references predate this release: two READY import
sources, one COMPLETED import source, and one abandoned UPLOADING message
attachment. A live application-signed attachment download used the Supabase
origin, returned HTTP 200, and matched its stored byte count and SHA-256; it did
not point to the Render host on port 9000.

## Backup and Recovery

GitHub Actions run
https://github.com/devanand2008/AVSEC-ISSUES/actions/runs/31415240902 completed
successfully as a production pre-migration backup.

| Backup gate                 | Result                            |
| --------------------------- | --------------------------------- |
| PostgreSQL client           | 17                                |
| Backup format               | PostgreSQL custom archive         |
| Ownership/privileges        | Excluded                          |
| Public table-count manifest | 143 entries                       |
| Encryption                  | AES-256-GCM                       |
| Decryption round trip       | PASS                              |
| Isolated restore            | PASS                              |
| Exact restored table counts | PASS                              |
| Database metadata           | `PRE_MIGRATION`, `RESTORE_TESTED` |
| Encrypted GitHub artifact   | `avs-2026-08-10_23-11-21-IST`     |
| Artifact retention          | Through 2026-09-09                |

The database payload is AES-256-GCM encrypted and its encryption key is retained
outside Git in the protected local backup-key file. The repository is public, so
the GitHub-hosted artifact itself is not described as private; eligible GitHub
users may be able to download the ciphertext, but cannot decrypt it without the
separate key. This successful run was manually dispatched. A daily cron is
configured, but a scheduled execution has not yet been observed. The in-app
Google Drive provider and in-app scheduler remain disabled, so `/health/ready`
intentionally reports backup readiness as degraded even though the separate
restore-tested off-host artifact exists.

## Automated Quality Gates

| Gate                                        | Result                      |
| ------------------------------------------- | --------------------------- |
| API tests                                   | 59 suites, 468 tests passed |
| Web tests                                   | 19 files, 120 tests passed  |
| API typecheck, lint, production build       | PASS                        |
| Web typecheck, lint, production build       | PASS; 85 routes generated   |
| Production dependency audit                 | 0 vulnerabilities           |
| Sensitive-file/security scan                | PASS                        |
| Prisma generation and migration safety gate | PASS                        |
| Production migrations                       | PASS; zero pending/failed   |

## Browser, PWA, and Responsive Acceptance

Chrome and Edge public smoke checks passed. The service worker registered,
activated, and controlled scope `/`; the offline page and manifest icons loaded;
API requests were not replayed from the PWA cache. The installed-app prompt,
bottom navigation, drawer, and AVS Bot were tested for overlap and viewport fit.

Authenticated route checks were executed at 320, 360, 375, 390, 412, 430, and
768 pixel widths across the available route sets. Final targeted checks at
430x932 and 768x1024 reported HTTP 200, no 404 body, no horizontal document
overflow, no incomplete loading state, no runtime error, and verified logout.
Public/login responsive checks also covered 1024, 1366, and 1440 pixel widths.
Profile, Reports, feedback, imports, storage/backups, announcements, settings,
and Report Issue were included in the repaired mobile coverage.

## Remaining Assurance Limits

These are not known live web regressions, but they prevent an unconditional
all-platform sign-off:

1. Google Drive integration and the in-app backup scheduler remain disabled;
   recovery currently relies on the verified encrypted GitHub Actions artifact,
   and the configured daily cron has not yet completed a scheduled run.
2. A physical-device camera/QR run, a downloaded installed-PWA login, and Firefox
   testing were not available in this environment.
3. A controlled production load test was not run.
4. Five archived TEST users remain under the application's fail-closed deletion
   policy until a qualifying post-creation restore-tested backup exists.
5. The one mutable Main Admin learning-progress difference from the pre-cutover
   source snapshot cannot be proven intentional from retained audit data and was
   therefore disclosed rather than overwritten.

## Release Decision

**Operational web deployment: LIVE AND VERIFIED**

**Formal unconditional production approval: BLOCKED by the remaining assurance
limits above.** No unresolved blocker is known for ordinary web login, Profile,
Reports, mobile navigation, database persistence, object downloads, or the tested
production transactions.
