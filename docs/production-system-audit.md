# AVS College Management System — Production System Audit

Date: 2026-07-30  
Scope: repository, PostgreSQL/Prisma, NestJS API, Next.js PWA, storage, backup/restore, security, responsive behavior, and test configuration.

All credentials, connection strings, tokens, encryption keys, personal data, and private file identifiers are redacted from this report.

## Current project structure

| Area | Current implementation |
|---|---|
| Monorepo | npm workspaces rooted at `apps/*` and `packages/*` |
| Frontend | `apps/web`, Next.js App Router PWA |
| Backend | `apps/api`, NestJS |
| Database | PostgreSQL 17 through Prisma 7 |
| Prisma schema | `apps/api/prisma/schema.prisma` |
| Prisma migrations | `apps/api/prisma/migrations` |
| API entry point | `apps/api/src/main.ts` and `apps/api/src/app.module.ts` |
| Live file storage | private S3-compatible MinIO through the API |
| Cache/jobs | Redis and BullMQ |
| PWA assets | `apps/web/public/manifest.webmanifest`, `sw.js`, offline route, PNG icons |
| Existing operations | `scripts/backup.ps1` and `scripts/restore.ps1` |

The actively built product is the `apps/api` + `apps/web` pair. Root-level prototypes and archived projects are not part of the npm build graph.

## Working baseline

Before the Google Drive/backup implementation began, the tested working-tree baseline had:

- API tests: 323 passed.
- Web tests: 35 passed.
- Browser E2E: 20 passed and 2 intentional project-specific skips.
- API and web lint/typecheck: passed.
- NestJS and optimized Next.js builds: passed.
- Docker PostgreSQL, Redis, MinIO, API, and web: healthy.
- Local custom-format PostgreSQL backup/checksum and isolated restore: passed.
- Tracked-source secret scan: passed.

This proves the existing application baseline; it does not prove Google Drive or production HTTPS.

## Broken or risky areas found

### Prisma migration replay

`prisma migrate status` reports the current local database as up to date before the new storage migration. However, a clean shadow-database replay fails at `20260717225000_first_login_completion`: raw SQL inserts a permission without supplying the required UUID. This is a fresh-install and CI migration-chain defect even though the already-populated local database is usable.

The safe repair is an additive UUID-default migration recorded in migration history before generating/applying the new storage metadata migration. Existing applied migration files must not be silently rewritten.

### Storage architecture

- The application has a strong private S3/MinIO implementation, MIME/signature checks, checksum verification, signed downloads, and central `StorageService`.
- No Google Drive API module, OAuth owner verification, encrypted refresh-token persistence, Drive folder registry, or Drive health status existed.
- `imports-file.service.ts` still talks directly to S3 instead of a provider-neutral interface.
- Existing browser uploads use S3 presigned URLs. Google Drive needs a backend upload/resumable workflow; it cannot safely reuse raw Drive sharing URLs.
- There was no canonical `FileRecord` table spanning providers and related entities.

### Backup and restore

- The PowerShell scripts create custom-format dumps and checksums and require explicit restore confirmation.
- The old restore script can target the configured database and therefore must not be exposed as a one-click production operation.
- Backups were not encrypted with authenticated encryption.
- No persisted backup manifest, retention state, Drive upload verification, or monthly restore-test record existed.
- The admin backup page was system-health guidance rather than an operational backup dashboard.
- Existing documents contained stale July 19 statements even though a later local backup/restore drill passed.

### Production environment

- The running local stack intentionally uses development HTTP configuration.
- Google OAuth credentials, Drive folder IDs, storage encryption key, backup encryption key, production HTTPS origin, and authorised provider consent are not available in source control and must remain external.
- Real Drive upload/download, provider capacity, token revocation, and scheduled backup acceptance cannot be claimed until configured against the authorised account.

## Missing modules at audit start

- `apps/api/src/modules/google-drive`
- `apps/api/src/modules/backups`
- provider-neutral upload/download contract
- `StorageConnection`
- `GoogleDriveConnection`
- `FileRecord`
- `DatabaseBackup`
- `BackupManifest`
- `BackupRestoreTest`
- `/settings/storage` PWA route
- Google Drive mocked/integration test suite
- authenticated backup-encryption and retention tests
- `docs/DISASTER_RECOVERY.md`

## Duplicate and unused material

The repository root contains archived or prototype trees including:

- `legacy/`
- `learn language/`
- `worker management system2/`
- historical root log files and screenshots
- overlapping legacy guides and reports

These are excluded from the production Docker context or build graph, but they increase repository size and operator confusion. They should be inventoried and archived in a separate repository only after owners confirm they are no longer needed. This audit does not delete user material.

## Mock and development data

- Development seed data is controlled by `SEED_DEVELOPMENT_DATA`.
- E2E reset logic is restricted to clearly fake email domains.
- The local database contains development fixtures used by automated acceptance tests.
- No mock page is treated as proof of a production provider integration.

