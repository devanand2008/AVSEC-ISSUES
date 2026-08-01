-- AVS Bot: secure, read-only, role-aware AI assistant persistence.

CREATE TYPE "AiConversationStatus" AS ENUM ('ACTIVE', 'ARCHIVED');
CREATE TYPE "AiMessageRole" AS ENUM ('USER', 'ASSISTANT', 'SYSTEM', 'TOOL');
CREATE TYPE "AiMessageStatus" AS ENUM ('QUEUED', 'STREAMING', 'COMPLETED', 'FAILED', 'CANCELLED', 'BLOCKED');
CREATE TYPE "AiToolStatus" AS ENUM ('STARTED', 'COMPLETED', 'FAILED', 'BLOCKED');
CREATE TYPE "AiFeedbackRating" AS ENUM ('HELPFUL', 'NOT_HELPFUL', 'REPORTED');
CREATE TYPE "AiKnowledgeStatus" AS ENUM ('PROCESSING', 'PUBLISHED', 'FAILED', 'ARCHIVED');
CREATE TYPE "AiKnowledgeSource" AS ENUM ('UPLOAD', 'MANUAL', 'OPENAI_FILE_SEARCH');
CREATE TYPE "AiLanguage" AS ENUM ('AUTO', 'ENGLISH', 'TAMIL');
CREATE TYPE "AiResponseLength" AS ENUM ('SHORT', 'BALANCED', 'DETAILED');
CREATE TYPE "AiSafetySeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

