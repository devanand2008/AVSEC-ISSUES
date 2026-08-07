# Supabase and Render Production Fix Report

**Report date:** 2026-08-07

**Repository:** `devanand2008/AVSEC-ISSUES`

**Render service:** `avs-college-portal`

**Public URL:** `https://avs-college-portal.onrender.com`

**Current live database:** `avs_college`

**Validated staged database:** `avs_college_import_20260806`
**Production mode:** `EXTERNAL_PERSISTENT`

This is a redacted operational report. Secret environment values, connection
credentials, password material, private object names, and session tokens are
intentionally omitted.

## Current Status

The supported Docker deployment is online and connected securely to Supabase
PostgreSQL. The current live database still contains bootstrap data and remains
untouched as the rollback target. A separate Supabase database has been restored
atomically from the authoritative source and matched all 143 source table counts
at 7,425 rows before controlled transient cleanup. Supabase object storage also
contains a fully verified copy of the source objects. The Render database cutover
and live acceptance transactions remain pending.

## Issue and Fix Matrix

| Area | Finding | Implemented remediation | Verification status |
|---|---|---|---|
| Original Render build | Native Node build omitted the Nest CLI in production dependency installation | Root Docker build installs build dependencies and copies the generated Prisma client; commit `8afb0ea` fixed runtime packaging | **PASS:** current service and health endpoints are online |
| PostgreSQL TLS/configuration | Render must use a persistent external PostgreSQL connection with the Supabase CA | Docker secret-file CA and verified TLS connection are configured | **PASS:** read-only PostgreSQL 17 query and `/health/ready` succeeded |
| Production data | Current live `avs_college` contains 797 business rows versus 7,382 in the source | Atomic restore into `avs_college_import_20260806`; exact 143-table/7,425-row pre-cleanup parity | **PASS: staged; cutover pending** |
| AVS Skill | Current live has no AVS Skill rows | All source AVS Skill rows are present in the isolated restore | **PASS: staged; cutover pending** |
| Main Admin data | Current live contains an independently bootstrapped Main Admin | Complete source record is present in the isolated restore | **PASS: staged; live login pending** |
| Password pepper | Imported local hashes do not include Render's production pepper | Guarded legacy verification plus immediate peppered re-hash in commit `088e089` | **IMPLEMENTED; post-import test pending** |
| Add Person button | The earlier page had no complete creation destination/workflow | Commit `088e089` adds `/admin/people/new`; API focused 26/26 and web full 88/88 pass | **IMPLEMENTED; live transaction pending** |
| Downloaded app login | Native default previously resolved to loopback/local API | Commit `088e089` uses the Render HTTPS API; Flutter 7/7, analysis, and format pass | **IMPLEMENTED; rebuilt artifact test pending** |
| Private storage | Source objects needed to be available in Supabase | Objects are present in the configured private bucket | **PASS:** 108 objects verified by key, size, MIME metadata, and SHA-256 |

## Executed Production Evidence

| Evidence | Result | Status |
|---|---|---|
| Render `/health/live` | HTTP 200 | **PASS** |
| Render `/health/ready` | HTTP 200; PostgreSQL up; Prisma generated; configuration valid | **PASS** |
| Render login page | HTTP 200 | **PASS** |
| Supabase catalog | PostgreSQL 17; 143 public tables | **PASS** |
| Current target data | 21 non-empty tables; 797 business rows; 1 user | **PASS: state measured; migration gap confirmed** |
| Source data | 90 non-empty tables; 7,382 business rows; 40 users | **PASS** |
| Source dump | 1,113,593 bytes; abbreviated SHA-256 `405E...FF12` | **PASS** |
| Atomic isolated restore | 143 tables; 7,425 rows; zero table-count mismatches before transient cleanup | **PASS** |
| Transient cleanup | Refresh tokens 671; sessions 452; password-reset tokens 12; idempotency records 32; pending outbox records 25 | **PASS** |
| Old-live backup | 513,997 bytes; abbreviated SHA-256 `EF2F...A975` | **PASS** |
| Old-live backup restore test | Exactly 143 tables and 836 rows | **PASS** |
| Object parity | 108 objects; 2,686,456 bytes; keys, MIME metadata, size, and hash match | **PASS** |
| API focused tests | 26/26 | **PASS** |
| API typecheck and build | Completed successfully | **PASS** |
| Full API suite | Timed out after five minutes; no complete suite result | **PENDING / TIMEOUT** |
| Web full tests | 88/88 | **PASS** |
| Web typecheck, lint, and build | Completed successfully; 85 routes generated | **PASS** |
| Flutter validation | 7/7 tests; analysis and format check succeeded | **PASS** |
| Configuration/security scans | Completed successfully | **PASS** |
| Live Add Person acceptance | Not executed | **PENDING** |
| Native downloadable-app acceptance | Not executed | **PENDING** |
| Render database cutover | Current app remains on `avs_college` | **PENDING** |
| Post-cutover Main Admin login | Not executed | **PENDING** |

