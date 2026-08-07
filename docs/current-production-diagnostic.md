# Current Production Diagnostic

**Audit date:** 2026-08-07

**Audit window:** 08:33-08:46 Asia/Kolkata

**Application:** AVS College Management System

**Public service:** `https://avs-college-portal.onrender.com`

**Current live database:** Supabase PostgreSQL database `avs_college`

**Validated staged database:** `avs_college_import_20260806`
**Object-storage target:** Supabase S3-compatible private bucket `college-private`

This report is redacted. It contains no database passwords, access keys, token
values, password hashes, private object names, or unredacted connection strings.
All diagnostic comparison queries used read-only transactions. The controlled
migration workflow separately performed the isolated atomic restore and the
recorded transient cleanup. It did not cut Render over, replace the current live
database, or delete either backup source.

## Outcome

The Render service and its Supabase connection are healthy. Render intentionally
still points to `avs_college`, which contains only the bootstrap college, RBAC
records, and one Main Admin. This explains why the current live application does
not yet show the existing People, AVS Skill/Learn content, issues, messages, and
other operational data.

The authoritative PostgreSQL dump has now been restored atomically into the
isolated database `avs_college_import_20260806`. Before deliberate transient-data
cleanup, all 143 table counts matched the source exactly: 7,425 rows with zero
table-count mismatches. The old live database was also backed up and restore-tested
exactly at 143 tables and 836 rows. The final Render cutover remains pending.

All 108 local MinIO objects are present in Supabase and match by key, byte count,
MIME metadata, and content hash.

## Executed Checks

| Check | Observed result | Status |
|---|---|---|
| `GET /health/live` | HTTP 200 | **PASS** |
| `GET /health/ready` | HTTP 200; `ready`; Prisma generated; PostgreSQL up; configuration valid | **PASS** |
| `GET /health` | HTTP 200 | **PASS** |
| `GET /login` | HTTP 200; HTML returned | **PASS** |
| Source PostgreSQL inventory | PostgreSQL 17, 143 public tables, full AVS data present | **PASS** |
| Supabase target inventory | PostgreSQL 17, 143 public tables, bootstrap-only data confirmed | **PASS** |
| Isolated Supabase restore | Atomic restore; 143 tables and 7,425 rows; zero table-count mismatches before transient cleanup | **PASS** |
| Old live database backup restore test | 143 tables and 836 rows restored exactly | **PASS** |
| Controlled transient cleanup | Refresh tokens 671; sessions 452; password-reset tokens 12; idempotency records 32; pending outbox records 25 | **PASS** |
| Source-to-target object comparison | 108/108 objects and 2,686,456/2,686,456 bytes matched by key, size, MIME metadata, and SHA-256 | **PASS** |
| API focused tests | 26/26 | **PASS** |
| API typecheck and production build | Completed successfully | **PASS** |
| Web full test suite | 88/88 | **PASS** |
| Web typecheck, lint, and production build | Completed successfully; 85 routes generated | **PASS** |
| Flutter tests, analysis, and format check | 7/7 tests; analysis and formatting succeeded | **PASS** |
| Configuration and sensitive-file/security scans | Completed successfully | **PASS** |
| Full API suite | Exceeded the five-minute execution window; no complete result | **PENDING / TIMEOUT** |
| Current production Main Admin login | Not executed during this read-only audit | **PENDING** |
| Add Person browser/API transaction | Not executed against production | **PENDING** |
| Downloaded Flutter application login | No rebuilt physical-device artifact was installed during this audit | **PENDING** |
| Render cutover to the complete data set | Not executed | **PENDING** |

The earlier 2026-08-06 deployment check reached the Main Administrator dashboard,
but that does not replace a fresh login test after the pending database cutover
and final deployment.

## Source, Staged Restore, and Current Live Comparison

Counts below were obtained with exact `count(*)` queries. "Business rows" excludes
only `_prisma_migrations`.

The staged values in this table describe the exact post-restore snapshot before
the deliberate transient cleanup. That cleanup does not remove institutional
People, AVS Skill, issue, message, attachment, or audit-history records.

| Data set | Source `college_management` | Staged restore | Current live `avs_college` | Result |
|---|---:|---:|---:|---|
| Public tables | 143 | 143 | 143 | Staged restore matches source |
| All rows | 7,425 | 7,425 | 836 | Staged restore matches source; live cutover pending |
| Business rows | 7,382 | 7,382 | 797 | Staged restore matches source; live cutover pending |
| Prisma migration records | 43 | 43 | 39 | Source/stage include 39 applied plus 4 rolled-back audit records |
| Colleges | 1 | 1 | 1 | College `6201` is preserved |
| Users | 40 | 40 | 1 | Staged restore matches; current live is bootstrap-only |
| User credentials | 40 | 40 | 1 | Staged restore matches; current live is bootstrap-only |
| Roles | 19 | 19 | 19 | Matches |
| Permissions | 104 | 104 | 104 | Matches |
| Issues | 23 | 23 | 0 | Staged restore matches; live cutover pending |
| Issue attachments | 29 | 29 | 0 | Staged restore matches; live cutover pending |
| Messages | 68 | 68 | 0 | Staged restore matches; live cutover pending |
| Announcements | 1 | 1 | 0 | Staged restore matches; live cutover pending |
| Audit logs | 873 | 873 | 27 | Staged history preserved; live cutover pending |

