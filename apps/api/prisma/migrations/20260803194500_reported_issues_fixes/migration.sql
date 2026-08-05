-- Reported production defects: location choices, half-day attendance,
-- configurable assessments and auditable compiler executions.
-- This migration is additive and preserves all existing production rows.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BroadcastAudienceType') THEN
    CREATE TYPE "BroadcastAudienceType" AS ENUM ('ALL', 'ROLE', 'DEPARTMENT', 'PROGRAMME', 'ACADEMIC_YEAR', 'SEMESTER', 'SECTION', 'INDIVIDUAL');
  ELSE
    ALTER TYPE "BroadcastAudienceType" ADD VALUE IF NOT EXISTS 'PROGRAMME';
    ALTER TYPE "BroadcastAudienceType" ADD VALUE IF NOT EXISTS 'ACADEMIC_YEAR';
    ALTER TYPE "BroadcastAudienceType" ADD VALUE IF NOT EXISTS 'SEMESTER';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BroadcastStatus') THEN
    CREATE TYPE "BroadcastStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'QUEUED', 'SENDING', 'SENT', 'FAILED', 'CANCELLED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BroadcastDeliveryStatus') THEN
    CREATE TYPE "BroadcastDeliveryStatus" AS ENUM ('QUEUED', 'DELIVERED', 'FAILED', 'SKIPPED');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'LocationType') THEN
    CREATE TYPE "LocationType" AS ENUM ('ROOM', 'AREA');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SessionType') THEN
    CREATE TYPE "SessionType" AS ENUM ('LECTURE', 'LAB', 'TUTORIAL', 'SEMINAR', 'ACTIVITY', 'OTHER');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AttendancePartStatus') THEN
    CREATE TYPE "AttendancePartStatus" AS ENUM ('PRESENT', 'ABSENT');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CompilerExecutionStatus') THEN
    CREATE TYPE "CompilerExecutionStatus" AS ENUM ('QUEUED', 'COMPILING', 'RUNNING', 'ACCEPTED', 'WRONG_ANSWER', 'COMPILATION_ERROR', 'RUNTIME_ERROR', 'TIME_LIMIT_EXCEEDED', 'MEMORY_LIMIT_EXCEEDED', 'INTERNAL_ERROR');
  END IF;
END $$;

ALTER TABLE "attendance_sessions"
  ADD COLUMN IF NOT EXISTS "session_type" "SessionType" NOT NULL DEFAULT 'LECTURE';

ALTER TABLE "attendance_records"
  ADD COLUMN IF NOT EXISTS "morning_status" "AttendancePartStatus",
  ADD COLUMN IF NOT EXISTS "afternoon_status" "AttendancePartStatus",
  ADD COLUMN IF NOT EXISTS "effective_attendance_value" DECIMAL(3,2) NOT NULL DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS "correction_reason" VARCHAR(1000),
  ADD COLUMN IF NOT EXISTS "corrected_by_id" UUID,
  ADD COLUMN IF NOT EXISTS "corrected_at" TIMESTAMPTZ(3);

UPDATE "attendance_records"
SET "effective_attendance_value" = CASE
  WHEN "status" IN ('ABSENT', 'MEDICAL_LEAVE') THEN 0.0
  ELSE 1.0
END;

ALTER TABLE "attendance_records"
  DROP CONSTRAINT IF EXISTS "attendance_records_half_day_consistency_check";
ALTER TABLE "attendance_records"
  ADD CONSTRAINT "attendance_records_half_day_consistency_check" CHECK (
    (
      "status" IN ('HALF_DAY_PRESENT', 'HALF_DAY_ABSENT')
      AND "morning_status" IS NOT NULL
      AND "afternoon_status" IS NOT NULL
      AND "morning_status" <> "afternoon_status"
      AND "effective_attendance_value" = 0.5
    ) OR (
      "status" NOT IN ('HALF_DAY_PRESENT', 'HALF_DAY_ABSENT')
      AND "morning_status" IS NULL
      AND "afternoon_status" IS NULL
      AND (
        ("status" IN ('PRESENT', 'LATE', 'ON_DUTY', 'AUTHORIZED_LEAVE') AND "effective_attendance_value" = 1.0)
        OR ("status" IN ('ABSENT', 'MEDICAL_LEAVE') AND "effective_attendance_value" = 0.0)
      )
    )
  );

