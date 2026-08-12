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

-- Cause the workflow to fail closed unless a complete qualifying row exists.
SELECT 1 / CASE WHEN EXISTS (
  SELECT 1
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
    AND schema_version = (
      SELECT migration_name
      FROM "_prisma_migrations"
      WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
      ORDER BY finished_at DESC
      LIMIT 1
    )
    AND record_counts = :'record_counts'::jsonb
    AND (SELECT count(*) FROM jsonb_object_keys(record_counts)) = (
      SELECT count(*) FROM pg_tables WHERE schemaname = 'public'
    )
    AND (record_counts ->> '_prisma_migrations')::bigint = (
      SELECT count(*)
      FROM "_prisma_migrations"
    )
    AND completed_at >= now() - interval '10 minutes'
    AND deleted_at IS NULL
) THEN 1 ELSE 0 END AS verified_backup_registered;

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
