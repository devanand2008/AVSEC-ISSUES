BEGIN;

ALTER TABLE "campuses" ADD COLUMN "is_test_data" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "blocks" ADD COLUMN "is_test_data" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "floors" ADD COLUMN "is_test_data" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "rooms" ADD COLUMN "is_test_data" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "issues"
  ADD COLUMN "occurrence_count" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "first_reported_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "last_reported_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "work_started_at" TIMESTAMPTZ(3),
  ADD COLUMN "expected_completion_at" TIMESTAMPTZ(3),
  ADD COLUMN "overdue_at" TIMESTAMPTZ(3);

CREATE TABLE "issue_timelines" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "issue_id" UUID NOT NULL,
  "expected_completion_at" TIMESTAMPTZ(3) NOT NULL,
  "reason" VARCHAR(1000) NOT NULL,
  "progress_note" VARCHAR(2000) NOT NULL,
  "required_parts" VARCHAR(1000),
  "required_approval" BOOLEAN NOT NULL DEFAULT false,
  "created_by_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "superseded_at" TIMESTAMPTZ(3),
  CONSTRAINT "issue_timelines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "issue_timelines_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "issues"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "issue_timelines_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "issue_timelines_issue_id_created_at_idx" ON "issue_timelines"("issue_id", "created_at");

CREATE TABLE "issue_resolutions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "issue_id" UUID NOT NULL,
  "resolution_note" VARCHAR(5000) NOT NULL,
  "completion_photo_file_id" UUID NOT NULL,
  "parts_used" VARCHAR(2000),
  "cost_note" VARCHAR(1000),
  "supervisor_comment" VARCHAR(2000),
  "completed_by_id" UUID NOT NULL,
  "completed_at" TIMESTAMPTZ(3) NOT NULL,
  "verified_at" TIMESTAMPTZ(3),
  CONSTRAINT "issue_resolutions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "issue_resolutions_issue_id_key" UNIQUE ("issue_id"),
  CONSTRAINT "issue_resolutions_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "issues"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "issue_resolutions_completed_by_id_fkey" FOREIGN KEY ("completed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "issue_occurrences" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "issue_id" UUID NOT NULL,
  "reporter_user_id" UUID NOT NULL,
  "description" TEXT NOT NULL,
  "reported_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "issue_occurrences_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "issue_occurrences_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "issues"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "issue_occurrences_reporter_user_id_fkey" FOREIGN KEY ("reporter_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "issue_occurrences_issue_id_reported_at_idx" ON "issue_occurrences"("issue_id", "reported_at");
CREATE INDEX "issue_occurrences_reporter_user_id_reported_at_idx" ON "issue_occurrences"("reporter_user_id", "reported_at");

COMMIT;
