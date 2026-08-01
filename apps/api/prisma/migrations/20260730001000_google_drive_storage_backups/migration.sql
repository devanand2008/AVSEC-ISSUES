CREATE TYPE "StorageProviderKind" AS ENUM ('S3', 'GOOGLE_DRIVE');
CREATE TYPE "StorageConnectionStatus" AS ENUM ('DISCONNECTED', 'PENDING', 'CONNECTED', 'ERROR', 'REVOKED');
CREATE TYPE "FileRecordStatus" AS ENUM ('UPLOADING', 'READY', 'FAILED', 'QUARANTINED', 'ARCHIVED', 'DELETED');
CREATE TYPE "DatabaseBackupType" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY', 'MANUAL', 'PRE_MIGRATION', 'PRE_DELETION', 'ACADEMIC_YEAR_TRANSITION');
CREATE TYPE "DatabaseBackupStatus" AS ENUM ('CREATING', 'ENCRYPTING', 'UPLOADING', 'VERIFYING', 'COMPLETED', 'FAILED', 'RESTORE_TESTED', 'CORRUPTED', 'DELETED');
CREATE TYPE "BackupRestoreTestStatus" AS ENUM ('PENDING', 'DOWNLOADING', 'VERIFYING', 'RESTORING', 'TESTING', 'PASSED', 'FAILED');

