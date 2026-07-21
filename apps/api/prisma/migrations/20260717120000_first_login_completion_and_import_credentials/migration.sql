ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "first_login_completed_at" TIMESTAMPTZ(3);

CREATE INDEX IF NOT EXISTS "users_college_id_must_change_password_idx"
  ON "users"("college_id", "must_change_password");
