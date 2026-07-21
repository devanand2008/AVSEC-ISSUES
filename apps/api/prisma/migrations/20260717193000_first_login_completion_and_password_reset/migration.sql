ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "first_login_completed_at" TIMESTAMPTZ(3);

UPDATE "users"
SET "first_login_completed_at" = COALESCE("last_login_at", "updated_at")
WHERE "must_change_password" = FALSE
  AND "first_login_completed_at" IS NULL;

CREATE INDEX IF NOT EXISTS "users_college_first_login_completed_idx"
  ON "users"("college_id", "first_login_completed_at");
