CREATE TYPE "QrCodeType" AS ENUM (
  'APPLICATION',
  'BLOCK',
  'FLOOR',
  'CLASS',
  'ANNOUNCEMENT',
  'LINK'
);

CREATE TYPE "QrCodeStatus" AS ENUM (
  'ACTIVE',
  'DISABLED',
  'REVOKED'
);

CREATE TABLE "qr_codes" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "public_id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "college_id" UUID NOT NULL,
  "qr_type" "QrCodeType" NOT NULL,
  "secure_token_hash" VARCHAR(64) NOT NULL,
  "qr_url" VARCHAR(500) NOT NULL,
  "label" VARCHAR(180) NOT NULL,
  "destination" VARCHAR(500) NOT NULL,
  "entity_type" VARCHAR(80),
  "entity_id" UUID,
  "metadata" JSONB,
  "status" "QrCodeStatus" NOT NULL DEFAULT 'ACTIVE',
  "expiry_date" TIMESTAMPTZ(3),
  "revoked_at" TIMESTAMPTZ(3),
  "scan_count" INTEGER NOT NULL DEFAULT 0,
  "last_scanned_at" TIMESTAMPTZ(3),
  "created_by_id" UUID,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "qr_codes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "qr_scan_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "qr_code_id" UUID NOT NULL,
  "college_id" UUID NOT NULL,
  "user_id" UUID,
  "scan_method" VARCHAR(80),
  "success_status" BOOLEAN NOT NULL,
  "failure_reason" VARCHAR(300),
  "destination" VARCHAR(500),
  "ip_address" VARCHAR(64),
  "user_agent" TEXT,
  "scanned_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "qr_scan_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "qr_codes_public_id_key" ON "qr_codes"("public_id");
CREATE UNIQUE INDEX "qr_codes_secure_token_hash_key" ON "qr_codes"("secure_token_hash");
CREATE INDEX "qr_codes_college_id_qr_type_status_idx" ON "qr_codes"("college_id", "qr_type", "status");
CREATE INDEX "qr_codes_entity_type_entity_id_idx" ON "qr_codes"("entity_type", "entity_id");
CREATE INDEX "qr_codes_status_expiry_date_idx" ON "qr_codes"("status", "expiry_date");
CREATE INDEX "qr_scan_events_qr_code_id_scanned_at_idx" ON "qr_scan_events"("qr_code_id", "scanned_at");
CREATE INDEX "qr_scan_events_college_id_scanned_at_idx" ON "qr_scan_events"("college_id", "scanned_at");
CREATE INDEX "qr_scan_events_user_id_scanned_at_idx" ON "qr_scan_events"("user_id", "scanned_at");

ALTER TABLE "qr_codes"
  ADD CONSTRAINT "qr_codes_college_id_fkey"
  FOREIGN KEY ("college_id") REFERENCES "colleges"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "qr_codes"
  ADD CONSTRAINT "qr_codes_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "qr_scan_events"
  ADD CONSTRAINT "qr_scan_events_qr_code_id_fkey"
  FOREIGN KEY ("qr_code_id") REFERENCES "qr_codes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "qr_scan_events"
  ADD CONSTRAINT "qr_scan_events_college_id_fkey"
  FOREIGN KEY ("college_id") REFERENCES "colleges"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "qr_scan_events"
  ADD CONSTRAINT "qr_scan_events_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
