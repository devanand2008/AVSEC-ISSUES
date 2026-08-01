# AVS College Management System — Production Master Report

Verification date: 2026-07-30  
Timezone: Asia/Kolkata  
Release decision: **BLOCKED — not approved for production**

This report describes the current working tree. It does not claim that mocked
Google Drive tests are live provider acceptance. Secret values, tokens,
connection strings, private provider identifiers, and personal data are omitted.

## Repository and architecture

| Required field                  | Result                                                                  |
| ------------------------------- | ----------------------------------------------------------------------- |
| Repository inspected            | `D:\COLLEGE MANAGEMENT SITE`                                            |
| Frontend workspace              | `apps/web` (`@college/web`, Next.js 16 PWA)                             |
| Backend workspace               | `apps/api` (`@college/api`, NestJS 11)                                  |
| PostgreSQL version              | 17.10                                                                   |
| Prisma schema                   | `apps/api/prisma/schema.prisma`                                         |
| Prisma version                  | 7.9.1                                                                   |
| Database migration state        | 37 migration directories; Prisma reports the local schema up to date    |
| Active local database           | PostgreSQL `college_management`; 40 users and 39 migration-history rows |
| Live structured-data store      | PostgreSQL                                                              |
| Existing application-file store | Private S3-compatible storage; MinIO locally                            |
| New backup/provider integration | Backend-only Google Drive API v3 using `drive.file` scope               |

The valid npm monorepo layout was preserved. No bulk move or destructive cleanup
was performed because the working tree already contains extensive user changes
and legacy material that needs owner review.

## Files

Core files created in the current Google Drive/backup implementation:

- `apps/api/src/modules/google-drive/*`
- `apps/api/src/modules/backups/*`
- `apps/api/prisma/migrations/20260730001000_google_drive_storage_backups/migration.sql`
- `apps/web/src/app/(portal)/settings/storage/*`
- `apps/api/test/google-drive-oauth.spec.ts`
- `apps/api/test/google-drive-storage.spec.ts`
- `apps/api/test/backup-crypto-manifest.spec.ts`
- `apps/api/test/backup-postgres-tools.spec.ts`
- `apps/api/test/backup-retention.spec.ts`
- `apps/api/test/backup-scheduler.spec.ts`
- `scripts/verify-encrypted-backup.ts`
- `docs/DISASTER_RECOVERY.md`
- `docs/production-system-audit.md`
- this report

Core files modified:

- `package.json`
- `.env.example`
- `apps/api/prisma/schema.prisma`
- `apps/api/src/app.module.ts`
- `apps/api/src/config/environment.ts`
- `apps/api/src/modules/google-drive/storage-provider.ts`
- `apps/api/src/modules/google-drive/google-drive-api.client.ts`
- `apps/api/src/modules/google-drive/google-drive-storage.service.ts`
- `apps/api/src/modules/backups/backups.service.ts`
- `apps/api/Dockerfile`
- `apps/web/src/components/navigation.ts`
- `apps/web/src/lib/portal-route-access.ts`

Files moved: none.  
Files removed: none.  
Legacy/prototype directories: preserved; not part of the npm production build.

## Design, mobile, and PWA

| Required field        | Result                                                                                                                                    |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Design system         | Shared tokens and responsive primitives in `apps/web/src/app/globals.css`; reusable shell, navigation, status, empty/error/loading states |
| Mobile navigation     | Responsive `AppShell` with mobile navigation and permission-filtered routes                                                               |
| Storage UI            | `/settings/storage`, permission-gated Drive connection, backup status, manual backup, and isolated restore-test actions                   |
| Phone responsive test | Existing eight-viewport audit passed; current Playwright mobile project passed its executed cases                                         |
| PWA build             | Passed; 82 routes generated, including `/settings/storage`                                                                                |
| PWA install test      | Manifest/service-worker/component evidence exists; native installed-PWA test remains unavailable                                          |
| Physical camera test  | Not run; requires a trusted HTTPS origin and physical device                                                                              |
| Performance           | Optimized Next.js build and paginated module APIs pass; required realistic-volume profile remains outstanding                             |

## Google Drive