CREATE TABLE "ai_conversations" (
  "id" UUID NOT NULL,
  "college_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "title" VARCHAR(160) NOT NULL DEFAULT 'New conversation',
  "status" "AiConversationStatus" NOT NULL DEFAULT 'ACTIVE',
  "last_message_at" TIMESTAMPTZ(3),
  "archived_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ai_conversations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_messages" (
  "id" UUID NOT NULL,
  "conversation_id" UUID NOT NULL,
  "role" "AiMessageRole" NOT NULL,
  "content" TEXT NOT NULL,
  "status" "AiMessageStatus" NOT NULL DEFAULT 'QUEUED',
  "client_request_id" VARCHAR(80),
  "model" VARCHAR(100),
  "provider_response_id" VARCHAR(160),
  "input_tokens" INTEGER,
  "output_tokens" INTEGER,
  "latency_ms" INTEGER,
  "error_code" VARCHAR(80),
  "suggested_actions" JSONB,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ai_messages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_message_sources" (
  "id" UUID NOT NULL,
  "message_id" UUID NOT NULL,
  "knowledge_document_id" UUID,
  "title" VARCHAR(240) NOT NULL,
  "category" VARCHAR(100),
  "version" VARCHAR(60),
  "published_at" TIMESTAMPTZ(3),
  "open_route" VARCHAR(240),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_message_sources_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_tool_executions" (
  "id" UUID NOT NULL,
  "message_id" UUID,
  "user_id" UUID NOT NULL,
  "tool_name" VARCHAR(100) NOT NULL,
  "status" "AiToolStatus" NOT NULL DEFAULT 'STARTED',
  "parameters" JSONB,
  "result" JSONB,
  "latency_ms" INTEGER,
  "error_code" VARCHAR(80),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_tool_executions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_usage_records" (
  "id" UUID NOT NULL,
  "college_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "department_id" UUID,
  "message_id" UUID,
  "usage_date" DATE NOT NULL,
  "requests" INTEGER NOT NULL DEFAULT 1,
  "input_tokens" INTEGER NOT NULL DEFAULT 0,
  "output_tokens" INTEGER NOT NULL DEFAULT 0,
  "estimated_cost" DECIMAL(12,6) NOT NULL DEFAULT 0,
  "failures" INTEGER NOT NULL DEFAULT 0,
  "latency_ms" INTEGER,
  "model" VARCHAR(100),
  "role" VARCHAR(80),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_usage_records_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_feedback" (
  "id" UUID NOT NULL,
  "message_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "rating" "AiFeedbackRating" NOT NULL,
  "comment" VARCHAR(1000),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ai_feedback_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_knowledge_documents" (
  "id" UUID NOT NULL,
  "college_id" UUID NOT NULL,
  "title" VARCHAR(240) NOT NULL,
  "description" VARCHAR(1000),
  "category" VARCHAR(100) NOT NULL,
  "department_id" UUID,
  "programme_id" UUID,
  "semester_id" UUID,
  "role_visibility" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "academic_year" VARCHAR(40),
  "source" "AiKnowledgeSource" NOT NULL DEFAULT 'UPLOAD',
  "version" VARCHAR(60) NOT NULL DEFAULT '1',
  "status" "AiKnowledgeStatus" NOT NULL DEFAULT 'PROCESSING',
  "storage_key" TEXT,
  "provider_file_id" VARCHAR(160),
  "mime_type" VARCHAR(160),
  "size_bytes" BIGINT,
  "sha256" VARCHAR(64),
  "uploaded_by_id" UUID NOT NULL,
  "published_at" TIMESTAMPTZ(3),
  "archived_at" TIMESTAMPTZ(3),
  "failure_category" VARCHAR(100),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ai_knowledge_documents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_knowledge_chunks" (
  "id" UUID NOT NULL,
  "document_id" UUID NOT NULL,
  "content" TEXT NOT NULL,
  "token_count" INTEGER NOT NULL,
  "chunk_index" INTEGER NOT NULL,
  "metadata" JSONB,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_knowledge_chunks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_prompt_versions" (
  "id" UUID NOT NULL,
  "college_id" UUID,
  "version" VARCHAR(60) NOT NULL,
  "content" TEXT NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT false,
  "created_by_id" UUID,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_prompt_versions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_bot_settings" (
  "id" UUID NOT NULL,
  "college_id" UUID NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "model" VARCHAR(100),
  "max_output_tokens" INTEGER NOT NULL DEFAULT 1200,
  "daily_role_limits" JSONB,
  "monthly_budget" DECIMAL(12,2),
  "knowledge_provider" VARCHAR(40) NOT NULL DEFAULT 'internal',
  "allowed_document_types" TEXT[] NOT NULL DEFAULT ARRAY['pdf','docx','txt','md','html']::TEXT[],
  "retention_days" INTEGER NOT NULL DEFAULT 365,
  "safety_contact_name" VARCHAR(160),
  "safety_contact_route" VARCHAR(240),
  "tool_permissions" JSONB,
  "last_success_at" TIMESTAMPTZ(3),
  "last_error_category" VARCHAR(100),
  "updated_by_id" UUID,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ai_bot_settings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_user_settings" (
  "user_id" UUID NOT NULL,
  "language" "AiLanguage" NOT NULL DEFAULT 'AUTO',
  "response_length" "AiResponseLength" NOT NULL DEFAULT 'BALANCED',
  "show_sources" BOOLEAN NOT NULL DEFAULT true,
  "save_history" BOOLEAN NOT NULL DEFAULT true,
  "keep_local_cache" BOOLEAN NOT NULL DEFAULT true,
  "auto_title" BOOLEAN NOT NULL DEFAULT true,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ai_user_settings_pkey" PRIMARY KEY ("user_id")
);

CREATE TABLE "ai_safety_events" (
  "id" UUID NOT NULL,
  "college_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "message_id" UUID,
  "category" VARCHAR(100) NOT NULL,
  "severity" "AiSafetySeverity" NOT NULL,
  "request_id" VARCHAR(120),
  "metadata" JSONB,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_safety_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ai_conversations_user_id_status_updated_at_idx" ON "ai_conversations"("user_id", "status", "updated_at");
CREATE INDEX "ai_conversations_college_id_updated_at_idx" ON "ai_conversations"("college_id", "updated_at");
CREATE UNIQUE INDEX "ai_messages_conversation_id_client_request_id_key" ON "ai_messages"("conversation_id", "client_request_id");
CREATE INDEX "ai_messages_conversation_id_created_at_idx" ON "ai_messages"("conversation_id", "created_at");
CREATE INDEX "ai_message_sources_message_id_idx" ON "ai_message_sources"("message_id");
CREATE INDEX "ai_tool_executions_user_id_created_at_idx" ON "ai_tool_executions"("user_id", "created_at");
CREATE INDEX "ai_tool_executions_message_id_idx" ON "ai_tool_executions"("message_id");
CREATE UNIQUE INDEX "ai_usage_records_message_id_key" ON "ai_usage_records"("message_id");
CREATE INDEX "ai_usage_records_user_id_usage_date_idx" ON "ai_usage_records"("user_id", "usage_date");
CREATE INDEX "ai_usage_records_department_id_usage_date_idx" ON "ai_usage_records"("department_id", "usage_date");
CREATE INDEX "ai_usage_records_college_id_usage_date_idx" ON "ai_usage_records"("college_id", "usage_date");
CREATE UNIQUE INDEX "ai_feedback_message_id_user_id_key" ON "ai_feedback"("message_id", "user_id");
CREATE INDEX "ai_feedback_rating_created_at_idx" ON "ai_feedback"("rating", "created_at");
CREATE INDEX "ai_knowledge_documents_college_id_status_category_idx" ON "ai_knowledge_documents"("college_id", "status", "category");
CREATE INDEX "ai_knowledge_documents_department_id_programme_id_semester_id_idx" ON "ai_knowledge_documents"("department_id", "programme_id", "semester_id");
CREATE UNIQUE INDEX "ai_knowledge_chunks_document_id_chunk_index_key" ON "ai_knowledge_chunks"("document_id", "chunk_index");
CREATE INDEX "ai_knowledge_chunks_document_id_idx" ON "ai_knowledge_chunks"("document_id");
CREATE UNIQUE INDEX "ai_prompt_versions_version_key" ON "ai_prompt_versions"("version");
CREATE INDEX "ai_prompt_versions_college_id_is_active_idx" ON "ai_prompt_versions"("college_id", "is_active");
CREATE UNIQUE INDEX "ai_bot_settings_college_id_key" ON "ai_bot_settings"("college_id");
CREATE INDEX "ai_safety_events_college_id_created_at_idx" ON "ai_safety_events"("college_id", "created_at");
CREATE INDEX "ai_safety_events_user_id_category_created_at_idx" ON "ai_safety_events"("user_id", "category", "created_at");

ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_college_id_fkey" FOREIGN KEY ("college_id") REFERENCES "colleges"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "ai_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_message_sources" ADD CONSTRAINT "ai_message_sources_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "ai_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_message_sources" ADD CONSTRAINT "ai_message_sources_knowledge_document_id_fkey" FOREIGN KEY ("knowledge_document_id") REFERENCES "ai_knowledge_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ai_tool_executions" ADD CONSTRAINT "ai_tool_executions_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "ai_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_tool_executions" ADD CONSTRAINT "ai_tool_executions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_usage_records" ADD CONSTRAINT "ai_usage_records_college_id_fkey" FOREIGN KEY ("college_id") REFERENCES "colleges"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_usage_records" ADD CONSTRAINT "ai_usage_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_usage_records" ADD CONSTRAINT "ai_usage_records_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ai_usage_records" ADD CONSTRAINT "ai_usage_records_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "ai_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ai_feedback" ADD CONSTRAINT "ai_feedback_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "ai_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_feedback" ADD CONSTRAINT "ai_feedback_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_knowledge_documents" ADD CONSTRAINT "ai_knowledge_documents_college_id_fkey" FOREIGN KEY ("college_id") REFERENCES "colleges"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_knowledge_documents" ADD CONSTRAINT "ai_knowledge_documents_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ai_knowledge_documents" ADD CONSTRAINT "ai_knowledge_documents_programme_id_fkey" FOREIGN KEY ("programme_id") REFERENCES "programmes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ai_knowledge_documents" ADD CONSTRAINT "ai_knowledge_documents_semester_id_fkey" FOREIGN KEY ("semester_id") REFERENCES "semesters"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ai_knowledge_documents" ADD CONSTRAINT "ai_knowledge_documents_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_knowledge_chunks" ADD CONSTRAINT "ai_knowledge_chunks_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "ai_knowledge_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_prompt_versions" ADD CONSTRAINT "ai_prompt_versions_college_id_fkey" FOREIGN KEY ("college_id") REFERENCES "colleges"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_prompt_versions" ADD CONSTRAINT "ai_prompt_versions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ai_bot_settings" ADD CONSTRAINT "ai_bot_settings_college_id_fkey" FOREIGN KEY ("college_id") REFERENCES "colleges"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_bot_settings" ADD CONSTRAINT "ai_bot_settings_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ai_user_settings" ADD CONSTRAINT "ai_user_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_safety_events" ADD CONSTRAINT "ai_safety_events_college_id_fkey" FOREIGN KEY ("college_id") REFERENCES "colleges"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_safety_events" ADD CONSTRAINT "ai_safety_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_safety_events" ADD CONSTRAINT "ai_safety_events_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "ai_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "permissions" ("id", "code", "resource", "action", "description")
VALUES
  (md5('avs-ai-use')::uuid, 'ai.use', 'ai', 'use', 'Use the read-only AVS Bot assistant.'),
  (md5('avs-ai-admin')::uuid, 'ai.admin', 'ai', 'admin', 'Manage AVS Bot configuration and run connection checks.'),
  (md5('avs-ai-knowledge')::uuid, 'ai.knowledge.manage', 'ai_knowledge', 'manage', 'Upload, publish, and archive AVS Bot knowledge.'),
  (md5('avs-ai-usage')::uuid, 'ai.usage.read', 'ai_usage', 'read', 'View AVS Bot usage and safety summaries.')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT "roles"."id", "permissions"."id"
FROM "roles"
JOIN "permissions" ON "permissions"."code" = 'ai.use'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT "roles"."id", "permissions"."id"
FROM "roles"
JOIN "permissions" ON "permissions"."code" IN ('ai.admin', 'ai.knowledge.manage', 'ai.usage.read')
WHERE "roles"."code" IN ('SUPER_ADMIN', 'MAIN_ADMIN')
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