ALTER TABLE "attendance_change_histories"
  ADD COLUMN IF NOT EXISTS "previous_morning_status" "AttendancePartStatus",
  ADD COLUMN IF NOT EXISTS "previous_afternoon_status" "AttendancePartStatus",
  ADD COLUMN IF NOT EXISTS "morning_status" "AttendancePartStatus",
  ADD COLUMN IF NOT EXISTS "afternoon_status" "AttendancePartStatus",
  ADD COLUMN IF NOT EXISTS "previous_effective_attendance_value" DECIMAL(3,2),
  ADD COLUMN IF NOT EXISTS "new_effective_attendance_value" DECIMAL(3,2);

ALTER TABLE "attendance_change_histories"
  DROP CONSTRAINT IF EXISTS "attendance_history_effective_value_check",
  DROP CONSTRAINT IF EXISTS "attendance_history_new_parts_check",
  DROP CONSTRAINT IF EXISTS "attendance_history_new_effective_required_check";
ALTER TABLE "attendance_change_histories"
  ADD CONSTRAINT "attendance_history_effective_value_check" CHECK (
    "new_effective_attendance_value" BETWEEN 0.0 AND 1.0
    AND ("previous_effective_attendance_value" IS NULL OR "previous_effective_attendance_value" BETWEEN 0.0 AND 1.0)
  ),
  ADD CONSTRAINT "attendance_history_new_parts_check" CHECK (
    (
      "new_status" IN ('HALF_DAY_PRESENT', 'HALF_DAY_ABSENT')
      AND "morning_status" IS NOT NULL
      AND "afternoon_status" IS NOT NULL
      AND "morning_status" <> "afternoon_status"
      AND "new_effective_attendance_value" = 0.5
    ) OR (
      "new_status" NOT IN ('HALF_DAY_PRESENT', 'HALF_DAY_ABSENT')
      AND "morning_status" IS NULL
      AND "afternoon_status" IS NULL
      AND (
        ("new_status" IN ('PRESENT', 'LATE', 'ON_DUTY', 'AUTHORIZED_LEAVE') AND "new_effective_attendance_value" = 1.0)
        OR ("new_status" IN ('ABSENT', 'MEDICAL_LEAVE') AND "new_effective_attendance_value" = 0.0)
      )
    )
  );
ALTER TABLE "attendance_change_histories"
  ADD CONSTRAINT "attendance_history_new_effective_required_check" CHECK (
    "new_effective_attendance_value" IS NOT NULL
  ) NOT VALID;

CREATE TABLE "areas" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "floor_id" UUID NOT NULL,
  "code" VARCHAR(40) NOT NULL,
  "name" VARCHAR(150) NOT NULL,
  "description" VARCHAR(500),
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "archived_at" TIMESTAMPTZ(3),
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "areas_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "areas_floor_id_fkey" FOREIGN KEY ("floor_id") REFERENCES "floors"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "areas_floor_id_code_key" ON "areas"("floor_id", "code");
CREATE INDEX "areas_floor_id_is_active_sort_order_idx" ON "areas"("floor_id", "is_active", "sort_order");
CREATE INDEX "areas_floor_id_archived_at_idx" ON "areas"("floor_id", "archived_at");

ALTER TABLE "assets" ALTER COLUMN "room_id" DROP NOT NULL;
ALTER TABLE "assets" ADD COLUMN "area_id" UUID;
ALTER TABLE "assets"
  ADD CONSTRAINT "assets_area_id_fkey" FOREIGN KEY ("area_id") REFERENCES "areas"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "assets_single_location_check" CHECK (
    ("room_id" IS NOT NULL AND "area_id" IS NULL) OR
    ("room_id" IS NULL AND "area_id" IS NOT NULL)
  );
CREATE INDEX "assets_area_id_is_active_idx" ON "assets"("area_id", "is_active");

