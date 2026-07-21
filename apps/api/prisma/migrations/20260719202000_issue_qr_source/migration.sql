ALTER TABLE "issues"
  ADD COLUMN "submission_source" VARCHAR(40) NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "qr_token" VARCHAR(180),
  ADD COLUMN "scanned_location_id" UUID;

CREATE INDEX "issues_submission_source_scanned_location_id_created_at_idx"
  ON "issues"("submission_source", "scanned_location_id", "created_at");
