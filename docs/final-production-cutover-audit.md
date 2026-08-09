# AVS College Management System — Pre-Fix Production Cutover Audit

**Audit started:** 2026-08-09 (Asia/Kolkata)  
**Public URL:** `https://avs-college-portal.onrender.com`  
**Repository:** `https://github.com/devanand2008/AVSEC-ISSUES`

This document records the state observed before this repair/cutover run. Secret
values, database usernames, passwords, connection strings, password material,
private object keys, and access tokens are intentionally omitted.

## Cutover Gate

**Status: BLOCKED — no production database configuration has been changed.**

### Continuation access check — 2026-08-09

The operator reports that the required Render and Supabase browser sessions are
authenticated. This execution environment cannot attach to those sessions: no
browser-control connector is available, the running Chrome instance has no
DevTools/CDP endpoint, and no cutover secret file or terminal secret variables
are visible. The sessions therefore remain unverified and unusable by the
cutover process. No Chrome profile, unrelated tab, history, saved password, or
unrelated cookie was inspected. No database or Render setting was changed.

The application is reachable, but this run does not currently have an
authorised Render control-plane session/API token or either Supabase PostgreSQL
connection URL. The two logical backup artifacts described by the 2026-08-07
audit are also not present in the workspace or the documented backup directory.
The old and restored databases therefore cannot yet be freshly dumped and
archive-verified. The master cutover rules prohibit changing `DATABASE_URL`
until both backups pass.

A credential for the intended imported Main Admin is present in tracked project
documentation. Its value is deliberately not repeated here. Treat that
credential as compromised and rotate it through an authorised, backup-protected
workflow before exposing the restored database to production.

## Source and Deployment Identity

| Item | Observed value | Evidence/status |
|---|---|---|
| Current local Git commit | `2ebe0bcc1ad003d12263e3671af2f5029a2fbae9` | Fresh `git rev-parse HEAD` |
| Current `origin/main` commit | `2ebe0bcc1ad003d12263e3671af2f5029a2fbae9` | Fresh fetch; local HEAD matches |
| Render deployment commit | `2ebe0bcc1ad003d12263e3671af2f5029a2fbae9` | GitHub deployment API, Render GitHub App |
| GitHub deployment record | `5789032953` | State `success` at 2026-08-07 05:00:57 UTC |
| Render deployment ID | `dep-d9qmbvpt0dsc738avq60` | Render deployment target linked from GitHub |
| Render service ID | `srv-d9q231jm8hqs73dqr480` | Render deployment target linked from GitHub |
| Render revision | `main` at `2ebe0bc` | Production environment `main - avs-college-portal` |
| Working tree at audit start | Modified | Three pre-existing tracked advisory-lock changes plus unrelated untracked directories; preserved |

## Application Layout

| Item | Path/configuration |
|---|---|
| Frontend workspace | `apps/web` (`@college/web`), Next.js 16 / React 19 |
| Backend workspace | `apps/api` (`@college/api`), NestJS 11 |
| Prisma schema | `apps/api/prisma/schema.prisma` |
| Prisma generated client | `apps/api/src/generated/prisma` |
| Prisma migrations | `apps/api/prisma/migrations` |
| Production container | Root `Dockerfile` with `scripts/render-start.sh` and `scripts/unified-server.mjs` |
| Health routes | `/health`, `/health/live`, `/health/ready` (outside `/api/v1`) |

## Current Live Render State

Fresh unauthenticated checks on 2026-08-09:

| Check | Result |
|---|---|
| `GET /health` | HTTP 200; `ready`; `EXTERNAL_PERSISTENT` |
| `GET /health/live` | HTTP 200; `ok` |
| `GET /health/ready` | HTTP 200; Prisma generated, PostgreSQL up, configuration valid |
| Backup readiness component | Google Drive disabled; readiness reports backups degraded |
| `GET /login` | HTTP 200; AVS Engineering College login shell returned |
| HTTPS/HSTS | HTTPS active; API response includes one-year HSTS with subdomains |
| Production database host | Supabase PostgreSQL; exact host redacted and not freshly inspectable without Render/database access |
| Production database name | `avs_college` in the last authorised 2026-08-07 diagnostic; fresh direct verification pending |