ALTER TABLE "issue_assignment_rules" ADD COLUMN "area_id" UUID;
ALTER TABLE "issue_assignment_rules"
  ADD CONSTRAINT "issue_assignment_rules_area_id_fkey" FOREIGN KEY ("area_id") REFERENCES "areas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "issue_assignment_rules_area_id_category_id_issue_type_id_idx"
  ON "issue_assignment_rules"("area_id", "category_id", "issue_type_id");

ALTER TABLE "issues"
  ADD COLUMN "location_type" "LocationType" NOT NULL DEFAULT 'ROOM',
  ADD COLUMN "area_id" UUID,
  ADD COLUMN "custom_area_name" VARCHAR(150),
  ADD COLUMN "custom_asset_name" VARCHAR(150);
ALTER TABLE "issues" ALTER COLUMN "room_id" DROP NOT NULL;
ALTER TABLE "issues"
  ADD CONSTRAINT "issues_area_id_fkey" FOREIGN KEY ("area_id") REFERENCES "areas"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "issues_location_choice_check" CHECK (
    ("location_type" = 'ROOM' AND "room_id" IS NOT NULL AND "area_id" IS NULL AND "custom_area_name" IS NULL) OR
    ("location_type" = 'AREA' AND "room_id" IS NULL AND (
      ("area_id" IS NOT NULL AND "custom_area_name" IS NULL) OR
      ("area_id" IS NULL AND "custom_area_name" IS NOT NULL)
    ))
  ),
  ADD CONSTRAINT "issues_asset_choice_check" CHECK (
    NOT ("asset_id" IS NOT NULL AND "custom_asset_name" IS NOT NULL)
  );
CREATE INDEX "issues_area_id_category_id_issue_type_id_asset_id_status_idx"
  ON "issues"("area_id", "category_id", "issue_type_id", "asset_id", "status");

ALTER TABLE "course_assessments"
  ADD COLUMN "instructions" TEXT,
  ADD COLUMN "question_count" INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN "pass_percentage" INTEGER NOT NULL DEFAULT 50,
  ADD COLUMN "time_limit_minutes" INTEGER,
  ADD COLUMN "maximum_attempts" INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN "shuffle_questions" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "shuffle_options" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "show_correct_answers" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "show_explanations" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "status" VARCHAR(30) NOT NULL DEFAULT 'DRAFT';

UPDATE "course_assessments" SET "status" = 'PUBLISHED';

UPDATE "course_assessments"
SET
  "pass_percentage" = LEAST(100, GREATEST(1, CEIL("passing_score" * 100.0 / GREATEST("max_score", 1))::INTEGER)),
  "question_count" = CASE
    WHEN jsonb_typeof("questions_json" -> 'questions') = 'array'
      THEN LEAST(200, GREATEST(1, jsonb_array_length("questions_json" -> 'questions')))
    ELSE "question_count"
  END;

ALTER TABLE "course_assessments"
  ADD CONSTRAINT "course_assessments_configuration_check" CHECK (
    "question_count" BETWEEN 1 AND 200
    AND "pass_percentage" BETWEEN 1 AND 100
    AND "maximum_attempts" BETWEEN 1 AND 50
    AND ("time_limit_minutes" IS NULL OR "time_limit_minutes" BETWEEN 1 AND 480)
    AND "status" IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')
  );

CREATE TABLE "assessment_attempts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "student_id" UUID NOT NULL,
  "course_id" UUID NOT NULL,
  "assessment_id" UUID NOT NULL,
  "attempt_number" INTEGER NOT NULL,
  "status" VARCHAR(30) NOT NULL DEFAULT 'IN_PROGRESS',
  "question_order" JSONB,
  "answers_json" JSONB,
  "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMPTZ(3),
  "submitted_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "assessment_attempts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "assessment_attempts_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "assessment_attempts_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "course_assessments"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "assessment_attempts_student_id_assessment_id_attempt_number_key"
  ON "assessment_attempts"("student_id", "assessment_id", "attempt_number");
CREATE UNIQUE INDEX "assessment_attempts_one_active_per_student_assessment_key"
  ON "assessment_attempts"("student_id", "assessment_id")
  WHERE "status" = 'IN_PROGRESS';
