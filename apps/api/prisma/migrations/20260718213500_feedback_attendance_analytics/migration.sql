-- CreateEnum
CREATE TYPE "FeedbackTargetType" AS ENUM ('STAFF', 'HOD', 'PRINCIPAL', 'VICE_PRINCIPAL', 'DEPARTMENT', 'BUILDING', 'BLOCK', 'FLOOR', 'CLASSROOM', 'LABORATORY', 'LIBRARY', 'CANTEEN', 'TRANSPORT', 'MAINTENANCE', 'SECURITY', 'OFFICE', 'PLACEMENT', 'TRAINING', 'HOSTEL', 'SPORTS', 'MEDICAL', 'DRINKING_WATER', 'RESTROOM', 'CAMPUS_SERVICE', 'OTHER_SERVICE');

-- CreateEnum
CREATE TYPE "FeedbackQrStatus" AS ENUM ('ACTIVE', 'DISABLED', 'EXPIRED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "FeedbackCycleStatus" AS ENUM ('DRAFT', 'ACTIVE', 'CLOSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "FeedbackSubmissionRule" AS ENUM ('ONCE_PER_DAY', 'ONCE_PER_WEEK', 'ONCE_PER_CYCLE', 'UNLIMITED');

-- CreateEnum
CREATE TYPE "FeedbackQuestionType" AS ENUM ('RATING', 'TEXT', 'BOOLEAN');

-- CreateEnum
CREATE TYPE "FeedbackSubmissionStatus" AS ENUM ('NEW', 'VIEWED', 'UNDER_REVIEW', 'ASSIGNED', 'ACTION_REQUIRED', 'RESOLVED', 'REJECTED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "FeedbackPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "FeedbackSentiment" AS ENUM ('POSITIVE', 'NEUTRAL', 'NEGATIVE');

-- CreateTable
CREATE TABLE "feedback_targets" (
    "id" UUID NOT NULL,
    "target_uuid" UUID NOT NULL,
    "college_id" UUID NOT NULL,
    "target_type" "FeedbackTargetType" NOT NULL,
    "staff_user_id" UUID,
    "department_id" UUID,
    "campus_id" UUID,
    "block_id" UUID,
    "floor_id" UUID,
    "room_id" UUID,
    "service_code" VARCHAR(80),
    "target_name" VARCHAR(180) NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "feedback_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feedback_qr_codes" (
    "id" UUID NOT NULL,
    "qr_uuid" UUID NOT NULL,
    "target_id" UUID NOT NULL,
    "secure_token_hash" VARCHAR(64) NOT NULL,
    "qr_url" TEXT NOT NULL,
    "status" "FeedbackQrStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiry_date" TIMESTAMPTZ(3),
    "scan_count" INTEGER NOT NULL DEFAULT 0,
    "feedback_count" INTEGER NOT NULL DEFAULT 0,
    "last_scanned_at" TIMESTAMPTZ(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "feedback_qr_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feedback_cycles" (
    "id" UUID NOT NULL,
    "college_id" UUID NOT NULL,
    "cycle_name" VARCHAR(160) NOT NULL,
    "academic_year_id" UUID,
    "semester_id" UUID,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "submission_rule" "FeedbackSubmissionRule" NOT NULL DEFAULT 'ONCE_PER_DAY',
    "anonymous_mode" BOOLEAN NOT NULL DEFAULT true,
    "comments_required" BOOLEAN NOT NULL DEFAULT false,
    "staff_can_view_comments" BOOLEAN NOT NULL DEFAULT false,
    "student_identity_visible_to_management" BOOLEAN NOT NULL DEFAULT false,
    "negative_feedback_requires_investigation" BOOLEAN NOT NULL DEFAULT true,
    "status" "FeedbackCycleStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "feedback_cycles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feedback_questions" (
    "id" UUID NOT NULL,
    "college_id" UUID NOT NULL,
    "target_type" "FeedbackTargetType" NOT NULL,
    "category" VARCHAR(120) NOT NULL,
    "question_text" VARCHAR(300) NOT NULL,
    "question_type" "FeedbackQuestionType" NOT NULL DEFAULT 'RATING',
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "is_required" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "feedback_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feedback_submissions" (
    "id" UUID NOT NULL,
    "reference_number" VARCHAR(40) NOT NULL,
    "college_id" UUID NOT NULL,
    "student_user_id" UUID NOT NULL,
    "target_id" UUID NOT NULL,
    "feedback_cycle_id" UUID,
    "overall_rating" INTEGER NOT NULL,
    "positive_comment" TEXT,
    "improvement_comment" TEXT,
    "general_comment" TEXT,
    "complaint_text" TEXT,
    "is_anonymous" BOOLEAN NOT NULL DEFAULT true,
    "sentiment" "FeedbackSentiment" NOT NULL DEFAULT 'NEUTRAL',
    "status" "FeedbackSubmissionStatus" NOT NULL DEFAULT 'NEW',
    "priority" "FeedbackPriority" NOT NULL DEFAULT 'LOW',
    "submitted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "device_info" JSONB,
    "ip_hash" VARCHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "feedback_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feedback_ratings" (
    "id" UUID NOT NULL,
    "submission_id" UUID NOT NULL,
    "question_id" UUID NOT NULL,
    "rating" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "feedback_ratings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feedback_actions" (
    "id" UUID NOT NULL,
    "submission_id" UUID NOT NULL,
    "assigned_to_user_id" UUID,
    "assigned_department_id" UUID,
    "action_note" TEXT,
    "internal_note" TEXT,
    "status" "FeedbackSubmissionStatus" NOT NULL DEFAULT 'UNDER_REVIEW',
    "priority" "FeedbackPriority" NOT NULL DEFAULT 'MEDIUM',
    "due_date" DATE,
    "resolved_at" TIMESTAMPTZ(3),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "feedback_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feedback_notifications" (
    "id" UUID NOT NULL,
    "submission_id" UUID NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "recipient" VARCHAR(254) NOT NULL,
    "notification_type" VARCHAR(80) NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "provider_reference" VARCHAR(200),
    "sent_at" TIMESTAMPTZ(3),
    "error_message" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feedback_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feedback_scan_logs" (
    "id" UUID NOT NULL,
    "qr_code_id" UUID NOT NULL,
    "student_user_id" UUID,
    "scanned_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "device_type" VARCHAR(80),
    "browser" VARCHAR(160),
    "success_status" BOOLEAN NOT NULL,
    "failure_reason" VARCHAR(300),
    "ip_hash" VARCHAR(64),

    CONSTRAINT "feedback_scan_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "feedback_targets_target_uuid_key" ON "feedback_targets"("target_uuid");
CREATE INDEX "feedback_targets_college_id_target_type_is_active_idx" ON "feedback_targets"("college_id", "target_type", "is_active");
CREATE INDEX "feedback_targets_staff_user_id_idx" ON "feedback_targets"("staff_user_id");
CREATE INDEX "feedback_targets_department_id_idx" ON "feedback_targets"("department_id");
CREATE INDEX "feedback_targets_campus_id_idx" ON "feedback_targets"("campus_id");
CREATE INDEX "feedback_targets_block_id_idx" ON "feedback_targets"("block_id");
CREATE INDEX "feedback_targets_floor_id_idx" ON "feedback_targets"("floor_id");
CREATE INDEX "feedback_targets_room_id_idx" ON "feedback_targets"("room_id");

-- CreateIndex
CREATE UNIQUE INDEX "feedback_qr_codes_qr_uuid_key" ON "feedback_qr_codes"("qr_uuid");
CREATE UNIQUE INDEX "feedback_qr_codes_secure_token_hash_key" ON "feedback_qr_codes"("secure_token_hash");
CREATE INDEX "feedback_qr_codes_target_id_status_idx" ON "feedback_qr_codes"("target_id", "status");
CREATE INDEX "feedback_qr_codes_status_expiry_date_idx" ON "feedback_qr_codes"("status", "expiry_date");

-- CreateIndex
CREATE INDEX "feedback_cycles_college_id_status_start_date_end_date_idx" ON "feedback_cycles"("college_id", "status", "start_date", "end_date");
CREATE INDEX "feedback_cycles_academic_year_id_idx" ON "feedback_cycles"("academic_year_id");
CREATE INDEX "feedback_cycles_semester_id_idx" ON "feedback_cycles"("semester_id");

-- CreateIndex
CREATE INDEX "feedback_questions_college_id_target_type_is_active_display_order_idx" ON "feedback_questions"("college_id", "target_type", "is_active", "display_order");

-- CreateIndex
CREATE UNIQUE INDEX "feedback_submissions_reference_number_key" ON "feedback_submissions"("reference_number");
CREATE INDEX "feedback_submissions_college_id_submitted_at_idx" ON "feedback_submissions"("college_id", "submitted_at");
CREATE INDEX "feedback_submissions_student_user_id_target_id_submitted_at_idx" ON "feedback_submissions"("student_user_id", "target_id", "submitted_at");
CREATE INDEX "feedback_submissions_target_id_submitted_at_idx" ON "feedback_submissions"("target_id", "submitted_at");
CREATE INDEX "feedback_submissions_feedback_cycle_id_idx" ON "feedback_submissions"("feedback_cycle_id");
CREATE INDEX "feedback_submissions_overall_rating_idx" ON "feedback_submissions"("overall_rating");
CREATE INDEX "feedback_submissions_status_priority_idx" ON "feedback_submissions"("status", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "feedback_ratings_submission_id_question_id_key" ON "feedback_ratings"("submission_id", "question_id");
CREATE INDEX "feedback_ratings_question_id_rating_idx" ON "feedback_ratings"("question_id", "rating");

-- CreateIndex
CREATE INDEX "feedback_actions_submission_id_created_at_idx" ON "feedback_actions"("submission_id", "created_at");
CREATE INDEX "feedback_actions_assigned_to_user_id_status_idx" ON "feedback_actions"("assigned_to_user_id", "status");
CREATE INDEX "feedback_actions_assigned_department_id_status_idx" ON "feedback_actions"("assigned_department_id", "status");
CREATE INDEX "feedback_actions_status_priority_due_date_idx" ON "feedback_actions"("status", "priority", "due_date");

-- CreateIndex
CREATE INDEX "feedback_notifications_submission_id_idx" ON "feedback_notifications"("submission_id");
CREATE INDEX "feedback_notifications_channel_status_created_at_idx" ON "feedback_notifications"("channel", "status", "created_at");

-- CreateIndex
CREATE INDEX "feedback_scan_logs_qr_code_id_scanned_at_idx" ON "feedback_scan_logs"("qr_code_id", "scanned_at");
CREATE INDEX "feedback_scan_logs_student_user_id_scanned_at_idx" ON "feedback_scan_logs"("student_user_id", "scanned_at");

-- AddForeignKey
ALTER TABLE "feedback_targets" ADD CONSTRAINT "feedback_targets_college_id_fkey" FOREIGN KEY ("college_id") REFERENCES "colleges"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "feedback_targets" ADD CONSTRAINT "feedback_targets_staff_user_id_fkey" FOREIGN KEY ("staff_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "feedback_targets" ADD CONSTRAINT "feedback_targets_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "feedback_targets" ADD CONSTRAINT "feedback_targets_campus_id_fkey" FOREIGN KEY ("campus_id") REFERENCES "campuses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "feedback_targets" ADD CONSTRAINT "feedback_targets_block_id_fkey" FOREIGN KEY ("block_id") REFERENCES "blocks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "feedback_targets" ADD CONSTRAINT "feedback_targets_floor_id_fkey" FOREIGN KEY ("floor_id") REFERENCES "floors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "feedback_targets" ADD CONSTRAINT "feedback_targets_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "feedback_targets" ADD CONSTRAINT "feedback_targets_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback_qr_codes" ADD CONSTRAINT "feedback_qr_codes_target_id_fkey" FOREIGN KEY ("target_id") REFERENCES "feedback_targets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "feedback_qr_codes" ADD CONSTRAINT "feedback_qr_codes_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback_cycles" ADD CONSTRAINT "feedback_cycles_college_id_fkey" FOREIGN KEY ("college_id") REFERENCES "colleges"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "feedback_cycles" ADD CONSTRAINT "feedback_cycles_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "feedback_cycles" ADD CONSTRAINT "feedback_cycles_semester_id_fkey" FOREIGN KEY ("semester_id") REFERENCES "semesters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "feedback_cycles" ADD CONSTRAINT "feedback_cycles_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback_questions" ADD CONSTRAINT "feedback_questions_college_id_fkey" FOREIGN KEY ("college_id") REFERENCES "colleges"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback_submissions" ADD CONSTRAINT "feedback_submissions_college_id_fkey" FOREIGN KEY ("college_id") REFERENCES "colleges"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "feedback_submissions" ADD CONSTRAINT "feedback_submissions_student_user_id_fkey" FOREIGN KEY ("student_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "feedback_submissions" ADD CONSTRAINT "feedback_submissions_target_id_fkey" FOREIGN KEY ("target_id") REFERENCES "feedback_targets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "feedback_submissions" ADD CONSTRAINT "feedback_submissions_feedback_cycle_id_fkey" FOREIGN KEY ("feedback_cycle_id") REFERENCES "feedback_cycles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback_ratings" ADD CONSTRAINT "feedback_ratings_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "feedback_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "feedback_ratings" ADD CONSTRAINT "feedback_ratings_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "feedback_questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback_actions" ADD CONSTRAINT "feedback_actions_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "feedback_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "feedback_actions" ADD CONSTRAINT "feedback_actions_assigned_to_user_id_fkey" FOREIGN KEY ("assigned_to_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "feedback_actions" ADD CONSTRAINT "feedback_actions_assigned_department_id_fkey" FOREIGN KEY ("assigned_department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "feedback_actions" ADD CONSTRAINT "feedback_actions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback_notifications" ADD CONSTRAINT "feedback_notifications_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "feedback_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback_scan_logs" ADD CONSTRAINT "feedback_scan_logs_qr_code_id_fkey" FOREIGN KEY ("qr_code_id") REFERENCES "feedback_qr_codes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "feedback_scan_logs" ADD CONSTRAINT "feedback_scan_logs_student_user_id_fkey" FOREIGN KEY ("student_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
