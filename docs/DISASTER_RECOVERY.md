# AVS College Management System — Disaster Recovery

This runbook covers PostgreSQL application data and private provider files. It contains no credentials. Commands that need secrets must read them from the approved deployment secret store.

## Recovery principles

- PostgreSQL is the source of truth for structured records.
- Google Drive or the configured private provider stores encrypted dumps and file bytes; it is never the live PostgreSQL data directory.
- Never restore directly into the active production database as a test.
- Never expose OAuth tokens, database URLs, encryption keys, or raw provider links in tickets, logs, screenshots, manifests, or API responses.
- A backup is reliable only after checksum verification and a successful isolated restore test.
- Keep the encryption-key version needed by every retained backup.

## Before an incident

1. Verify the latest daily, weekly, and monthly backup states are `COMPLETED` or `RESTORE_TESTED`.
2. Confirm the encrypted archive size and SHA-256 match the stored manifest and provider metadata.
3. Confirm the last monthly restore test passed and record counts/schema comparison are acceptable.
4. Confirm monitoring alerts on failed backups, token refresh failure, Drive folder deletion, checksum mismatch, and restore-test failure.
5. Keep the deployment artifact/commit, migration set, database version, provider folder registry, and key-version registry in the operations inventory.

## Database loss recovery

1. Declare an incident and enable maintenance mode so no writers remain.
2. Record the incident owner, reason, start time, and affected deployment.
3. Provision a new isolated PostgreSQL instance with the supported major version.
4. Select the newest backup that has passed a restore test.
5. Download it through the backend/provider integration.
6. Verify the encrypted archive checksum and manifest before decryption.
7. Decrypt into an access-restricted temporary directory.
8. Run `pg_restore --list` and verify the archive is a custom-format dump.
9. Restore into a temporary database first.
10. Compare migration history, table/schema inventory, tenant counts, users, roles, audit logs, and critical module counts.
11. Create a current backup of any surviving production database before replacement.
12. Obtain Main Admin, database owner, security owner, and operations approval.
13. Restore into the replacement production database during the maintenance window.
14. Run integrity checks, application smoke tests, login/RBAC checks, and file-reference checks.
15. Reopen traffic gradually and monitor errors.
16. Securely remove plaintext temporary dumps in `finally` cleanup.

## Accidental data deletion

1. Stop the deleting workflow or account.
2. Do not overwrite the current database immediately.
3. Create and verify a current incident-state backup.
4. Restore the last pre-deletion backup into an isolated database.
5. Compare affected records and dependencies.
6. Prefer a reviewed, transactional record-level recovery over a full production rollback.
7. Preserve audit evidence and record the recovery action.

## Corrupted backup

1. Mark the backup `CORRUPTED`; do not delete it while the incident is investigated.
2. Preserve provider metadata, checksum, manifest, and failure category.
3. Test the next-newest verified backup.
4. Inspect whether corruption occurred before encryption, during upload, or in provider storage.
5. Rotate credentials/keys only if compromise is suspected; retain old key versions securely for unaffected historical archives.

## Google Drive token loss or revocation

1. Mark the connection unavailable without deleting PostgreSQL file/backup metadata.
2. Stop new backup/file jobs and keep them retryable.
3. Have the authorised owner reconnect through the admin OAuth flow.
4. Verify the returned account identity matches the configured owner.
5. Reverify the saved root/files/backup folder IDs.
6. Resume queued jobs only after a health and checksum test.
7. Never request or use the Google account password.

## Google account or provider migration

1. Connect the college-owned replacement provider/account.
2. Validate minimum required permissions and destination folder IDs.
3. Copy selected files and backups without deleting the source.
4. Compare size and SHA-256 for every object.
5. Update metadata transactionally in batches and keep source references in the migration report.
6. Run an isolated database restore from a copied backup and secure-download checks for copied application files.
7. Obtain approval before switching the primary provider.
8. Retain the old provider until the agreed rollback period expires.

## Drive folder deletion

1. Stop upload/retention jobs to avoid recreating partial structures unexpectedly.
2. Check the Drive trash/recovery options with the authorised owner.
3. Compare PostgreSQL `FileRecord`/backup metadata with provider inventory.
4. Restore missing objects from a verified secondary copy or disaster-recovery package.
5. Update saved folder IDs only after ownership, parent hierarchy, and access are verified.
6. Do not search the entire personal Drive repeatedly by name.

## Application rollback

1. Record the exact failing and target commits/artifacts.
2. Create a pre-rollback database backup.
3. Check whether migrations are backward compatible; never automatically reverse a destructive migration.
4. Deploy the previous signed artifact while keeping the current database if compatible.
5. If a database rollback is required, restore only through the isolated comparison and approval workflow.
6. Run authentication, permissions, profile, attendance, messaging, issues, feedback QR, Learn/Skill, AVS Bot, storage, and backup smoke tests.

## File-record recovery

1. Inventory `FileRecord` rows by tenant, category, status, provider, and related entity.
2. Verify provider existence and metadata without making files public.
3. Reconcile size and checksum.
4. Mark missing/mismatched files failed or quarantined; do not silently return broken links.
5. Restore bytes from a verified provider copy, update metadata transactionally, and audit the recovery.
6. Authorised downloads must continue through the backend.

## Monthly restore test

The scheduled restore-test worker must:

1. choose an eligible completed backup;
2. download and verify encrypted bytes;
3. decrypt to a restricted temporary file;
4. inspect the archive;
5. create a unique temporary database;
6. restore with `--no-owner --no-privileges`;
7. compare schema and record counts;
8. store a redacted comparison report;
9. drop only the exact temporary database it created;
10. securely remove temporary files;
11. mark the backup `RESTORE_TESTED` only on success.

The worker must never derive a production database name from user input and must never pass a database password on a command line or into logs.

## Local encrypted-backup verification

The repository includes a repeatable service-path verification command:

```powershell
$env:BACKUP_ENCRYPTION_KEY = "<32-byte key from the approved secret store>"
npm run backup:verify
```

`DATABASE_URL` and the PostgreSQL client tools (`pg_dump`, `pg_restore`, `psql`,
`createdb`, and `dropdb`) must be available. The command creates a current
encrypted backup, restores it into a uniquely named temporary database, compares
schema and critical record counts, drops the temporary database, and prints only
redacted evidence. By default it removes the transient encrypted artifact and
marks its backup metadata deleted while preserving restore-test and audit
evidence. Set `BACKUP_VERIFY_KEEP_ARTIFACTS=true` only when the key is durable,
retention is approved, and the resulting recovery point is meant to be kept.

## Required incident record

Record:

- incident/reference ID;
- authorised operators and approvals;
- backup ID/type/timestamp/key version;
- encrypted and manifest checksums;
- source application commit and schema version;
- isolated restore-test result;
- record/schema comparison;
- production maintenance window;
- smoke-test result;
- rollback decision;
- cleanup confirmation.