| Required field              | Result                                                                                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Owner verification          | Implemented and mocked; mismatched owner is rejected and issued credentials are revoked                                                     |
| OAuth                       | Backend OAuth 2.0 authorization-code flow with PKCE, single-use hashed state, encrypted verifier/token persistence, refresh, and revocation |
| Scope                       | Minimum `https://www.googleapis.com/auth/drive.file` scope enforced                                                                         |
| Root hierarchy              | Implementation creates/verifies the required root, backup, application-file, import, export, and disaster-recovery folders                  |
| Folder IDs                  | Persisted in `StorageConnection`; real IDs are not configured locally                                                                       |
| Storage abstraction         | Owner-scoped `upload`, `download`, `delete`, `exists`, `getMetadata`, and folder operations                                                 |
| Resumable upload            | Chunked Drive protocol, bounded retry/backoff, progress callback, caller cancellation, size limit, and checksum validation                  |
| Small upload test           | Mocked test passed                                                                                                                          |
| Large/resumable upload test | Mocked resumable protocol/retry test passed; no real Drive transfer                                                                         |
| Upload cancellation         | Unit-tested before session creation; real provider cancellation not run                                                                     |
| Checksum verification       | MD5/SHA-256 verification and corrupt-upload cleanup tests passed                                                                            |
| Secure download             | Owner-bound backend service and checksum test passed                                                                                        |
| Unauthorised download       | Owner-bound service tests pass; no real provider acceptance                                                                                 |
| Connection revocation       | Success/failure behavior and encrypted-token retention tests pass                                                                           |

Local configuration status:

- `GOOGLE_DRIVE_ENABLED` and all OAuth/Drive secrets and folder IDs are absent
  from the local `.env`.
- No `StorageConnection` row exists in the local database.
- No live owner consent, Drive folder creation, upload, download, capacity check,
  or revoke acceptance was performed.

## PostgreSQL backup and recovery

| Required field            | Result                                                                                                                                                                  |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Manual PostgreSQL backup  | Current service-path verification completed as backup `368b2fea-ba3b-4c6b-93c2-303be4ce946d`, producing 1,053,872 encrypted bytes                                       |
| Backup checksum           | Current encrypted archive SHA-256 `c09c30a3b18c67c72277e8d4bb51dc8012c4d427b9f82a85422207b0c5623473`                                                                    |
| Backup encryption         | Current live local AES-256-GCM backup and authenticated-manifest path passed using a one-time test key that was neither persisted nor printed                           |
| Backup upload             | Implemented with Drive size/checksum re-download verification; not run against Drive                                                                                    |
| Backup retention          | Daily/weekly/monthly tier logic tested; configured defaults are 14/12/24                                                                                                |
| Temporary restore         | Current 2026-07-30 encrypted archive restored into a unique PostgreSQL 17 database; 138 source/restored tables, 40 users, and 39 migration-history rows matched         |
| Current encrypted restore | Passed; the exact newly encrypted local archive was decrypted, restored, compared, and its temporary database removed                                                   |
| Current backup metadata   | Verification backup marked `DELETED` after deliberate transient-artifact cleanup; restore test remains `PASSED` with three audit records; zero `StorageConnection` rows |
| Disaster recovery         | `docs/DISASTER_RECOVERY.md` covers database loss, token loss, owner/provider migration, folder deletion, corruption, rollback, and file reconciliation                  |

The current run proves the local database dump, AES-256-GCM archive, authenticated
manifest, decryption, isolated PostgreSQL restore, schema/count comparison, audit,
and cleanup path. The verification archive and one-time key were intentionally not
retained. It does **not** prove Drive upload/download or establish a persistent
production recovery point.

Scheduled daily, Sunday-weekly, and first-of-month backups are registered through
a single-concurrency Redis/BullMQ worker. Jobs use an Asia/Kolkata day key, stable
queue identifiers, and a PostgreSQL date/type check to prevent duplicate recovery
points across restarts or multiple API replicas. The scheduler remains disabled
locally and has not completed a real encrypted/Drive backup.

## Functional modules

