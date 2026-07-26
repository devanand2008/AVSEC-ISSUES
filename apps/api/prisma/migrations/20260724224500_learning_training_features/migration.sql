ALTER TABLE "courses"
  ADD COLUMN "category" VARCHAR(100),
  ADD COLUMN "level" VARCHAR(60),
  ADD COLUMN "programming_language" VARCHAR(40);

ALTER TABLE "course_lessons"
  ADD COLUMN "level" VARCHAR(60),
  ADD COLUMN "lesson_type" VARCHAR(40),
  ADD COLUMN "duration_minutes" INTEGER,
  ADD COLUMN "example_code" TEXT,
  ADD COLUMN "programming_language" VARCHAR(40),
  ADD COLUMN "practice_json" JSONB;

CREATE TABLE "learning_bookmarks" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "student_id" UUID NOT NULL,
  "lesson_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "learning_bookmarks_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "learning_bookmarks_lesson_id_fkey"
    FOREIGN KEY ("lesson_id") REFERENCES "course_lessons"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "learning_bookmarks_student_id_lesson_id_key"
  ON "learning_bookmarks"("student_id", "lesson_id");
CREATE INDEX "learning_bookmarks_student_id_created_at_idx"
  ON "learning_bookmarks"("student_id", "created_at");

CREATE TABLE "learning_certificates" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "certificate_number" VARCHAR(60) NOT NULL,
  "student_id" UUID NOT NULL,
  "course_id" UUID NOT NULL,
  "assessment_result_id" UUID NOT NULL,
  "score" INTEGER NOT NULL,
  "issued_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "learning_certificates_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "learning_certificates_course_id_fkey"
    FOREIGN KEY ("course_id") REFERENCES "courses"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "learning_certificates_certificate_number_key"
  ON "learning_certificates"("certificate_number");
CREATE UNIQUE INDEX "learning_certificates_student_id_course_id_key"
  ON "learning_certificates"("student_id", "course_id");
CREATE INDEX "learning_certificates_student_id_issued_at_idx"
  ON "learning_certificates"("student_id", "issued_at");
CREATE INDEX "learning_certificates_course_id_idx"
  ON "learning_certificates"("course_id");