## AVS Skill / Learn Inventory

The AVS Skill data exists in the authoritative source and is absent from the
current Supabase target.

| AVS Skill table | Source | Staged restore | Current live | Status |
|---|---:|---:|---:|---|
| Courses | 17 | 17 | 0 | Staged and verified; cutover pending |
| Course modules | 34 | 34 | 0 | Staged and verified; cutover pending |
| Course lessons | 513 | 513 | 0 | Staged and verified; cutover pending |
| Course assessments | 1,019 | 1,019 | 0 | Staged and verified; cutover pending |
| Assessment results | 54 | 54 | 0 | Staged and verified; cutover pending |
| Student progress | 46 | 46 | 0 | Staged and verified; cutover pending |
| Learning certificates | 2 | 2 | 0 | Staged and verified; cutover pending |

## Main Admin Inventory

| Field | Source | Staged restore | Current live |
|---|---|---|---|
| College identity | `ADM001` | `ADM001` | `ADM001` |
| Email | `de***@college.com` | `de***@college.com` | `de***@college.com` |
| Display name | Devanand | Devanand | Main Administrator |
| Account status | Active | Active | Active |
| Primary role | Main Admin | Main Admin | Main Admin |
| Forced password change | No | No | No |
| Credential row | Present | Present | Present |

The complete Devanand record is present in the isolated staged restore. The
different display name in the current live database confirms that Render has not
yet been cut over from the independently bootstrapped record.

## Diagnostic Findings

### 1. PostgreSQL data is staged but not live

The production connection itself is working. The source data has been restored
and validated in an isolated Supabase database, but Render still uses the old
bootstrap database. Only the final configuration cutover and live acceptance
remain; the current live database must be retained until those checks pass.

### 2. Add Person workflow

Repository commit `088e089` adds the `/admin/people/new` page and connects both
Add Person buttons to that route. The source also contains the required roles,
permissions, departments, programmes, sections, and other reference data.

The automated web suite passes 88/88, and the API focused suite passes 26/26 with
successful typecheck and build. The full API suite timed out after five minutes,
so it is not claimed as passed. A live production create-and-cleanup acceptance
test remains pending until after cutover.

### 3. Downloaded application connection error

The earlier native Flutter default used a loopback API address, which points to
the user's own phone or computer rather than Render. Commit `088e089` changes the
native default to the Render HTTPS API while retaining same-origin behavior for
Flutter Web.

The source fix is present, and Flutter validation passes 7/7 tests plus analysis
and formatting. A newly built downloadable artifact must still be installed and
tested. Previously downloaded binaries do not receive this source change
automatically.

### 4. Imported-password compatibility

The local source hashes were created before a production password pepper was
configured. Render uses a strong generated pepper. Commit `088e089` includes a
guarded compatibility path that verifies a legacy unpeppered password once and
immediately re-hashes it with the production pepper after successful login.

That path must be enabled only for the controlled import window, tested after
cutover, and disabled after all migrated accounts have logged in or been reset.
No password or hash is recorded in this report.

## Data-Preservation Requirements

1. Keep `college_management` and its MinIO bucket unchanged as the authoritative
   rollback source.
2. Preserve the source dump: 1,113,593 bytes, abbreviated SHA-256
   `405E...FF12`.
3. Preserve the restore-tested old-live backup: 513,997 bytes, abbreviated
   SHA-256 `EF2F...A975`; it restored exactly to 143 tables and 836 rows.
4. Keep Render on `avs_college` until final cutover authorization and acceptance.
5. Keep `avs_college_import_20260806` isolated and unchanged except for the
   recorded transient cleanup.
6. Reuse the verified Supabase bucket; do not run a destructive mirror or object
   deletion.
7. Retain the old database for rollback until login, Add Person, AVS Skill,
   attachments, messages, and health checks all pass on the replacement.

## Production Acceptance Status

**Not complete.** HTTP service health, isolated database restoration, exact
source/stage table-count parity, old-live backup restore testing, code validation,
and object-storage parity pass. The full API suite remains **PENDING / TIMEOUT**.
Render cutover, post-import login, live People creation, attachment transactions,
and a rebuilt downloadable-app login remain **PENDING**.
