# AVS College Management System

# Final Production Release Report

**Report state:** LIVE — STUDENT REGISTRATION ACADEMIC RELEASE ACCEPTED

**Last updated:** 2026-08-14 (Asia/Kolkata)

**Public URL:** https://avs-college-portal.onrender.com/

**Repository:** https://github.com/devanand2008/AVSEC-ISSUES

## Release Identity

| Item                      | Verified value                                       |
| ------------------------- | ---------------------------------------------------- |
| Final executable commit   | `dcd790de3793da10139b40d1b57ff59423ab1844`           |
| Render deployment         | `dep-d9v6jrfavr4c73abi2s0`                           |
| Deployment status         | `live`                                               |
| Deployment completed      | 2026-08-14 06:40:53 IST                              |
| Feature acceptance commit | `741c3047001c734efa120b4a3ad83edc1310068b`           |
| Existing Render service   | `avs-college-portal`; no replacement service created |
| Database                  | Existing persistent Supabase PostgreSQL              |
| Schema state              | 42 migrations applied; schema up to date             |

The complete Student Registration Academic acceptance ran against application
commit `741c3047001c734efa120b4a3ad83edc1310068b`. Final commit
`dcd790de3793da10139b40d1b57ff59423ab1844` changes only the production
`nanoid` dependency pin and the dependency-tree validator/test. The accepted
application code was rebuilt, passed the full gates again, and was redeployed as
`dep-d9v6jrfavr4c73abi2s0`.

PostgreSQL was not reset. Existing production data was not replaced with JSON,
browser storage, or Render filesystem state.

## Academic Masters and Hierarchy

Production contains the normalized hierarchy:

```text
College
  -> Department
    -> Programme
      -> Academic Year
        -> Study Year
          -> Semester
            -> Section
              -> Student academic membership
```

Department short codes and professional names are stored separately. Sections
are children of their academic scope and are not encoded as fake department
names such as `CSE(A)`.

| Short code | Professional name                            | Degree  | Logical sections |
| ---------- | -------------------------------------------- | ------- | ---------------- |
| AI & ML    | Artificial Intelligence and Machine Learning | B.E.    | A                |
| AI & DS    | Artificial Intelligence and Data Science     | B.Tech. | A, B, C          |
| CSE        | Computer Science and Engineering             | B.E.    | A, B, C          |
| IT         | Information Technology                       | B.Tech. | A, B             |
| ECE        | Electronics and Communication Engineering    | B.E.    | A, B             |
| EEE        | Electrical and Electronics Engineering       | B.E.    | A                |
| MECH       | Mechanical Engineering                       | B.E.    | A                |
| BME        | Biomedical Engineering                       | B.E.    | A                |

The configured Academic Years are `2022-2023` through `2029-2030`, with
`2026-2027` current. Study Years and their valid semesters are:

| Study Year | Allowed semesters |
| ---------: | ----------------- |
|          1 | 1 and 2           |
|          2 | 3 and 4           |
|          3 | 5 and 6           |
|          4 | 7 and 8           |

Read-only production verification returned:

| Item                          | Verified value |
| ----------------------------- | -------------: |
| Degree types                  |              2 |
| Departments                   |              8 |
| Programmes                    |              8 |
| Academic Years                |              8 |
| Semester rows                 |            512 |
| Section rows                  |            896 |
| Minimum / maximum section cap |        70 / 70 |
| Active student memberships    |              0 |
| Non-active student profiles   |              2 |
| Historical membership records |              4 |

The 14 logical AVS department-section combinations are materialized within the
appropriate programme, Academic Year, Study Year, and semester scopes, producing
896 persistent section rows. This supersedes older reports that described only
14 database rows.

Verification found zero duplicate departments, programmes, Academic Years,
semesters, or scoped sections, and zero over-capacity sections. Import aliases
remain explicit and deterministic; uncertain values are not fuzzy-matched.

## Student Registration and Academic Lifecycle

The Admin Add Person workflow at `/admin/people/new` now provides the complete
student registration path:

1. Personal information.
2. Degree and department.
3. Programme and Academic Year.
4. Study Year, semester, and department-filtered section.
5. Account review and creation.

The selection chain is enforced in both the UI and API. Changing a parent value
clears invalid child selections, inactive or archived academic records are not
selectable, and a department cannot display another department's sections.

Student placement is persisted in PostgreSQL with academic membership history.
Promotion or transfer closes the previous membership, opens the new membership,
and updates section counts. Section capacity is 70 and is enforced
transactionally by the backend. Automated coverage verifies that student 71 is
rejected; production acceptance did not fill a real section merely to exercise
that boundary.

The responsive Admin flow was exercised at 320×568, 360×800, 375×812, 390×844,
412×915, and 430×932. All tested widths completed without detected horizontal
overflow.

## Production Acceptance Results

One uniquely marked temporary TEST student was used. No real student record was
deleted or repurposed.

