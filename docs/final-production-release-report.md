# AVS College Management System

# Final Production Release Report

**Report state:** LIVE - ACADEMIC HIERARCHY DEPLOYED AND VERIFIED

**Last updated:** 2026-08-13 (Asia/Kolkata)

**Public URL:** https://avs-college-portal.onrender.com/

**Repository:** https://github.com/devanand2008/AVSEC-ISSUES

## Release Identity

| Item                               | Verified value                                            |
| ---------------------------------- | --------------------------------------------------------- |
| Current release commit             | `78762683ee43c3082784e654d510b70f0335df57`                |
| Initial corrected deployment       | `dep-d9uadv5bedkc7394aibg`                                |
| Same-commit persistence deployment | `dep-d9uaqi9t0dsc73cvoqpg` (`live`)                       |
| Existing Render service            | `avs-college-portal`; no replacement service created      |
| Database mode                      | `EXTERNAL_PERSISTENT`                                     |
| Production database                | `avs_college_import_20260806` on Supabase PostgreSQL      |
| Current migration state            | 41 applied, 4 historical rolled back, 0 failed, 0 pending |

Local `HEAD`, `origin/main`, the current Render deployment, the tested browser
release, and the backup-gated acceptance flow all reference the same release
commit. A first rollout attempt applied the academic uniqueness migration but
failed before startup because a seed dependency was missing from the runtime
image. The image packaging was corrected and covered with a build-time import
check. PostgreSQL was not reset and the already-applied migration was not
force-replayed.

## Academic Hierarchy Delivered

Production now contains the required normalized hierarchy. Department codes and
professional names are stored separately, and sections are child records rather
than malformed department names.

| Department | Professional name                            | Sections |
| ---------- | -------------------------------------------- | -------- |
| AI & ML    | Artificial Intelligence and Machine Learning | A        |
| AI & DS    | Artificial Intelligence and Data Science     | A, B, C  |
| CSE        | Computer Science and Engineering             | A, B, C  |
| IT         | Information Technology                       | A, B     |
| ECE        | Electronics and Communication Engineering    | A, B     |
| EEE        | Electrical and Electronics Engineering       | A        |
| MECH       | Mechanical Engineering                       | A        |
| BME        | Biomedical Engineering                       | A        |

Read-only PostgreSQL verification confirmed:

- 8 departments, 8 programmes, 1 current academic year, 8 semesters, and 14
  sections.
- Every section is active, unarchived, and has a maximum capacity of 70.
- Zero duplicate department codes or names after normalized comparison.
- Zero duplicate programmes, academic years, semesters, section codes, or
  section names within their database scopes.
- Zero malformed legacy departments, hierarchy relationship mismatches, or
  over-capacity sections.
- Database constraints enforce normalized per-college department uniqueness,
  normalized per-department programme uniqueness, normalized per-semester
  section uniqueness, and section capacity between 1 and 70.

Safe, explicitly configured import aliases are active for the approved variants,
including `AIDS`, `AI&DS`, `AI-DS`, `AIML`, `AI&ML`, `AI-ML`, spaced forms, the
legacy `CSE(AI&ML)` label, and `ME` to `MECH`. Dangerous fuzzy matching is not
used.

## Admin Data Entry and Lifecycle

The authenticated Academic Setup workspace is available at:

`/admin/academic/departments-sections`

It provides a desktop department master-detail layout and phone department cards
with section counts. Authorized administrators can add and edit departments and
sections, manage active/archive state, restore records after ancestor validation,
view dependencies, and use guarded safe deletion. Section setup supports the
academic year, study year, semester, capacity, room, coordinator, and prospective
class staff fields.

The student-entry workflow at `/admin/people/new` now includes student-specific
personal, academic, and account fields. Department, programme, academic year,
study year, semester, and section choices cascade, and inactive or archived
sections are excluded. The backend serializes placement against hierarchy
lifecycle and capacity changes, rechecks active ancestors inside the transaction,
and rejects student 71 with a section-full response rather than relying on the
browser.

The Students flow in `/admin/imports` supports preview-before-confirmation with
the requested template columns:

`full_name`, `official_email`, `college_id`, `register_number`,
`department_code`, `academic_year`, `study_year`, `semester`, `section`,
`temporary_password`, and `mobile`.

Programme inference is allowed only when a department has one unambiguous active
programme. Preview and queued confirmation use the same parser-invalid and
transactional capacity rules; invalid rows cannot reserve seats from later valid
rows. Imported students use the same canonical placement service as manual
entry.

