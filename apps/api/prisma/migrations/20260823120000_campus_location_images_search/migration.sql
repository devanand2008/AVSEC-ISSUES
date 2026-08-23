BEGIN;

ALTER TABLE "campuses"
  ADD COLUMN IF NOT EXISTS "description" TEXT,
  ADD COLUMN IF NOT EXISTS "image_storage_key" TEXT;

ALTER TABLE "blocks"
  ADD COLUMN IF NOT EXISTS "image_storage_key" TEXT;

ALTER TABLE "floors"
  ADD COLUMN IF NOT EXISTS "description" TEXT,
  ADD COLUMN IF NOT EXISTS "image_storage_key" TEXT;

ALTER TABLE "rooms"
  ADD COLUMN IF NOT EXISTS "description" TEXT,
  ADD COLUMN IF NOT EXISTS "image_storage_key" TEXT,
  ADD COLUMN IF NOT EXISTS "custom_room_type_label" VARCHAR(80);

-- Existing OTHER rooms predate the configurable label. Give them a safe,
-- editable value so later unrelated updates are not blocked by API validation.
UPDATE "rooms"
SET "custom_room_type_label" = 'Other'
WHERE "room_type" = 'OTHER'
  AND ("custom_room_type_label" IS NULL OR BTRIM("custom_room_type_label") = '');

-- Source workbooks are short-lived. A nullable key records completed object
-- deletion, and expiry provides a durable cleanup retry for abandoned previews.
ALTER TABLE "import_jobs" ALTER COLUMN "source_storage_key" DROP NOT NULL;
ALTER TABLE "import_jobs" ADD COLUMN IF NOT EXISTS "source_expires_at" TIMESTAMPTZ(3);
ALTER TABLE "import_jobs" ADD COLUMN IF NOT EXISTS "processing_attempt_token" VARCHAR(160);
ALTER TABLE "import_jobs" ADD COLUMN IF NOT EXISTS "pending_result_storage_key" TEXT;
ALTER TABLE "import_jobs" ADD COLUMN IF NOT EXISTS "credential_export_claim_id" VARCHAR(80);
ALTER TABLE "import_jobs" ADD COLUMN IF NOT EXISTS "credential_export_claimed_by_id" UUID;
ALTER TABLE "import_jobs" ADD COLUMN IF NOT EXISTS "credential_export_claimed_at" TIMESTAMPTZ(3);
ALTER TABLE "import_job_records" ADD COLUMN IF NOT EXISTS "credential_ciphertext" TEXT;
UPDATE "import_jobs"
SET "source_expires_at" = "created_at" + INTERVAL '24 hours'
WHERE "source_storage_key" IS NOT NULL
  AND "source_expires_at" IS NULL;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "campuses_name_trgm_idx"
  ON "campuses" USING GIN ("name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "campuses_code_trgm_idx"
  ON "campuses" USING GIN ("code" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "blocks_name_trgm_idx"
  ON "blocks" USING GIN ("name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "blocks_code_trgm_idx"
  ON "blocks" USING GIN ("code" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "floors_name_trgm_idx"
  ON "floors" USING GIN ("name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "floors_code_trgm_idx"
  ON "floors" USING GIN ("code" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "rooms_name_trgm_idx"
  ON "rooms" USING GIN ("name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "rooms_code_trgm_idx"
  ON "rooms" USING GIN ("code" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "rooms_room_number_trgm_idx"
  ON "rooms" USING GIN ("room_number" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "rooms_custom_room_type_label_trgm_idx"
  ON "rooms" USING GIN ("custom_room_type_label" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "rooms_department_type_status_idx"
  ON "rooms" ("department_id", "room_type", "is_active", "archived_at");
CREATE INDEX IF NOT EXISTS "import_jobs_source_expires_at_idx"
  ON "import_jobs" ("source_expires_at");

ALTER TYPE "JobStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';
ALTER TYPE "RoomType" ADD VALUE IF NOT EXISTS 'FACULTY_ROOM';
ALTER TYPE "RoomType" ADD VALUE IF NOT EXISTS 'OFFICE';
ALTER TYPE "RoomType" ADD VALUE IF NOT EXISTS 'STORE_ROOM';

COMMIT;