The last authorised direct database comparison (2026-08-07) recorded the live
bootstrap database as follows. These are historical verified values, not claimed
as a fresh 2026-08-09 direct query:

| Live bootstrap measurement | Last verified value |
|---|---:|
| Public tables | 143 |
| Total rows | 836 |
| Business rows (excluding Prisma migration rows) | 797 |
| Users | 1 |
| Issues | 0 |
| Messages | 0 |
| Announcements | 0 |
| AVS Skill courses | 0 |
| AVS Skill modules | 0 |
| AVS Skill lessons | 0 |
| AVS Skill assessments | 0 |
| Audit logs | 27 |
| Prisma migration rows | 39 |

## Restored Database and Authoritative Source

| Item | Observed value/status |
|---|---|
| Restored database host | Same Supabase PostgreSQL project/provider as live; exact host redacted and current credentials unavailable |
| Restored database name | `avs_college_import_20260806` |
| Last isolated restore verification | 2026-08-07; 143 tables, 7,425 rows, zero table-count mismatches before recorded transient cleanup |
| Fresh local authoritative-source verification | 2026-08-09; read-only transaction against local `college_management` |

Fresh local authoritative-source counts:

| Measurement | Count |
|---|---:|
| Public tables | 143 |
| Total rows | 7,425 |
| Users | 40 |
| Issues | 23 |
| Messages | 68 |
| Announcements | 1 |
| AVS Skill courses (`courses`) | 17 |
| AVS Skill modules (`course_modules`) | 34 |
| AVS Skill lessons (`course_lessons`) | 513 |
| AVS Skill assessments (`course_assessments`) | 1,019 |
| AVS Skill progress (`student_progress`) | 46 |
| AVS Skill certificates (`learning_certificates`) | 2 |
| Audit logs | 873 |
| Prisma migration rows | 43 |

The last authorised staged-restore comparison reported the same counts for the
institutional data above. Fresh direct queries against
`avs_college_import_20260806`, relationship checks, orphan checks, and migration
status remain pending authorised database access.

## Backup Inventory

| Required artifact | Prior audit evidence | Fresh 2026-08-09 status |
|---|---|---|
| Current live/bootstrap logical backup | 513,997-byte custom-format archive; abbreviated checksum `EF2F…A975`; restore-tested at 143 tables / 836 rows | Artifact not found locally; must be recreated and fully verified before cutover |
| Restored/source logical backup | 1,113,593-byte custom-format archive; abbreviated checksum `405E…FF12`; source/stage comparison passed | Artifact not found locally; must be recreated and fully verified before cutover |
| Workspace backup directory | Historical July dumps exist | Does not contain either required August artifact |
| Fresh local authoritative-source backup | Not part of the prior audit | `backups/college-20260809-084423.dump`; 1,113,593 bytes; SHA-256 sidecar and count manifest created; `pg_restore --list` readable; 143 table-data entries; `_prisma_migrations` present |

Neither prior report alone substitutes for the master prompt's required fresh
existence, size, checksum, archive readability, `_prisma_migrations`, and
critical-count-manifest checks. The fresh local source backup is a useful
additional recovery artifact, but it does not replace fresh logical backups of
both the current Supabase bootstrap database and the isolated restored Supabase
database.

## Main Admin Baseline

The 2026-08-07 authorised audit found one intended imported Main Admin selected
by college identity, college, active status, primary role, and credential row.
Fresh restored-database role/scope/permission/hash verification and post-cutover
login have not run in this session. A plaintext password for that account is
tracked in repository documentation, so cutover must not proceed until the
credential is securely replaced or invalidated and the documentation exposure
is remediated. No password or hash is recorded here.

## Object Storage

| Item | Last verified state / current observation |
|---|---|
| Provider | Supabase S3-compatible private storage |
| Bucket | `college-private` |
| Object count | 108 source and 108 destination objects |
| Total bytes | 2,686,456 on each side |
| Hash/MIME/key verification | 108/108 matched on 2026-08-07 |
| Database reference coverage | 98/102 unique referenced keys present; four pre-existing source gaps documented |
| Current application signed-download verification | Pending post-cutover authenticated acceptance |

