ALTER TABLE "users"
ADD COLUMN IF NOT EXISTS "first_login_completed_at" TIMESTAMPTZ(3);
