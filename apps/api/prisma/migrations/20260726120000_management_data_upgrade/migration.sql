BEGIN;

ALTER TABLE "campuses"
  ADD COLUMN IF NOT EXISTS "contact_number" VARCHAR(30),
  ADD COLUMN IF NOT EXISTS "archived_at" TIMESTAMPTZ(3);
CREATE INDEX IF NOT EXISTS "campuses_college_id_archived_at_idx" ON "campuses"("college_id", "archived_at");

ALTER TABLE "blocks"
  ADD COLUMN IF NOT EXISTS "description" TEXT,
  ADD COLUMN IF NOT EXISTS "archived_at" TIMESTAMPTZ(3);
CREATE INDEX IF NOT EXISTS "blocks_campus_id_archived_at_idx" ON "blocks"("campus_id", "archived_at");

ALTER TABLE "floors" ADD COLUMN IF NOT EXISTS "archived_at" TIMESTAMPTZ(3);
CREATE INDEX IF NOT EXISTS "floors_block_id_archived_at_idx" ON "floors"("block_id", "archived_at");

ALTER TABLE "rooms" ADD COLUMN IF NOT EXISTS "archived_at" TIMESTAMPTZ(3);
CREATE INDEX IF NOT EXISTS "rooms_floor_id_archived_at_idx" ON "rooms"("floor_id", "archived_at");

UPDATE "sections" SET "capacity" = 70 WHERE "capacity" IS NULL;
ALTER TABLE "sections"
  ALTER COLUMN "capacity" SET DEFAULT 70,
  ALTER COLUMN "capacity" SET NOT NULL,
  ADD COLUMN IF NOT EXISTS "archived_at" TIMESTAMPTZ(3);
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sections_capacity_check'
  ) THEN
    ALTER TABLE "sections"
      ADD CONSTRAINT "sections_capacity_check" CHECK ("capacity" BETWEEN 1 AND 70);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sections_assigned_room_id_fkey'
  ) THEN
    ALTER TABLE "sections"
      ADD CONSTRAINT "sections_assigned_room_id_fkey"
      FOREIGN KEY ("assigned_room_id") REFERENCES "rooms"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$$;
CREATE INDEX IF NOT EXISTS "sections_semester_id_archived_at_idx" ON "sections"("semester_id", "archived_at");

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "import_batch_id" UUID;
CREATE INDEX IF NOT EXISTS "users_college_id_import_batch_id_idx" ON "users"("college_id", "import_batch_id");

ALTER TABLE "staff_profiles" ADD COLUMN IF NOT EXISTS "qualification" VARCHAR(180);

ALTER TABLE "faculty_subject_assignments"
  ADD COLUMN IF NOT EXISTS "assignment_type" VARCHAR(50) NOT NULL DEFAULT 'PRIMARY_FACULTY',
  ADD COLUMN IF NOT EXISTS "attendance_permission" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "learning_resource_permission" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "assessment_permission" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "section_memberships" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "section_id" UUID NOT NULL,
  "student_user_id" UUID NOT NULL,
  "academic_year_id" UUID,
  "starts_on" DATE NOT NULL,
  "ends_on" DATE,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "section_memberships_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "section_memberships_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "sections"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "section_memberships_student_user_id_fkey" FOREIGN KEY ("student_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "section_memberships_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "section_memberships_dates_check" CHECK ("ends_on" IS NULL OR "ends_on" >= "starts_on")
);
CREATE INDEX "section_memberships_section_id_is_active_idx" ON "section_memberships"("section_id", "is_active");
CREATE INDEX "section_memberships_student_user_id_is_active_idx" ON "section_memberships"("student_user_id", "is_active");
CREATE UNIQUE INDEX "section_memberships_one_active_student_idx" ON "section_memberships"("student_user_id") WHERE "is_active" = true;

INSERT INTO "section_memberships" (
  "section_id", "student_user_id", "academic_year_id", "starts_on", "is_active", "updated_at"
)
SELECT
  profile."section_id",
  profile."user_id",
  semester."academic_year_id",
  CURRENT_DATE,
  true,
  CURRENT_TIMESTAMP
FROM "student_profiles" AS profile
JOIN "sections" AS section ON section."id" = profile."section_id"
JOIN "semesters" AS semester ON semester."id" = section."semester_id"
ON CONFLICT DO NOTHING;

ALTER TABLE "attendance_sessions"
  ADD COLUMN IF NOT EXISTS "archived_at" TIMESTAMPTZ(3);
CREATE INDEX IF NOT EXISTS "attendance_sessions_academic_year_id_archived_at_idx"
  ON "attendance_sessions"("academic_year_id", "archived_at");

ALTER TABLE "issues"
  ADD COLUMN IF NOT EXISTS "archived_at" TIMESTAMPTZ(3);