## PWA and Runtime Routing

| Item | Observed value |
|---|---|
| Current service-worker cache | `college-shell-v5` |
| Frontend API base | `/api/v1` by production default; same-origin |
| WebSocket configuration | `/realtime` Socket.IO namespace on the current origin; production transport resolves over HTTPS/WSS |
| Service-worker API policy | All `/api/*`, `/health*`, and `/socket.io*` requests bypass the cache |
| Obsolete caches | Activation deletes older `college-shell-*` versions |

## Read-Only Live Browser Baseline

Playwright drove the installed Google Chrome browser against the public Render
URL without credentials or form submissions. Root navigation returned HTTP 200
and redirected an unauthenticated visitor to `/login`; protected routes also
redirected to login. Chrome showed no uncaught page errors or failed static
assets. The login readiness state changed from connecting to ready after both
health checks succeeded.

| Check | Result |
|---|---|
| Required public routes | Login, forgot-password, offline, unauthorized, and suspended pages returned HTTP 200 |
| Unknown route | Correct HTTP 404 |
| Chrome responsive widths | No horizontal overflow at 320, 360, 375, 390, 412, 430, 768, 1024, 1366, or 1440 pixels |
| 320×568 layout | **FAIL:** fixed Install App control overlaps login-page content |
| Edge smoke | Installed Edge rendered `/login` without page/request errors |
| Firefox | Not available / not executed |
| Anonymous PWA | Worker registered and activated; offline shell worked; auth API remained network-only |
| Installed-PWA authenticated flow | Not executed |
| Physical camera | Not available / not executed |
| Bundle secret scan | No listed secret names/values or production loopback API endpoint found in 20 live JS chunks |
| Accessibility smoke | No axe findings on login, forgot-password, or offline; two moderate landmark findings on unauthorized |

Additional protocol checks found that a disallowed CORS origin produces HTTP 500
instead of a controlled denial, and that frontend HTML/PWA responses omit HSTS
even though API responses include it. HTTP itself redirects to HTTPS.

## Pre-Fix Findings

1. **BLOCKER — backup/access gate:** Render and Supabase control-plane/database
   credentials are unavailable to this run, and the two required logical backup
   files are not locally available. No safe cutover can occur yet.
2. **BLOCKER — exposed Main Admin credential:** tracked documentation contains a
   usable-looking password for the imported administrator whose credential row
   is present in the restored data. It must be treated as compromised before
   cutover.
3. **HIGH — health-route configuration drift:** Nest exposes health routes at
   `/health*`, while Docker Compose, one startup script, deployment
   documentation, and the Admin Operations UI still reference
   `/api/v1/health*`.
4. **HIGH — migration/backup operational trap:** Render requires a recent
   application backup record when migrations are pending, while the current
   readiness response says Google Drive backups are disabled/degraded and the
   external scheduled workflow does not create that application metadata.
5. **HIGH — dependency audit:** the current production dependency audit reports
   three high-severity advisories in transitive `js-yaml` and `nanoid`
   dependencies; dependency updates and regression validation are required.
6. **MEDIUM — local unpublished fixes:** three pre-existing tracked changes
   replace Prisma `$queryRaw` with `$executeRaw` for transaction-scoped advisory
   locks in academic assignment, import capacity checks, and People creation.
   They are not part of the deployed commit and require tests before inclusion.
7. **HIGH — CORS denial behavior:** a disallowed origin causes HTTP 500 on API
   and preflight requests instead of a controlled 403/no-CORS response.
8. **HIGH — responsive login overlap:** the Install App control obscures login
   content at the required 320×568 viewport.
9. **MEDIUM — inconsistent HSTS:** API responses set HSTS, but frontend HTML,
   manifest, and service-worker responses do not.

## Decision at Audit Completion

**Production cutover: NOT STARTED.**  
**Production release decision: BLOCKED.**

Next permitted action is to obtain authorised, non-printed access to both
database URLs and Render, recreate and verify both logical backups, then perform
the restored-database integrity and Main Admin checks. No `DATABASE_URL`,
migration, seed, or production data mutation is permitted before those gates
pass.
