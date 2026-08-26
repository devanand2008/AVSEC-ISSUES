\set ON_ERROR_STOP on

BEGIN;

-- The external backup workflow calls this only after encryption round-trip and
-- private-upload metadata verification have both succeeded. Re-runs are
-- idempotent by encrypted artifact checksum.
INSERT INTO database_backups (
  id,
  college_id,
  backup_type,
  status,
  file_name,
  plain_size_bytes,
  encrypted_size_bytes,
  plain_checksum_sha256,
  encrypted_checksum_sha256,
  manifest_checksum_sha256,
  encryption_algorithm,
  encryption_key_version,
  schema_version,
  application_commit,
  record_counts,
  started_at,
  completed_at,
  created_at,
  updated_at
)
SELECT
  gen_random_uuid(),
  (SELECT id FROM colleges ORDER BY created_at, id LIMIT 1),
  :'backup_type'::"DatabaseBackupType",
  :'backup_status'::"DatabaseBackupStatus",
  :'file_name',
  :'plain_size'::bigint,
  :'encrypted_size'::bigint,
  :'plain_sha256',
  :'encrypted_sha256',
  :'manifest_sha256',
  'AES-256-GCM',
  :'encryption_key_version'::integer,
  :'schema_version',
  :'application_commit',
  :'record_counts'::jsonb,
  now(),
  now(),
  now(),
  now()
WHERE NOT EXISTS (
  SELECT 1
  FROM database_backups
  WHERE encrypted_checksum_sha256 = :'encrypted_sha256'
    AND status = :'backup_status'::"DatabaseBackupStatus"
    AND deleted_at IS NULL
);

-- Fail closed unless the complete verified row exists. A previous
-- already-approved deployment can finish while this backup is being restored,
-- so the live schema may legitimately advance before registration. In that
-- case this artifact remains a valid historical recovery point, but the check
-- may pass only when every migration in this checkout is already applied. If a
-- local migration is still pending, require a fresh current-schema backup.
WITH registered_backup AS (
  SELECT backup_type, status, schema_version, record_counts
  FROM database_backups
  WHERE encrypted_checksum_sha256 = :'encrypted_sha256'
    AND backup_type = :'backup_type'::"DatabaseBackupType"
    AND status = :'backup_status'::"DatabaseBackupStatus"
    AND plain_size_bytes = :'plain_size'::bigint
    AND plain_size_bytes > 0
    AND encrypted_size_bytes = :'encrypted_size'::bigint
    AND encrypted_size_bytes > 0
    AND plain_checksum_sha256 = :'plain_sha256'
    AND plain_checksum_sha256 ~ '^[a-f0-9]{64}$'
    AND encrypted_checksum_sha256 ~ '^[a-f0-9]{64}$'
    AND manifest_checksum_sha256 = :'manifest_sha256'
    AND manifest_checksum_sha256 ~ '^[a-f0-9]{64}$'
    AND schema_version = :'schema_version'
    AND record_counts = :'record_counts'::jsonb
    AND completed_at >= now() - interval '10 minutes'
    AND deleted_at IS NULL
),
local_migration_input AS (
  SELECT :'local_migrations_json'::jsonb AS migrations
),
local_migrations AS (
  SELECT local_migration.migration_name
  FROM local_migration_input
  CROSS JOIN LATERAL jsonb_array_elements_text(
    CASE
      WHEN jsonb_typeof(migrations) = 'array' THEN migrations
      ELSE '[]'::jsonb
    END
  ) AS local_migration(migration_name)
),
live_migration_state AS (
  SELECT
    (
      SELECT migration_name
      FROM "_prisma_migrations"
      WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
      ORDER BY finished_at DESC, migration_name DESC
      LIMIT 1
    ) AS latest_migration,
    (SELECT count(*) FROM "_prisma_migrations") AS migration_count
),
registration_safety AS (
  SELECT
    EXISTS (SELECT 1 FROM registered_backup) AS artifact_registered,
    EXISTS (
      SELECT 1
      FROM registered_backup backup
      CROSS JOIN live_migration_state live
      WHERE backup.schema_version = live.latest_migration
        AND (SELECT count(*) FROM jsonb_object_keys(backup.record_counts)) = (
          SELECT count(*) FROM pg_tables WHERE schemaname = 'public'
        )
        AND (backup.record_counts ->> '_prisma_migrations')::bigint = live.migration_count
    ) AS artifact_matches_current_schema,
    EXISTS (
      SELECT 1
      FROM registered_backup backup
      CROSS JOIN live_migration_state live
      WHERE backup.backup_type = 'PRE_MIGRATION'::"DatabaseBackupType"
        AND backup.status = 'RESTORE_TESTED'::"DatabaseBackupStatus"
        AND backup.schema_version <> live.latest_migration
        AND (backup.record_counts ->> '_prisma_migrations')::bigint < live.migration_count
        AND EXISTS (
          SELECT 1
          FROM local_migrations local_live
          WHERE local_live.migration_name = live.latest_migration
        )
        AND EXISTS (
          SELECT 1
          FROM "_prisma_migrations" applied_backup
          WHERE applied_backup.migration_name = backup.schema_version
            AND applied_backup.finished_at IS NOT NULL
            AND applied_backup.rolled_back_at IS NULL
        )
    ) AS live_migrations_advanced_after_backup,
    EXISTS (SELECT 1 FROM local_migrations)
      AND NOT EXISTS (
        SELECT 1
        FROM local_migrations local_migration
        WHERE NOT EXISTS (
          SELECT 1
          FROM "_prisma_migrations" applied
          WHERE applied.migration_name = local_migration.migration_name
            AND applied.finished_at IS NOT NULL
            AND applied.rolled_back_at IS NULL
        )
      ) AS all_local_migrations_applied
)
SELECT 1 / CASE
  WHEN artifact_registered
    AND (
      artifact_matches_current_schema
      OR (
        live_migrations_advanced_after_backup
        AND all_local_migrations_applied
      )
    )
  THEN 1
  ELSE 0
END AS verified_backup_registered
FROM registration_safety;

-- PRE_MIGRATION and PRE_DELETION rows carry RESTORE_TESTED status only after
-- the workflow's isolated restore succeeded. Persist that proof so application
-- safety gates can distinguish it from a merely completed encrypted artifact.
INSERT INTO backup_restore_tests (
  id,
  college_id,
  backup_id,
  status,
  record_count_comparison,
  schema_comparison,
  started_at,
  completed_at,
  created_at,
  updated_at
)
SELECT
  gen_random_uuid(),
  b.college_id,
  b.id,
  'PASSED'::"BackupRestoreTestStatus",
  jsonb_build_object('status', 'MATCHED', 'recordCounts', b.record_counts),
  jsonb_build_object('status', 'MATCHED', 'schemaVersion', b.schema_version),
  now(),
  now(),
  now(),
  now()
FROM database_backups b
WHERE b.encrypted_checksum_sha256 = :'encrypted_sha256'
  AND b.backup_type = :'backup_type'::"DatabaseBackupType"
  AND b.status = 'RESTORE_TESTED'::"DatabaseBackupStatus"
  AND b.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM backup_restore_tests t
    WHERE t.backup_id = b.id AND t.status = 'PASSED'::"BackupRestoreTestStatus"
  );

COMMIT;
