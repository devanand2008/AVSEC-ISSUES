CREATE TYPE "ResourceType" AS ENUM (
  'PDF',
  'VIDEO',
  'LINK',
  'PRESENTATION',
  'DOCUMENT',
  'ARCHIVE',
  'OTHER'
);

CREATE TYPE "CourseStatus" AS ENUM (
  'DRAFT',
  'PUBLISHED',
  'ARCHIVED'
);

CREATE TYPE "AssessmentType" AS ENUM (
  'QUIZ',
  'EXAM',
  'ASSIGNMENT',
  'CODING'
);

CREATE TABLE "courses" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "college_id" UUID NOT NULL,
  "department_id" UUID,
  "programme_id" UUID,
  "code" VARCHAR(60) NOT NULL,
  "title" VARCHAR(180) NOT NULL,
  "description" TEXT,
  "status" "CourseStatus" NOT NULL DEFAULT 'DRAFT',
  "thumbnail_url" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "courses_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "courses_college_id_fkey" FOREIGN KEY ("college_id") REFERENCES "colleges"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "courses_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "courses_programme_id_fkey" FOREIGN KEY ("programme_id") REFERENCES "programmes"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "course_modules" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "course_id" UUID NOT NULL,
  "title" VARCHAR(180) NOT NULL,
  "description" TEXT,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "course_modules_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "course_modules_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "course_lessons" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "module_id" UUID NOT NULL,
  "title" VARCHAR(180) NOT NULL,
  "content" TEXT,
  "video_url" TEXT,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "course_lessons_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "course_lessons_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "course_modules"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "course_resources" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "course_id" UUID NOT NULL,
  "module_id" UUID,
  "title" VARCHAR(180) NOT NULL,
  "description" TEXT,
  "type" "ResourceType" NOT NULL DEFAULT 'OTHER',
  "url" TEXT NOT NULL,
  "uploaded_by_id" UUID,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "course_resources_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "course_resources_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "course_resources_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "course_modules"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "course_assessments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "course_id" UUID NOT NULL,
  "title" VARCHAR(180) NOT NULL,
  "description" TEXT,
  "type" "AssessmentType" NOT NULL DEFAULT 'QUIZ',
  "max_score" INTEGER NOT NULL DEFAULT 100,
  "passing_score" INTEGER NOT NULL DEFAULT 50,
  "questions_json" JSONB,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "course_assessments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "course_assessments_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "student_progress" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "student_id" UUID NOT NULL,
  "course_id" UUID NOT NULL,
  "lesson_id" UUID NOT NULL,
  "completed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "student_progress_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "student_progress_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "student_progress_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "course_lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "assessment_results" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "student_id" UUID NOT NULL,
  "course_id" UUID NOT NULL,
  "assessment_id" UUID NOT NULL,
  "score" INTEGER NOT NULL,
  "passed" BOOLEAN NOT NULL,
  "completed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "answers_json" JSONB,
  CONSTRAINT "assessment_results_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "assessment_results_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "assessment_results_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "course_assessments"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "courses_college_id_code_key" ON "courses"("college_id", "code");
CREATE INDEX "courses_college_id_status_idx" ON "courses"("college_id", "status");
CREATE INDEX "course_modules_course_id_sort_order_idx" ON "course_modules"("course_id", "sort_order");
CREATE INDEX "course_lessons_module_id_sort_order_idx" ON "course_lessons"("module_id", "sort_order");
CREATE INDEX "course_resources_course_id_type_idx" ON "course_resources"("course_id", "type");
CREATE INDEX "course_assessments_course_id_idx" ON "course_assessments"("course_id");
CREATE UNIQUE INDEX "student_progress_student_id_lesson_id_key" ON "student_progress"("student_id", "lesson_id");
CREATE INDEX "student_progress_student_id_course_id_idx" ON "student_progress"("student_id", "course_id");
CREATE INDEX "assessment_results_student_id_assessment_id_idx" ON "assessment_results"("student_id", "assessment_id");
CREATE INDEX "assessment_results_course_id_idx" ON "assessment_results"("course_id");
