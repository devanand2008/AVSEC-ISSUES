DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AnnouncementCategory') THEN
    CREATE TYPE "AnnouncementCategory" AS ENUM (
      'GENERAL',
      'URGENT',
      'ACADEMIC',
      'EXAMINATION',
      'ATTENDANCE',
      'EVENT',
      'PLACEMENT',
      'HOLIDAY',
      'DEPARTMENT',
      'MAINTENANCE',
      'CIRCULAR',
      'OTHER'
    );
  END IF;
END $$;

ALTER TABLE "announcements"
  ADD COLUMN IF NOT EXISTS "category" "AnnouncementCategory" NOT NULL DEFAULT 'GENERAL',
  ADD COLUMN IF NOT EXISTS "image_storage_key" TEXT,
  ADD COLUMN IF NOT EXISTS "image_url" TEXT,
  ADD COLUMN IF NOT EXISTS "image_mime_type" VARCHAR(120),
  ADD COLUMN IF NOT EXISTS "image_width" INTEGER,
  ADD COLUMN IF NOT EXISTS "image_height" INTEGER,
  ADD COLUMN IF NOT EXISTS "image_size_bytes" BIGINT,
  ADD COLUMN IF NOT EXISTS "show_on_app_open" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "show_only_once" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "send_push" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "send_email" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "published_at" TIMESTAMPTZ(3),
  ADD COLUMN IF NOT EXISTS "archived_at" TIMESTAMPTZ(3),
  ADD COLUMN IF NOT EXISTS "total_recipients" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "idempotency_key" VARCHAR(120);

UPDATE "announcements"
SET "show_on_app_open" = false
WHERE "show_on_app_open" IS NULL;

ALTER TABLE "announcements"
  ALTER COLUMN "show_on_app_open" SET DEFAULT true,
  ALTER COLUMN "show_on_app_open" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "announcements_idempotency_key_key"
  ON "announcements"("idempotency_key");

CREATE INDEX IF NOT EXISTS "announcements_college_id_status_publish_at_idx"
  ON "announcements"("college_id", "status", "publish_at");

CREATE INDEX IF NOT EXISTS "announcements_college_id_status_expires_at_idx"
  ON "announcements"("college_id", "status", "expires_at");
