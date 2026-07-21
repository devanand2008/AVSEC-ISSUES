DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AnnouncementDeliveryStatus') THEN
    CREATE TYPE "AnnouncementDeliveryStatus" AS ENUM (
      'PENDING',
      'DELIVERED',
      'DISPLAYED',
      'VIEWED',
      'ACKNOWLEDGED',
      'FAILED',
      'EXPIRED'
    );
  END IF;
END $$;

ALTER TABLE "announcement_read_receipts"
  ALTER COLUMN "read_at" DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS "delivery_status" "AnnouncementDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS "first_delivered_at" TIMESTAMPTZ(3),
  ADD COLUMN IF NOT EXISTS "first_displayed_at" TIMESTAMPTZ(3),
  ADD COLUMN IF NOT EXISTS "first_viewed_at" TIMESTAMPTZ(3),
  ADD COLUMN IF NOT EXISTS "dismissed_at" TIMESTAMPTZ(3),
  ADD COLUMN IF NOT EXISTS "last_opened_at" TIMESTAMPTZ(3),
  ADD COLUMN IF NOT EXISTS "open_count" INTEGER NOT NULL DEFAULT 0;

UPDATE "announcement_read_receipts"
SET
  "delivery_status" = CASE
    WHEN "acknowledged_at" IS NOT NULL THEN 'ACKNOWLEDGED'::"AnnouncementDeliveryStatus"
    WHEN "read_at" IS NOT NULL THEN 'VIEWED'::"AnnouncementDeliveryStatus"
    ELSE "delivery_status"
  END,
  "first_delivered_at" = COALESCE("first_delivered_at", "read_at"),
  "first_displayed_at" = COALESCE("first_displayed_at", "read_at"),
  "first_viewed_at" = COALESCE("first_viewed_at", "read_at"),
  "last_opened_at" = COALESCE("last_opened_at", "read_at"),
  "open_count" = CASE
    WHEN "open_count" = 0 AND "read_at" IS NOT NULL THEN 1
    ELSE "open_count"
  END;

CREATE INDEX IF NOT EXISTS "announcement_read_receipts_user_id_delivery_status_first_viewed_at_idx"
  ON "announcement_read_receipts"("user_id", "delivery_status", "first_viewed_at");

CREATE INDEX IF NOT EXISTS "announcement_read_receipts_announcement_id_delivery_status_idx"
  ON "announcement_read_receipts"("announcement_id", "delivery_status");