CREATE INDEX IF NOT EXISTS "issues_college_id_archived_at_closed_at_idx"
  ON "issues"("college_id", "archived_at", "closed_at");

CREATE TABLE "class_staff_assignments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "staff_id" UUID NOT NULL,
  "section_id" UUID NOT NULL,
  "assignment_type" VARCHAR(50) NOT NULL DEFAULT 'PROSPECTIVE_CLASS_STAFF',
  "valid_from" DATE NOT NULL,
  "valid_until" DATE,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "class_staff_assignments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "class_staff_assignments_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "class_staff_assignments_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "sections"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "class_staff_assignments_staff_id_section_id_assignment_type_valid_from_key"
  ON "class_staff_assignments"("staff_id", "section_id", "assignment_type", "valid_from");
CREATE INDEX "class_staff_assignments_section_id_assignment_type_is_active_idx"
  ON "class_staff_assignments"("section_id", "assignment_type", "is_active");

CREATE TABLE "attendance_import_batches" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "college_id" UUID NOT NULL,
  "requested_by_id" UUID NOT NULL,
  "section_id" UUID NOT NULL,
  "subject_id" UUID,
  "import_mode" VARCHAR(50) NOT NULL,
  "attendance_mode" VARCHAR(60) NOT NULL,
  "date_from" DATE NOT NULL,
  "date_to" DATE NOT NULL,
  "source_sha256" VARCHAR(64) NOT NULL,
  "status" "JobStatus" NOT NULL DEFAULT 'UPLOADED',
  "total_rows" INTEGER NOT NULL DEFAULT 0,
  "valid_rows" INTEGER NOT NULL DEFAULT 0,
  "error_rows" INTEGER NOT NULL DEFAULT 0,
  "validation_report" JSONB,
  "confirmed_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "attendance_import_batches_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "attendance_import_batches_college_id_fkey" FOREIGN KEY ("college_id") REFERENCES "colleges"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "attendance_import_batches_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "attendance_import_batches_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "sections"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "attendance_import_batches_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "attendance_import_batches_dates_check" CHECK ("date_to" >= "date_from")
);
CREATE INDEX "attendance_import_batches_college_id_requested_by_id_created_at_idx"
  ON "attendance_import_batches"("college_id", "requested_by_id", "created_at");
CREATE INDEX "attendance_import_batches_section_id_date_from_date_to_idx"
  ON "attendance_import_batches"("section_id", "date_from", "date_to");

CREATE TABLE "attendance_summaries" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "college_id" UUID NOT NULL,
  "student_user_id" UUID NOT NULL,
  "section_id" UUID NOT NULL,
  "subject_id" UUID,
  "academic_year_id" UUID,
  "date_from" DATE NOT NULL,
  "date_to" DATE NOT NULL,
  "total_working" DECIMAL(10,2) NOT NULL,
  "present" DECIMAL(10,2) NOT NULL,
  "absent" DECIMAL(10,2) NOT NULL,
  "percentage" DECIMAL(5,2) NOT NULL,
  "remarks" VARCHAR(500),
  "source" VARCHAR(50) NOT NULL DEFAULT 'EXCEL_SUMMARY',
  "import_batch_id" UUID,
  "is_archived" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "attendance_summaries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "attendance_summaries_college_id_fkey" FOREIGN KEY ("college_id") REFERENCES "colleges"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "attendance_summaries_student_user_id_fkey" FOREIGN KEY ("student_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "attendance_summaries_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "sections"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "attendance_summaries_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "attendance_summaries_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "attendance_summaries_import_batch_id_fkey" FOREIGN KEY ("import_batch_id") REFERENCES "attendance_import_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "attendance_summaries_counts_check" CHECK (
    "total_working" >= 0 AND "present" >= 0 AND "present" <= "total_working"
    AND "absent" = "total_working" - "present"
    AND "percentage" BETWEEN 0 AND 100
  ),
  CONSTRAINT "attendance_summaries_dates_check" CHECK ("date_to" >= "date_from")
);
CREATE UNIQUE INDEX "attendance_summaries_student_user_id_section_id_subject_id_date_from_date_to_key"
  ON "attendance_summaries"("student_user_id", "section_id", "subject_id", "date_from", "date_to");
CREATE INDEX "attendance_summaries_college_id_section_id_subject_id_date_to_idx"
  ON "attendance_summaries"("college_id", "section_id", "subject_id", "date_to");
CREATE INDEX "attendance_summaries_student_user_id_date_to_idx"
  ON "attendance_summaries"("student_user_id", "date_to");

ALTER TABLE "message_attachments"
  ADD COLUMN "upload_status" VARCHAR(30) NOT NULL DEFAULT 'SENT';