The source dump and the old-live backup have both passed restore-based checks.
The timed-out full API suite is not counted as passed; its complete result remains
pending even though the focused API checks, typecheck, and build succeeded.

## Required Safe Database Cutover

The current live target contains bootstrap UUIDs and unique values, so merging
rows into it remains unsafe. The blue/green preparation is complete; cutover is
not.

| Step | Status |
|---|---|
| Capture and fingerprint the authoritative source dump | **PASS** |
| Back up the old live `avs_college` database | **PASS** |
| Restore-test the old-live backup at 143 tables/836 rows | **PASS** |
| Create isolated `avs_college_import_20260806` | **PASS** |
| Restore atomically and compare every table count | **PASS: 143 tables, 7,425 rows, zero mismatches** |
| Remove only recorded transient authentication/request/queue state | **PASS** |
| Validate application code and configuration | **PASS**, except full API suite **PENDING / TIMEOUT** |
| Change Render's database connection | **PENDING** |
| Redeploy against staged database | **PENDING** |
| Test health and Main Admin login after cutover | **PENDING** |
| Run one reversible Add Person transaction | **PENDING** |
| Test AVS Skill and private attachments through the live application | **PENDING** |
| Install and test a rebuilt downloadable application | **PENDING** |

Keep Render on `avs_college` until the pending cutover is deliberately started.
After cutover, retain both databases and the authoritative source until the
rollback window closes.

## Minimum Post-Restore Counts

These source snapshot values were matched in the isolated restore before the
recorded transient cleanup. If the source receives new institutional writes
before cutover, reconcile them deliberately rather than silently overwriting the
staged database.

| Domain | Expected snapshot count |
|---|---:|
| Public tables | 143 |
| Users | 40 |
| User credentials | 40 |
| Courses | 17 |
| Course modules | 34 |
| Course lessons | 513 |
| Course assessments | 1,019 |
| Assessment results | 54 |
| Student progress | 46 |
| Learning certificates | 2 |
| Issues | 23 |
| Issue attachments | 29 |
| Messages | 68 |
| Announcements | 1 |
| Audit logs | 873 |

## Authentication Cutover Control

`LEGACY_UNPEPPERED_PASSWORD_MIGRATION_ENABLED` is a temporary compatibility
gate, not a permanent production setting. With the gate enabled, the server:

1. tries the normal password plus production pepper;
2. only if that fails, tries the legacy unpeppered form;
3. after a successful legacy match, immediately stores a new hash using the
   production pepper.

After imported users have authenticated or received an administrator-controlled
reset, set the gate to `false` and redeploy. A successful Main Admin login must
be repeated after disabling the gate.

## Rollback Conditions

Switch Render back to the retained `avs_college` connection if any of these occur
after cutover:

- health readiness fails;
- source/target counts do not match the final snapshot;
- Main Admin authentication fails;
- Add Person creates a partial record or returns a server error;
- AVS Skill records are missing;
- a referenced private object cannot be downloaded;
- migration history contains a pending or failed record.

Do not delete either database or any object during rollback. Capture logs and
diagnostics first.

## Production Approval

**Pending.** The Render runtime, Supabase connection, atomic isolated restore,
exact pre-cleanup table-count comparison, old-live backup restore test, focused
code validation, and object copy pass. The full API suite remains
**PENDING / TIMEOUT**. Render cutover, post-cutover login, live People and
attachment transactions, AVS Skill acceptance, and rebuilt-app login remain
**PENDING**.