| Acceptance check                                   | Result |
| -------------------------------------------------- | ------ |
| Main Admin login and authorization                 | PASS   |
| B.E. and B.Tech. masters                           | PASS   |
| Degree-to-department/programme filtering           | PASS   |
| Previous, current, and future Academic Years       | PASS   |
| Study Years 1–4                                    | PASS   |
| Exact semester filtering                           | PASS   |
| Department-to-section filtering                    | PASS   |
| Create TEST student in CSE-A                       | PASS   |
| PostgreSQL role, scope, profile, and membership    | PASS   |
| Refresh persistence                                | PASS   |
| Same-code Render redeploy persistence              | PASS   |
| Promote to CSE-B in the next academic scope        | PASS   |
| Membership history and section-count update        | PASS   |
| Archive and active-capacity release                | PASS   |
| Backup-gated safe cleanup                          | PASS   |
| Duplicate academic-master protection               | PASS   |
| Same section name allowed in different departments | PASS   |
| Archived section excluded from new placement       | PASS   |
| Backend rejection of student 71                    | PASS   |
| Tested phone viewport matrix                       | PASS   |

After archive, safe cleanup removed the temporary credential, user roles,
authorization scopes, contacts, and raw TEST identifiers. A database-wide scan
of text and JSON columns found no raw TEST identifier residue. An anonymized
student tombstone and ended memberships are retained intentionally for
referential and audit history. Together with one earlier safely anonymized
acceptance record, production now has two valid anonymized student tombstones;
neither has an authentication path. The current totals are two non-active
student profiles, four historical membership records, and zero active student
memberships.

## Backup and Cleanup Evidence

The release used the mandatory backup gates; no database reset was performed.

| Gate                   | Evidence                                                                               |
| ---------------------- | -------------------------------------------------------------------------------------- |
| Pre-migration backup   | Run `31716643093` on `6a3eaea69d90df563beee798dabcaa9873a61025`; isolated restore PASS |
| Pre-migration artifact | `avs-2026-08-13_21-10-39-IST`; 682,317 encrypted bytes                                 |
| Pre-deletion backup    | Run `31755162342` on `741c3047001c734efa120b4a3ad83edc1310068b`; isolated restore PASS |
| Pre-deletion artifact  | `avs-2026-08-14_05-18-57-IST`; 935,084 encrypted bytes                                 |
| Restore status         | Manifest, encryption round trip, isolated restore, and backup registration all PASS    |
| Artifact expiry        | Pre-deletion artifact retained through 2026-09-12                                      |
| Plaintext handling     | Temporary plaintext cleanup PASS                                                       |

The post-archive backup was registered as restore-tested before the safe cleanup
endpoint was allowed to proceed. No backup key, database URL, provider UUID, or
other secret is included here. Google Drive upload was skipped because that
integration is disabled.

## Final Automated Quality Gates

All final gates ran on Node.js 22.23.2 against executable commit
`dcd790de3793da10139b40d1b57ff59423ab1844`.

| Gate                               | Result                             |
| ---------------------------------- | ---------------------------------- |
| API Jest                           | 70/70 suites, 564/564 tests passed |
| Web Vitest                         | 28/28 files, 193/193 tests passed  |
| API typecheck                      | PASS                               |
| API lint                           | PASS                               |
| API production build               | PASS                               |
| Web typecheck                      | PASS                               |
| Web lint                           | PASS                               |
| Web production build               | PASS; 90 pages generated           |
| Production dependency audit        | PASS; 0 vulnerabilities            |
| Dependency-tree security validator | PASS                               |
| Validator mutation tests           | PASS; 4/4                          |
| Production `nanoid` version        | `3.3.18`                           |

## Live Runtime Verification

The final deployment was checked after the application reported ready:

| Check                        | Result                                                  |
| ---------------------------- | ------------------------------------------------------- |
| `/health`                    | HTTP 200; ready; `EXTERNAL_PERSISTENT`                  |
| `/health/live`               | HTTP 200; ok                                            |
| `/health/ready`              | HTTP 200; Prisma generated; PostgreSQL up; config valid |
| `/health/ready/dependencies` | HTTP 200; ready; `EXTERNAL_PERSISTENT`                  |
| Prisma migration status      | 42 migrations; schema up to date                        |
| Required web routes          | HTTP 200; no route-level 404                            |

Complete sanitized logs for deployment creation through the final audit covered
1,249 unique rows. The stabilized post-API-ready slice contained zero warnings,
errors, HTTP 4xx/5xx responses, database/Redis/storage failures, authentication
error signals, or crash signals. Startup contained only three known framework
route-conversion warnings and four transient gateway-to-API connection refusals
before Nest became ready; none continued after readiness.

## Operational Scope and Limits

- Render deployment `dep-d9v6jrfavr4c73abi2s0` reached `live` at
  2026-08-14 06:40:53 IST.
- Production schema verification found 42 applied migrations and no pending
  application migration.
- Responsive acceptance used Chromium viewport emulation. It is strong browser
  layout evidence, but not a physical-device certification.
- Firefox, Safari, installed-PWA, physical camera/QR, and controlled production
  load testing were outside this acceptance run.
- Google Drive mirroring remains disabled; verified encrypted GitHub Actions
  backup artifacts provide the recorded backup evidence.

## Release Decision

**The Student Registration Academic release is live and accepted for the tested
production workflow.**

The masters, cascades, capacity controls, student creation, PostgreSQL
persistence, refresh/redeploy persistence, promotion, history, archive, and
backup-gated cleanup all passed. No unresolved error remains in the tested
workflow, and no temporary TEST credential or raw identifier remains active or
stored.