CREATE TABLE "storage_connections" (
    "id" UUID NOT NULL,
    "college_id" UUID NOT NULL,
    "provider" "StorageProviderKind" NOT NULL,
    "status" "StorageConnectionStatus" NOT NULL DEFAULT 'DISCONNECTED',
    "owner_email" VARCHAR(254),
    "root_folder_id" VARCHAR(255),
    "files_folder_id" VARCHAR(255),
    "backup_folder_id" VARCHAR(255),
    "last_successful_upload_at" TIMESTAMPTZ(3),
    "last_successful_backup_at" TIMESTAMPTZ(3),
    "last_restore_test_at" TIMESTAMPTZ(3),
    "last_error_code" VARCHAR(100),
    "last_error_message" VARCHAR(500),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    CONSTRAINT "storage_connections_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "google_drive_connections" (
    "id" UUID NOT NULL,
    "storage_connection_id" UUID NOT NULL,
    "account_email" VARCHAR(254) NOT NULL,
    "account_subject" VARCHAR(255),
    "encrypted_refresh_token" TEXT NOT NULL,
    "encryption_key_version" INTEGER NOT NULL DEFAULT 1,
    "granted_scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "token_expires_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    CONSTRAINT "google_drive_connections_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "file_records" (
    "id" UUID NOT NULL,
    "college_id" UUID NOT NULL,
    "storage_connection_id" UUID,
    "provider" "StorageProviderKind" NOT NULL,
    "provider_file_id" VARCHAR(512) NOT NULL,
    "provider_folder_id" VARCHAR(512),
    "original_file_name" VARCHAR(255) NOT NULL,
    "safe_file_name" VARCHAR(255) NOT NULL,
    "mime_type" VARCHAR(160) NOT NULL,
    "file_size" BIGINT NOT NULL,
    "checksum_sha256" VARCHAR(64) NOT NULL,
    "category" VARCHAR(80) NOT NULL,
    "uploaded_by_id" UUID NOT NULL,
    "related_entity_type" VARCHAR(100),
    "related_entity_id" UUID,
    "status" "FileRecordStatus" NOT NULL DEFAULT 'UPLOADING',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    CONSTRAINT "file_records_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "database_backups" (
    "id" UUID NOT NULL,
    "college_id" UUID NOT NULL,
    "storage_connection_id" UUID,
    "backup_type" "DatabaseBackupType" NOT NULL,
    "status" "DatabaseBackupStatus" NOT NULL DEFAULT 'CREATING',
    "file_name" VARCHAR(255) NOT NULL,
    "provider_file_id" VARCHAR(512),
    "provider_folder_id" VARCHAR(512),
    "plain_size_bytes" BIGINT,
    "encrypted_size_bytes" BIGINT,
    "plain_checksum_sha256" VARCHAR(64),
    "encrypted_checksum_sha256" VARCHAR(64),
    "manifest_checksum_sha256" VARCHAR(64),
    "encryption_algorithm" VARCHAR(40) NOT NULL DEFAULT 'AES-256-GCM',
    "encryption_key_version" INTEGER NOT NULL,
    "schema_version" VARCHAR(120),
    "application_commit" VARCHAR(80),
    "record_counts" JSONB,
    "created_by_id" UUID,
    "failure_code" VARCHAR(100),
    "failure_message" VARCHAR(500),
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    CONSTRAINT "database_backups_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "backup_manifests" (
    "id" UUID NOT NULL,
    "backup_id" UUID NOT NULL,
    "format_version" INTEGER NOT NULL DEFAULT 1,
    "archive_format" VARCHAR(40) NOT NULL DEFAULT 'pg_dump_custom',
    "encryption_algorithm" VARCHAR(40) NOT NULL,
    "encryption_key_version" INTEGER NOT NULL,
    "nonce_base64" VARCHAR(64) NOT NULL,
    "database_schema_version" VARCHAR(120),
    "application_commit" VARCHAR(80),
    "backup_timestamp" TIMESTAMPTZ(3) NOT NULL,
    "record_counts" JSONB NOT NULL,
    "plain_checksum_sha256" VARCHAR(64) NOT NULL,
    "encrypted_checksum_sha256" VARCHAR(64) NOT NULL,
    "plain_size_bytes" BIGINT NOT NULL,
    "encrypted_size_bytes" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "backup_manifests_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "backup_restore_tests" (
    "id" UUID NOT NULL,
    "college_id" UUID NOT NULL,
    "backup_id" UUID NOT NULL,
    "requested_by_id" UUID,
    "status" "BackupRestoreTestStatus" NOT NULL DEFAULT 'PENDING',
    "temporary_database_hash" VARCHAR(64),
    "record_count_comparison" JSONB,
    "schema_comparison" JSONB,
    "failure_code" VARCHAR(100),
    "failure_message" VARCHAR(500),
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "backup_restore_tests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "storage_connections_college_id_status_idx" ON "storage_connections"("college_id", "status");
CREATE UNIQUE INDEX "storage_connections_college_id_provider_key" ON "storage_connections"("college_id", "provider");
CREATE UNIQUE INDEX "google_drive_connections_storage_connection_id_key" ON "google_drive_connections"("storage_connection_id");
CREATE INDEX "google_drive_connections_account_email_idx" ON "google_drive_connections"("account_email");
CREATE INDEX "file_records_college_id_category_status_created_at_idx" ON "file_records"("college_id", "category", "status", "created_at");
CREATE INDEX "file_records_related_entity_type_related_entity_id_idx" ON "file_records"("related_entity_type", "related_entity_id");
CREATE INDEX "file_records_uploaded_by_id_created_at_idx" ON "file_records"("uploaded_by_id", "created_at");
CREATE UNIQUE INDEX "file_records_provider_provider_file_id_key" ON "file_records"("provider", "provider_file_id");
CREATE INDEX "database_backups_college_id_backup_type_status_created_at_idx" ON "database_backups"("college_id", "backup_type", "status", "created_at");
CREATE INDEX "database_backups_storage_connection_id_provider_file_id_idx" ON "database_backups"("storage_connection_id", "provider_file_id");
CREATE UNIQUE INDEX "backup_manifests_backup_id_key" ON "backup_manifests"("backup_id");
CREATE INDEX "backup_restore_tests_college_id_status_created_at_idx" ON "backup_restore_tests"("college_id", "status", "created_at");
CREATE INDEX "backup_restore_tests_backup_id_created_at_idx" ON "backup_restore_tests"("backup_id", "created_at");

ALTER TABLE "storage_connections" ADD CONSTRAINT "storage_connections_college_id_fkey" FOREIGN KEY ("college_id") REFERENCES "colleges"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "storage_connections" ADD CONSTRAINT "storage_connections_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "google_drive_connections" ADD CONSTRAINT "google_drive_connections_storage_connection_id_fkey" FOREIGN KEY ("storage_connection_id") REFERENCES "storage_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "file_records" ADD CONSTRAINT "file_records_college_id_fkey" FOREIGN KEY ("college_id") REFERENCES "colleges"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "file_records" ADD CONSTRAINT "file_records_storage_connection_id_fkey" FOREIGN KEY ("storage_connection_id") REFERENCES "storage_connections"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "file_records" ADD CONSTRAINT "file_records_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "database_backups" ADD CONSTRAINT "database_backups_college_id_fkey" FOREIGN KEY ("college_id") REFERENCES "colleges"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "database_backups" ADD CONSTRAINT "database_backups_storage_connection_id_fkey" FOREIGN KEY ("storage_connection_id") REFERENCES "storage_connections"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "database_backups" ADD CONSTRAINT "database_backups_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "backup_manifests" ADD CONSTRAINT "backup_manifests_backup_id_fkey" FOREIGN KEY ("backup_id") REFERENCES "database_backups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "backup_restore_tests" ADD CONSTRAINT "backup_restore_tests_college_id_fkey" FOREIGN KEY ("college_id") REFERENCES "colleges"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "backup_restore_tests" ADD CONSTRAINT "backup_restore_tests_backup_id_fkey" FOREIGN KEY ("backup_id") REFERENCES "database_backups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "backup_restore_tests" ADD CONSTRAINT "backup_restore_tests_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
