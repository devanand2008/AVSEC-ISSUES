ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "first_login_completed_at" TIMESTAMPTZ(3);

ALTER TABLE "import_jobs" ADD COLUMN IF NOT EXISTS "credential_exported_at" TIMESTAMPTZ(3);