Production must keep development seeding disabled and use a dedicated staging tenant for mutable acceptance tests.

## Hardcoded URL review

Acceptable/configurable defaults exist for localhost web/API/MinIO development. External provider endpoints currently include official WhatsApp, Judge0, Piston, Firebase CDN, and—after implementation—Google OAuth/Drive endpoints.

Issues:

- The old admin backup page linked to a generic GitHub URL instead of a local runbook.
- Several localhost fallbacks are appropriate for development but production validation must reject them.
- Provider URLs should stay centralized in their respective backend services and never contain credentials.

## Secret review

The tracked-source security preflight passed. No tracked student data, private keys, database password, OAuth refresh token, client secret, OpenAI key, WhatsApp token, or encryption key was found.

Required controls:

- backend-only Google OAuth and backup settings;
- AES-256-GCM token/backup encryption with independent keys;
- structured-log redaction for OAuth tokens, client secrets, and encryption keys;
- no raw Drive links or provider file IDs in unauthorised responses;
- `.env` and generated backup artifacts remain ignored.

## TypeScript and build findings

The pre-change API/web typecheck, lint, tests, and builds were green. The root tooling tree currently resolves React 18 while the web workspace declares React 19; the optimized standalone web build is correct, and Vitest uses explicit aliases to avoid mixed renderers. A future lockfile refresh should consolidate this tooling split.

## Mobile and PWA findings

Verified:

- eight responsive sizes from 320 px phone to 1440 px desktop;
- no audited horizontal overflow;
- mobile cards for the People table;
- service worker avoids globally caching sensitive API/page payloads;
- manifest, icons, offline fallback, and install affordance;
- keyboard-accessible install dialog.

Still requiring real-device evidence:

- installed PWA lifecycle;
- physical camera and feedback QR scan over HTTPS;
- low-end Android performance, rotation, mobile keyboard, slow/offline transitions;
- push delivery.

## Slow API and performance risks

- Online code execution depends on Judge0/Piston. Retries are bounded to a combined 26-second provider budget below the web timeout, but a deterministic production sandbox/circuit breaker is still recommended.
- Current latency numbers are small-data smoke measurements, not the required realistic-volume profile.
- File checksum/MIME processing currently buffers objects in memory in some paths; large Drive uploads and backups must stream/chunk rather than duplicate whole files.
- Long-running backup, restore-test, import, and provider-migration work belongs in background jobs with observable states.

## Database risks

- Clean migration replay defect described above.
- New storage/backup tables must be additive and tenant-indexed.
- Permanent deletion must continue to require archive state, dependency report, verified backup, reason, typed confirmation, and audit record.
- A PostgreSQL dump does not contain object-storage bytes; disaster recovery must cover database metadata and provider files.
- Backup reliability cannot be marked verified until an encrypted archive is restored into an isolated temporary database and compared.

## File-storage risks

- Direct S3 usage remains in the imports implementation.
- Existing entity-specific storage keys are not yet backfilled into the provider-neutral `FileRecord` model.
- Drive `drive.file` scope can access application-created/shared files but not arbitrary unrelated personal Drive content; folder setup must remain app-created or explicitly shared.
- Google quota, token revocation, partial resumable uploads, checksum mismatch, and folder deletion need explicit failure states.
- Source provider files must not be deleted during migration until copy checksum verification and transactional metadata updates succeed.

## Backup risks

- OAuth/Drive acceptance is impossible without administrator consent and external secrets.
- Local temporary plaintext dumps must be removed in `finally` handling after encryption, including failures.
- Retention must never delete the newest verified backup.
- Production restore must remain a scheduled, audited maintenance operation rather than an immediate API call.
- Key rotation requires retaining the key version needed to decrypt historical backups.

## Recommended repair order

1. Preserve the green API/web baseline and create a pre-migration custom-format backup.
2. Repair clean Prisma migration replay without rewriting or deleting live data.
3. Add the provider-neutral schema and storage contract.
4. Implement Google OAuth with unique state, minimum `drive.file` scope, owner verification, encrypted refresh token, saved folder IDs, refresh, and revocation.
5. Implement streaming/simple and resumable Drive operations with checksum verification and failure categorisation.
6. Implement AES-256-GCM database backup encryption, manifests, retention, Drive verification, and isolated restore tests.
7. Add the `/settings/storage` dashboard with permission-gated actions and no secret exposure.
8. Run schema validation/generation, migrations, focused tests, full unit suites, builds, browser E2E, backup/checksum/restore proof, and secret scanning.
9. Configure the real Google project and authorised owner in a production-like HTTPS staging environment.
10. Complete real Drive, installed-PWA, physical-device, WhatsApp sandbox, and realistic-volume acceptance before production approval.