Department, programme, semester, academic-year, and section lifecycle mutations
share deterministic hierarchy locks with student placement. Archive, restore,
status, capacity, and safe-delete operations re-read their state inside the
transaction to prevent placement and deletion races.

## Live Academic Acceptance

A uniquely marked TEST student was used only for the authorized acceptance flow.
The full sequence passed:

1. Main Admin login and authorization.
2. Exact 8-department/14-section UI verification on desktop and at 320px.
3. Creation through the production student form into CSE-A.
4. PostgreSQL verification of the user, STUDENT role, SECTION scope, profile,
   and active membership.
5. Browser refresh and a Render redeploy of the exact same commit.
6. Verification that the same database identity and creation timestamp persisted.
7. UI move from CSE-A to CSE-B, including count and membership-history checks.
8. UI archive with active capacity released.
9. A fresh post-archive `PRE_DELETION`, `RESTORE_TESTED` backup.
10. Safe permanent cleanup through the application endpoint.

Cleanup removed the TEST account's credential, roles, scopes, contacts, and raw
student identifiers. Both historical section memberships are inactive and ended.
A database-wide scan found zero occurrences of the raw TEST identifier prefixes
in text or JSON columns. One archived, anonymized student profile and its two
ended memberships remain intentionally as historical integrity records; there is
no active TEST student and no TEST authentication path.

## Current Production Data State

The previous report described the database before the user's separately
authorized non-admin data purge. It must not be used as the current count
baseline. The final repeatable-read production snapshot is:

| Data                                  |                   Current count |
| ------------------------------------- | ------------------------------: |
| Public PostgreSQL tables              |                             143 |
| Total rows at fact-check snapshot     |                           3,128 |
| Users                                 |                               5 |
| Active users                          |                               4 |
| Archived anonymized TEST tombstones   |                               1 |
| Credentials                           |                               4 |
| Active Main Admin accounts            |                               1 |
| Staff profiles                        |                               3 |
| Student profiles                      | 1 anonymized historical profile |
| Active students                       |                               0 |
| Active section memberships            |                               0 |
| Ended TEST membership history         |                               2 |
| Roles / permissions                   |                        19 / 104 |
| Issues                                |                               0 |
| Conversations / messages              |                          33 / 0 |
| Announcements                         |                               0 |
| Attendance sessions / records         |                           0 / 0 |
| Skill courses / modules / lessons     |                   17 / 34 / 513 |
| Assessments / progress / certificates |                   1,019 / 0 / 0 |
| Audit logs at fact-check snapshot     |                             152 |

The four active accounts predate this academic acceptance run and were not
modified or removed by its cleanup. Production currently has no real active
student record to migrate or delete. The acceptance workflow added no remaining
active user or credential. Total rows, audit logs, sessions, and request metadata
are operationally volatile; the figures above are the final read-only snapshot,
not immutable quotas.

## Current Object Storage

The user's separately authorized purge also superseded the old 108-object storage
baseline. Final read-only enumeration found 3 private objects totaling 3,453,098
bytes. The current database contains one storage reference, that reference is
present, and there are zero missing referenced objects. No object key or signed
URL is included in this report.

## Main Admin Authentication

| Check                          | Result                             |
| ------------------------------ | ---------------------------------- |
| Account status and role        | `ACTIVE`, `MAIN_ADMIN`             |
| Forced password change         | Disabled after controlled rotation |
| Replacement credential storage | Protected local file outside Git   |
| Fresh login                    | HTTP 200                           |
| Authenticated identity lookup  | HTTP 200; identity matched         |
| Logout                         | HTTP 204                           |
| Same access token after logout | HTTP 401                           |

The previously exposed password is not the live password. No password, hash,
session token, signed URL, or other secret is included in this report, source
control, logs, or chat.

## Backup and Cleanup Gate

GitHub Actions run
https://github.com/devanand2008/AVSEC-ISSUES/actions/runs/31616042796
completed successfully before the initial academic rollout and verified an
isolated restore.

After the TEST student was archived, run
https://github.com/devanand2008/AVSEC-ISSUES/actions/runs/31623250036
created the backup that authorized safe cleanup.