| Module                     | Current verified status                                                                                  |
| -------------------------- | -------------------------------------------------------------------------------------------------------- |
| Profile                    | Implemented; private photo flow and profile validation tests pass                                        |
| People                     | Implemented with server search/filter/pagination and archive/restore/safe-delete controls                |
| Campus Setup               | Implemented with hierarchy, test-data markers, dependency checks, and guarded deletion                   |
| Fake-data cleanup          | Guarded workflow exists; destructive staging acceptance not run                                          |
| Attendance                 | Workflow, correction, permission, import/export, and report tests pass                                   |
| Announcements              | Unicode/Tamil titles and validation tests pass                                                           |
| Messenger                  | Text/image browser path and atomic attachment/realtime tests pass                                        |
| Issues                     | Create, repeat occurrence, routing, evidence, maintenance, reporter verification, and closure tests pass |
| Maintenance                | Workflow/timeline/escalation/completion checks pass; real Drive evidence path not tested                 |
| Feedback QR                | Opaque token resolution and submission tests pass                                                        |
| QR scanner                 | Camera/manual/upload/fallback UI exists; physical HTTPS scan not run                                     |
| AVS Learn                  | API/unit/browser coverage passes for executed cases                                                      |
| AVS Skill                  | Catalog/progress/assessment/certificate browser coverage passes for executed cases                       |
| AVS Bot                    | Backend-only key, context, knowledge, safety, and idempotency tests pass; no live provider acceptance    |
| Notifications              | Implemented; live push/WhatsApp provider acceptance remains external                                     |
| Reports/imports            | Implemented with focused tests                                                                           |
| Application files on Drive | Incomplete: existing S3/MinIO flows remain active in storage, announcements, and imports                 |

The Google Drive provider is currently used by the new backup subsystem. Existing
profile, announcement, messenger, issue, learning, and import files have not been
migrated to the provider-neutral Drive path. Keeping the working private S3 paths
avoids breaking production behavior, but this is not the complete Drive cutover
requested by the master brief.

## Verification results

| Gate                             | Result                                                                                                             |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `npm ci --include=dev`           | Passed after redirecting npm cache/temp off a full system volume                                                   |
| Prisma validation                | Passed                                                                                                             |
| Prisma generation                | Passed                                                                                                             |
| Prisma migration status          | Passed; local schema up to date                                                                                    |
| Workspace typecheck              | Passed                                                                                                             |
| Workspace lint                   | Passed                                                                                                             |
| API automated tests              | Passed: 357 tests in 48 suites                                                                                     |
| Web component tests              | Passed: 46 tests in 11 files                                                                                       |
| Focused Drive/backup tests       | Passed: 32 tests                                                                                                   |
| NestJS build                     | Passed                                                                                                             |
| PWA build                        | Passed; 82 routes                                                                                                  |
| Tracked-secret scan              | Passed                                                                                                             |
| Production dependency audit      | Passed; zero production vulnerabilities                                                                            |
| Full dev dependency audit        | 26 high advisories; confined to development dependency graph                                                       |
| Browser E2E                      | 18 passed, 4 skipped                                                                                               |
| Local API health                 | HTTP 200                                                                                                           |
| Local web health                 | HTTP 200                                                                                                           |
| Google Drive integration test    | Not run                                                                                                            |
| Current encrypted backup/restore | Passed: 1,053,872 encrypted bytes; 138 tables, 40 users, and 39 migration rows matched; temporary database removed |

## Remaining blockers and manual configuration

1. Configure a Google Cloud OAuth web client, exact backend callback URL, consent
   screen/test user or production approval, authorised owner email, independent
   token/backup encryption keys, and protected Drive folder IDs.
2. Run real owner-match, folder, small upload, multi-chunk upload, cancellation,
   checksum, secure/unauthorised download, refresh, revoke, quota, and failure
   tests in a trusted HTTPS staging environment.
3. Enable and run the daily/weekly/monthly scheduler in staging, and finish
   audited provider-aware retention deletion.
4. Configure a persistent production backup key, create and retain an encrypted
   recovery point, upload it to Drive, and restore the exact Drive-downloaded
   bytes into an isolated staging PostgreSQL 17 database.
5. Move remaining application-file modules behind the provider-neutral storage
   service and backfill `FileRecord` metadata without deleting source objects.
6. Complete the uninterrupted acceptance workflow, real-device PWA/camera tests,
   provider sandboxes, realistic-volume load tests, and human UAT/sign-off.
7. Restore reliable Docker CLI operation before release operations. Cache cleanup
   recovered the Windows system volume to approximately 13 GB free, but Docker CLI
   status commands still time out while the running API and PostgreSQL remain
   reachable.

Production readiness: **NO**. The current local encrypted-backup restore gate now
passes, but the master brief's definition of done still requires a durable
production key/recovery point, real Google Drive/provider acceptance, remaining
application-file cutover, and physical-device acceptance tests.
