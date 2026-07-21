-- Preserve every existing submission while introducing an atomic, server-derived
-- duplicate window key for all new feedback writes.
ALTER TABLE "feedback_submissions"
  ADD COLUMN "qr_code_id" UUID,
  ADD COLUMN "submission_window_key" VARCHAR(160);

UPDATE "feedback_submissions"
SET "submission_window_key" = 'LEGACY:' || "id"::text
WHERE "submission_window_key" IS NULL;

ALTER TABLE "feedback_submissions"
  ALTER COLUMN "submission_window_key" SET NOT NULL;

ALTER TABLE "feedback_submissions"
  ADD CONSTRAINT "feedback_submissions_qr_code_id_fkey"
  FOREIGN KEY ("qr_code_id") REFERENCES "feedback_qr_codes"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "feedback_submissions_student_user_id_target_id_submission_window_key_key"
  ON "feedback_submissions"("student_user_id", "target_id", "submission_window_key");

CREATE INDEX "feedback_submissions_qr_code_id_submitted_at_idx"
  ON "feedback_submissions"("qr_code_id", "submitted_at");

-- NOT VALID avoids rejecting a deployment because of historical rows written by
-- an older application version while still enforcing the constraints for every
-- new or updated row. Operations can validate them after any legacy cleanup.
ALTER TABLE "feedback_submissions"
  ADD CONSTRAINT "feedback_submissions_overall_rating_check"
  CHECK ("overall_rating" BETWEEN 1 AND 5) NOT VALID;

ALTER TABLE "feedback_ratings"
  ADD CONSTRAINT "feedback_ratings_rating_check"
  CHECK ("rating" BETWEEN 1 AND 5) NOT VALID;