| Post-archive backup gate              | Result                             |
| ------------------------------------- | ---------------------------------- |
| Type                                  | `PRE_DELETION`                     |
| Workflow commit                       | Exact release commit `78762683...` |
| PostgreSQL custom archive             | PASS                               |
| AES-256-GCM encryption and round trip | PASS                               |
| Isolated restore                      | PASS                               |
| Immutable restored-table manifest     | PASS                               |
| Latest restore test                   | `PASSED`                           |
| Database status                       | `RESTORE_TESTED`                   |
| Encrypted artifact                    | `avs-2026-08-12_23-04-20-IST`      |
| Artifact size                         | 671,312 bytes                      |
| Artifact expiry                       | 2026-09-11                         |
| Temporary plaintext cleanup           | PASS                               |

The safe-delete backend independently required the same-college, fresh
`PRE_DELETION` backup and its latest restore test to be passed. An older passed
test cannot override a later failed restore test.

The encrypted artifact is GitHub-hosted. Because this repository is public, the
ciphertext must not be described as private; the separate encryption key remains
outside Git. Google Drive upload was skipped because that integration is
disabled.

The configured daily schedule has also executed successfully. Scheduled run
https://github.com/devanand2008/AVSEC-ISSUES/actions/runs/31641202321 ran on the
exact release commit, verified the encryption round trip, and retained encrypted
artifact `avs-2026-08-13_02-40-00-IST` (671,867 bytes) through 2026-09-11. Daily
scheduled runs intentionally do not perform an isolated restore. Restore
assurance therefore relies on protected, manually dispatched restore-tested runs
such as `31623250036`.

## Automated Quality Gates

All final gates ran on Node.js 22.23.2 against the exact released tree.

| Gate                               | Result                             |
| ---------------------------------- | ---------------------------------- |
| API Jest                           | 67/67 suites, 529/529 tests passed |
| Web Vitest                         | 23/23 files, 145/145 tests passed  |
| API typecheck and ESLint           | PASS; zero warnings/errors         |
| Web typecheck and ESLint           | PASS; zero warnings/errors         |
| API production build               | PASS                               |
| Web production build               | PASS; 86/86 pages generated        |
| Prisma validate/generate           | PASS                               |
| Production dependency audit        | 0 vulnerabilities                  |
| Dependency-tree security assertion | PASS                               |
| Sensitive-file scan                | PASS                               |

Focused coverage includes the exact AVS matrix, normalized duplicates, same
section names in different departments, transactional capacity, student 71
rejection, manual and import placement, section filtering, archive/restore and
safe-delete dependencies, hierarchy concurrency, backup-proof freshness, and
responsive academic workspace styles.

## Live Runtime Verification

At the final independent check:

| Endpoint                     | Result                                       |
| ---------------------------- | -------------------------------------------- |
| `/health`                    | HTTP 200, ready, `EXTERNAL_PERSISTENT`       |
| `/health/live`               | HTTP 200                                     |
| `/health/ready`              | HTTP 200, PostgreSQL up, configuration valid |
| `/health/ready/dependencies` | HTTP 200, ready                              |

Sanitized Render logs from cleanup completion through the final independent check
covered 128 rows across two fully exhausted pages: zero errors, zero warnings,
zero application-emitted HTTP 5xx, zero database errors, and zero process
crashes.

A temporary Render edge HTTP 503 was consistent with the free-tier service waking
from an idle spin-down. Sanitized logs showed a normal cold-start sequence rather
than an application crash: no application-emitted 5xx, OOM, process exit,
database failure, or Redis failure was recorded, and the existing deployment
recovered without a restart or redeploy. The wake took approximately 82 seconds
for the gateway, migration/bootstrap checks, API, and web process to become
ready.

## Remaining Operational Limits

1. The Render service uses the free tier and can spin down after inactivity.
   Eliminating cold-start delays requires an always-on paid Render instance.
2. Google Drive backup integration and the in-app backup scheduler remain
   disabled. GitHub Actions scheduled backups are operating successfully and
   verify encryption integrity, while isolated-restore assurance relies on
   manually dispatched restore-tested backups.
3. Physical-device camera/QR testing, installed-PWA testing, a full Firefox
   matrix, and controlled production load testing remain outside the available
   environment.
4. The archived acceptance profile is intentionally retained in anonymized form
   for referential and audit history; it has no credential or authorization.

## Release Decision

**Academic hierarchy and web data-entry release: LIVE AND VERIFIED.**

The Department -> Programme -> Academic Year -> Semester -> Section hierarchy,
responsive administration workspace, manual student entry, import flow,
transactional capacity protection, Supabase persistence, same-commit redeploy,
student movement, archive, and backup-gated cleanup all passed production
acceptance.

**Formal unconditional cross-platform/disaster-recovery certification remains
limited by the operational items above.** No unresolved blocker is known for the
tested web academic workflows or Main Admin authentication.
