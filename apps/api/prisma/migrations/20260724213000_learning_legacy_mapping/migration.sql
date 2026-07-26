ALTER TABLE "courses" ADD COLUMN "legacy_learning_id" VARCHAR(120);
ALTER TABLE "course_modules" ADD COLUMN "legacy_learning_id" VARCHAR(120);
ALTER TABLE "course_lessons" ADD COLUMN "legacy_learning_id" VARCHAR(120);
ALTER TABLE "course_resources" ADD COLUMN "legacy_learning_id" VARCHAR(120);
ALTER TABLE "course_assessments" ADD COLUMN "legacy_learning_id" VARCHAR(120);

CREATE TABLE "legacy_learning_user_mappings" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "college_id" UUID NOT NULL,
  "legacy_student_id" VARCHAR(120),
  "legacy_user_id" VARCHAR(120),
  "avs_user_id" UUID,
  "college_email" VARCHAR(254),
  "migration_status" VARCHAR(40) NOT NULL DEFAULT 'PENDING',
  "mapped_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "mapped_by_id" UUID,
  "notes" TEXT,
  CONSTRAINT "legacy_learning_user_mappings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "courses_legacy_learning_id_key" ON "courses"("legacy_learning_id");
CREATE UNIQUE INDEX "course_modules_legacy_learning_id_key" ON "course_modules"("legacy_learning_id");
CREATE UNIQUE INDEX "course_lessons_legacy_learning_id_key" ON "course_lessons"("legacy_learning_id");
CREATE UNIQUE INDEX "course_resources_legacy_learning_id_key" ON "course_resources"("legacy_learning_id");
CREATE UNIQUE INDEX "course_assessments_legacy_learning_id_key" ON "course_assessments"("legacy_learning_id");
CREATE INDEX "legacy_learning_user_mappings_college_id_migration_status_idx" ON "legacy_learning_user_mappings"("college_id", "migration_status");
CREATE INDEX "legacy_learning_user_mappings_legacy_student_id_idx" ON "legacy_learning_user_mappings"("legacy_student_id");
CREATE INDEX "legacy_learning_user_mappings_legacy_user_id_idx" ON "legacy_learning_user_mappings"("legacy_user_id");
CREATE INDEX "legacy_learning_user_mappings_avs_user_id_idx" ON "legacy_learning_user_mappings"("avs_user_id");
CREATE UNIQUE INDEX "legacy_learning_user_mappings_college_id_legacy_user_id_key" ON "legacy_learning_user_mappings"("college_id", "legacy_user_id");