CREATE INDEX "assessment_attempts_student_id_assessment_id_status_idx"
  ON "assessment_attempts"("student_id", "assessment_id", "status");
ALTER TABLE "assessment_attempts"
  ADD CONSTRAINT "assessment_attempts_state_check" CHECK (
    "attempt_number" > 0 AND "status" IN ('IN_PROGRESS', 'SUBMITTED', 'EXPIRED')
  );

ALTER TABLE "assessment_results" ADD COLUMN "attempt_id" UUID;
CREATE UNIQUE INDEX "assessment_results_attempt_id_key" ON "assessment_results"("attempt_id");
ALTER TABLE "assessment_results"
  ADD CONSTRAINT "assessment_results_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "assessment_attempts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "compiler_executions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "college_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "language" VARCHAR(30) NOT NULL,
  "source_hash" VARCHAR(64) NOT NULL,
  "source_length" INTEGER NOT NULL,
  "stdin_length" INTEGER NOT NULL DEFAULT 0,
  "status" "CompilerExecutionStatus" NOT NULL DEFAULT 'QUEUED',
  "stdout" TEXT,
  "stderr" TEXT,
  "compile_output" TEXT,
  "execution_time_ms" INTEGER,
  "memory_kb" INTEGER,
  "provider" VARCHAR(40),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMPTZ(3),
  CONSTRAINT "compiler_executions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "compiler_executions_user_id_created_at_idx" ON "compiler_executions"("user_id", "created_at");
CREATE INDEX "compiler_executions_college_id_status_created_at_idx" ON "compiler_executions"("college_id", "status", "created_at");
ALTER TABLE "compiler_executions"
  ADD CONSTRAINT "compiler_executions_bounds_check" CHECK (
    "source_length" BETWEEN 1 AND 50000
    AND "stdin_length" BETWEEN 0 AND 10000
    AND ("execution_time_ms" IS NULL OR "execution_time_ms" >= 0)
    AND ("memory_kb" IS NULL OR "memory_kb" >= 0)
  );

CREATE TABLE IF NOT EXISTS "broadcasts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "college_id" UUID NOT NULL,
  "author_id" UUID NOT NULL,
  "title" VARCHAR(180) NOT NULL,
  "body" TEXT NOT NULL,
  "audience_type" "BroadcastAudienceType" NOT NULL,
  "audience_value" VARCHAR(120),
  "status" "BroadcastStatus" NOT NULL DEFAULT 'DRAFT',
  "scheduled_at" TIMESTAMPTZ(3),
  "sent_at" TIMESTAMPTZ(3),
  "failed_at" TIMESTAMPTZ(3),
  "cancelled_at" TIMESTAMPTZ(3),
  "total_recipients" INTEGER NOT NULL DEFAULT 0,
  "delivered_count" INTEGER NOT NULL DEFAULT 0,
  "failed_count" INTEGER NOT NULL DEFAULT 0,
  "error_message" VARCHAR(500),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "broadcasts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "broadcasts_college_id_fkey" FOREIGN KEY ("college_id") REFERENCES "colleges"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "broadcasts_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "broadcasts_college_id_status_created_at_idx" ON "broadcasts"("college_id", "status", "created_at");
CREATE INDEX IF NOT EXISTS "broadcasts_college_id_scheduled_at_idx" ON "broadcasts"("college_id", "scheduled_at");

CREATE TABLE IF NOT EXISTS "broadcast_recipients" (
  "broadcast_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "status" "BroadcastDeliveryStatus" NOT NULL DEFAULT 'QUEUED',
  "delivered_at" TIMESTAMPTZ(3),
  "read_at" TIMESTAMPTZ(3),
  "failure_reason" VARCHAR(300),
  CONSTRAINT "broadcast_recipients_pkey" PRIMARY KEY ("broadcast_id", "user_id"),
  CONSTRAINT "broadcast_recipients_broadcast_id_fkey" FOREIGN KEY ("broadcast_id") REFERENCES "broadcasts"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "broadcast_recipients_user_id_status_idx" ON "broadcast_recipients"("user_id", "status");