CREATE TABLE "message_attachment_uploads" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "college_id" UUID NOT NULL,
  "conversation_id" UUID NOT NULL,
  "uploaded_by_id" UUID NOT NULL,
  "storage_key" TEXT NOT NULL,
  "original_name" VARCHAR(255) NOT NULL,
  "safe_name" VARCHAR(255) NOT NULL,
  "mime_type" VARCHAR(120) NOT NULL,
  "size_bytes" BIGINT NOT NULL,
  "sha256" VARCHAR(64),
  "thumbnail_key" TEXT,
  "width" INTEGER,
  "height" INTEGER,
  "status" VARCHAR(30) NOT NULL DEFAULT 'UPLOADING',
  "last_error" VARCHAR(500),
  "consumed_by_message_id" UUID,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "message_attachment_uploads_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "message_attachment_uploads_storage_key_key" UNIQUE ("storage_key"),
  CONSTRAINT "message_attachment_uploads_college_id_fkey" FOREIGN KEY ("college_id") REFERENCES "colleges"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "message_attachment_uploads_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "message_attachment_uploads_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "message_attachment_uploads_consumed_by_message_id_fkey" FOREIGN KEY ("consumed_by_message_id") REFERENCES "messages"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "message_attachment_uploads_uploaded_by_id_conversation_id_status_idx"
  ON "message_attachment_uploads"("uploaded_by_id", "conversation_id", "status");
CREATE INDEX "message_attachment_uploads_expires_at_status_idx"
  ON "message_attachment_uploads"("expires_at", "status");

CREATE TABLE "message_local_sync_cursors" (
  "user_id" UUID NOT NULL,
  "conversation_id" UUID NOT NULL,
  "last_message_id" UUID,
  "last_synced_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "message_local_sync_cursors_pkey" PRIMARY KEY ("user_id", "conversation_id"),
  CONSTRAINT "message_local_sync_cursors_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "message_local_sync_cursors_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "message_local_sync_cursors_last_message_id_fkey" FOREIGN KEY ("last_message_id") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "archived_records" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "college_id" UUID NOT NULL,
  "entity_type" VARCHAR(80) NOT NULL,
  "entity_id" UUID NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "archived_by_id" UUID NOT NULL,
  "archived_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "restored_at" TIMESTAMPTZ(3),
  "metadata" JSONB,
  CONSTRAINT "archived_records_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "archived_records_college_id_fkey" FOREIGN KEY ("college_id") REFERENCES "colleges"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "archived_records_archived_by_id_fkey" FOREIGN KEY ("archived_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "archived_records_college_id_entity_type_archived_at_idx"
  ON "archived_records"("college_id", "entity_type", "archived_at");
CREATE INDEX "archived_records_entity_type_entity_id_idx"
  ON "archived_records"("entity_type", "entity_id");

CREATE TABLE "data_maintenance_jobs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "college_id" UUID NOT NULL,
  "requested_by_id" UUID NOT NULL,
  "category" VARCHAR(80) NOT NULL,
  "mode" VARCHAR(30) NOT NULL DEFAULT 'DRY_RUN',
  "status" VARCHAR(30) NOT NULL DEFAULT 'ANALYSED',
  "record_counts" JSONB NOT NULL,
  "backup_reference" VARCHAR(255),
  "confirmation_phrase_hash" TEXT,
  "reason" VARCHAR(500),
  "report" JSONB,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "executed_at" TIMESTAMPTZ(3),
  CONSTRAINT "data_maintenance_jobs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "data_maintenance_jobs_college_id_fkey" FOREIGN KEY ("college_id") REFERENCES "colleges"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "data_maintenance_jobs_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "data_maintenance_jobs_college_id_created_at_idx"
  ON "data_maintenance_jobs"("college_id", "created_at");

INSERT INTO "permissions" ("id", "code", "resource", "action", "description")
VALUES
  (gen_random_uuid(), 'users.delete_permanent', 'users', 'delete_permanent', 'Permanently delete an unused user after dependency analysis and confirmation.'),
  (gen_random_uuid(), 'data.maintenance', 'data', 'maintenance', 'Run audited data-maintenance dry runs and archival workflows.'),
  (gen_random_uuid(), 'messages.backup', 'messages', 'backup', 'Export the authenticated user message backup.')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT role."id", permission."id"
FROM "roles" AS role
CROSS JOIN "permissions" AS permission
WHERE role."code" IN ('SUPER_ADMIN', 'MAIN_ADMIN')
  AND permission."code" IN ('users.delete_permanent', 'data.maintenance')
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT DISTINCT existing."role_id", backup."id"
FROM "role_permissions" AS existing
JOIN "permissions" AS send_permission
  ON send_permission."id" = existing."permission_id"
CROSS JOIN "permissions" AS backup
WHERE send_permission."code" = 'messages.send'
  AND backup."code" = 'messages.backup'
ON CONFLICT DO NOTHING;

COMMIT;
