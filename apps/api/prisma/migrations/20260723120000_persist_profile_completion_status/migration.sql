CREATE TYPE "ProfileCompletionStatus" AS ENUM (
  'NOT_STARTED',
  'IN_PROGRESS',
  'SUBMITTED',
  'VERIFIED',
  'REJECTED'
);

ALTER TABLE "users"
  ADD COLUMN "profile_completion_status" "ProfileCompletionStatus" NOT NULL DEFAULT 'NOT_STARTED',
  ADD COLUMN "profile_completion_percentage" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "profile_submitted_at" TIMESTAMPTZ(3),
  ADD COLUMN "profile_verified_at" TIMESTAMPTZ(3),
  ADD COLUMN "profile_verified_by_id" UUID,
  ADD COLUMN "profile_rejection_reason" VARCHAR(500);

UPDATE "users" u
SET
  "profile_completion_status" = 'SUBMITTED',
  "profile_completion_percentage" = 100,
  "profile_submitted_at" = COALESCE(u."first_login_completed_at", u."updated_at")
WHERE EXISTS (
  SELECT 1 FROM "student_profiles" sp WHERE sp."user_id" = u."id"
) OR EXISTS (
  SELECT 1 FROM "staff_profiles" sf WHERE sf."user_id" = u."id"
);

CREATE INDEX "users_college_id_profile_completion_status_idx"
  ON "users"("college_id", "profile_completion_status");
