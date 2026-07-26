CREATE TABLE "subject_resources" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "subject_id" UUID NOT NULL,
  "uploaded_by_id" UUID NOT NULL,
  "title" VARCHAR(180) NOT NULL,
  "description" VARCHAR(1000),
  "unit_or_module" VARCHAR(120),
  "resource_type" VARCHAR(60) NOT NULL,
  "storage_key" TEXT NOT NULL,
  "original_file_name" VARCHAR(255) NOT NULL,
  "safe_file_name" VARCHAR(255) NOT NULL,
  "mime_type" VARCHAR(120) NOT NULL,
  "file_size" BIGINT NOT NULL,
  "sha256" VARCHAR(64) NOT NULL,
  "status" VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
  "publish_at" TIMESTAMPTZ(3),
  "expires_at" TIMESTAMPTZ(3),
  "allow_download" BOOLEAN NOT NULL DEFAULT true,
  "notify_students" BOOLEAN NOT NULL DEFAULT false,
  "send_to_subject_group" BOOLEAN NOT NULL DEFAULT false,
  "archived_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "subject_resources_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "subject_resources_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "subject_resources_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "subject_resource_sections" (
  "resource_id" UUID NOT NULL,
  "section_id" UUID NOT NULL,
  CONSTRAINT "subject_resource_sections_pkey" PRIMARY KEY ("resource_id", "section_id"),
  CONSTRAINT "subject_resource_sections_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "subject_resources"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "subject_resource_sections_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "sections"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "subject_resource_views" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "resource_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "first_viewed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_viewed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "view_count" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "subject_resource_views_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "subject_resource_views_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "subject_resources"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "subject_resource_views_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "model_question_papers" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "subject_id" UUID NOT NULL,
  "uploaded_by_id" UUID NOT NULL,
  "title" VARCHAR(180) NOT NULL,
  "academic_year" VARCHAR(30),
  "exam_type" VARCHAR(60) NOT NULL,
  "maximum_marks" INTEGER,
  "duration_minutes" INTEGER,
  "storage_key" TEXT NOT NULL,
  "answer_key_storage_key" TEXT,
  "original_file_name" VARCHAR(255) NOT NULL,
  "safe_file_name" VARCHAR(255) NOT NULL,
  "mime_type" VARCHAR(120) NOT NULL,
  "file_size" BIGINT NOT NULL,
  "sha256" VARCHAR(64) NOT NULL,
  "status" VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
  "publish_at" TIMESTAMPTZ(3),
  "expires_at" TIMESTAMPTZ(3),
  "answer_key_release_at" TIMESTAMPTZ(3),
  "archived_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "model_question_papers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "model_question_papers_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "model_question_papers_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "model_question_paper_sections" (
  "paper_id" UUID NOT NULL,
  "section_id" UUID NOT NULL,
  CONSTRAINT "model_question_paper_sections_pkey" PRIMARY KEY ("paper_id", "section_id"),
  CONSTRAINT "model_question_paper_sections_paper_id_fkey" FOREIGN KEY ("paper_id") REFERENCES "model_question_papers"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "model_question_paper_sections_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "sections"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "subject_resources_storage_key_key" ON "subject_resources"("storage_key");
CREATE INDEX "subject_resources_subject_id_status_publish_at_idx" ON "subject_resources"("subject_id", "status", "publish_at");
CREATE INDEX "subject_resources_uploaded_by_id_created_at_idx" ON "subject_resources"("uploaded_by_id", "created_at");
CREATE UNIQUE INDEX "subject_resource_views_resource_id_user_id_key" ON "subject_resource_views"("resource_id", "user_id");
CREATE INDEX "subject_resource_views_user_id_last_viewed_at_idx" ON "subject_resource_views"("user_id", "last_viewed_at");
CREATE UNIQUE INDEX "model_question_papers_storage_key_key" ON "model_question_papers"("storage_key");
CREATE UNIQUE INDEX "model_question_papers_answer_key_storage_key_key" ON "model_question_papers"("answer_key_storage_key");
CREATE INDEX "model_question_papers_subject_id_status_publish_at_idx" ON "model_question_papers"("subject_id", "status", "publish_at");
CREATE INDEX "model_question_papers_uploaded_by_id_created_at_idx" ON "model_question_papers"("uploaded_by_id", "created_at");
