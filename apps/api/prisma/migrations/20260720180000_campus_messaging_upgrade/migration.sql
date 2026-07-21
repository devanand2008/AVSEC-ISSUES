CREATE TYPE "MessageType" AS ENUM ('TEXT', 'IMAGE', 'DOCUMENT', 'VIDEO', 'AUDIO', 'SYSTEM');

ALTER TYPE "ConversationType" ADD VALUE 'HOD_GROUP';
ALTER TYPE "ConversationType" ADD VALUE 'CLASS_COORDINATOR_GROUP';
ALTER TYPE "ConversationType" ADD VALUE 'CLASS_REPRESENTATIVE_GROUP';
ALTER TYPE "ConversationType" ADD VALUE 'LEADERSHIP_GROUP';
ALTER TYPE "ConversationType" ADD VALUE 'BLOCK_MAINTENANCE_GROUP';
ALTER TYPE "ConversationType" ADD VALUE 'CUSTOM_GROUP';

ALTER TYPE "DeliveryStatus" ADD VALUE 'RETRYING';
ALTER TYPE "DeliveryStatus" ADD VALUE 'DELETED';

ALTER TABLE "departments"
  ADD COLUMN "short_name" VARCHAR(60),
  ADD COLUMN "description" TEXT,
  ADD COLUMN "hod_id" UUID,
  ADD COLUMN "official_email" VARCHAR(254),
  ADD COLUMN "contact_number" VARCHAR(30),
  ADD COLUMN "location" VARCHAR(180),
  ADD COLUMN "archived_at" TIMESTAMPTZ(3),
  ADD COLUMN "created_by_id" UUID,
  ADD COLUMN "updated_by_id" UUID;

CREATE UNIQUE INDEX "departments_college_id_name_key" ON "departments"("college_id", "name");
CREATE INDEX "departments_college_id_archived_at_idx" ON "departments"("college_id", "archived_at");
CREATE INDEX "departments_hod_id_idx" ON "departments"("hod_id");

ALTER TABLE "programmes" ADD COLUMN "degree_type" VARCHAR(80);

ALTER TABLE "sections"
  ADD COLUMN "study_year" INTEGER,
  ADD COLUMN "display_name" VARCHAR(180),
  ADD COLUMN "assigned_room_id" UUID,
  ADD COLUMN "official_group_enabled" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "user_roles" ADD COLUMN "is_primary" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "staff_profiles"
  ADD COLUMN "specialization" VARCHAR(180),
  ADD COLUMN "shift" VARCHAR(80),
  ADD COLUMN "emergency_contact" VARCHAR(30);

CREATE TABLE "user_presence" (
  "user_id" UUID NOT NULL,
  "is_online" BOOLEAN NOT NULL DEFAULT false,
  "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "user_presence_pkey" PRIMARY KEY ("user_id")
);
CREATE INDEX "user_presence_is_online_last_seen_at_idx" ON "user_presence"("is_online", "last_seen_at");

CREATE TABLE "role_assignment_history" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "changed_by_id" UUID NOT NULL,
  "previous_roles" JSONB NOT NULL,
  "new_roles" JSONB NOT NULL,
  "previous_scopes" JSONB NOT NULL,
  "new_scopes" JSONB NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "role_assignment_history_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "role_assignment_history_user_id_changed_at_idx" ON "role_assignment_history"("user_id", "changed_at");
CREATE INDEX "role_assignment_history_changed_by_id_changed_at_idx" ON "role_assignment_history"("changed_by_id", "changed_at");

ALTER TABLE "conversations"
  ADD COLUMN "description" TEXT,
  ADD COLUMN "avatar_storage_key" TEXT,
  ADD COLUMN "official_group_type" VARCHAR(80),
  ADD COLUMN "linked_entity_id" UUID,
  ADD COLUMN "send_restricted" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "created_by_id" UUID,
  ADD COLUMN "archived_at" TIMESTAMPTZ(3);
CREATE INDEX "conversations_college_id_archived_at_updated_at_idx" ON "conversations"("college_id", "archived_at", "updated_at");
CREATE INDEX "conversations_official_group_type_linked_entity_id_idx" ON "conversations"("official_group_type", "linked_entity_id");

ALTER TABLE "conversation_participants"
  ADD COLUMN "archived_at" TIMESTAMPTZ(3),
  ADD COLUMN "marked_unread_at" TIMESTAMPTZ(3),
  ADD COLUMN "last_read_message_id" UUID;

ALTER TABLE "messages"
  ADD COLUMN "forwarded_from_id" UUID,
  ADD COLUMN "type" "MessageType" NOT NULL DEFAULT 'TEXT',
  ADD COLUMN "status" "DeliveryStatus" NOT NULL DEFAULT 'SENT',
  ADD COLUMN "client_id" VARCHAR(80),
  ADD COLUMN "pinned_at" TIMESTAMPTZ(3);
CREATE INDEX "messages_sender_id_created_at_idx" ON "messages"("sender_id", "created_at");
CREATE UNIQUE INDEX "messages_sender_id_client_id_key" ON "messages"("sender_id", "client_id");
ALTER TABLE "messages" ADD CONSTRAINT "messages_forwarded_from_id_fkey" FOREIGN KEY ("forwarded_from_id") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "message_attachments"
  ADD COLUMN "safe_name" VARCHAR(255),
  ADD COLUMN "thumbnail_key" TEXT,
  ADD COLUMN "width" INTEGER,
  ADD COLUMN "height" INTEGER,
  ADD COLUMN "uploaded_by_id" UUID,
  ADD COLUMN "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE "message_attachments" SET "safe_name" = "original_name" WHERE "safe_name" IS NULL;
UPDATE "message_attachments" AS attachment
SET "uploaded_by_id" = message."sender_id"
FROM "messages" AS message
WHERE attachment."message_id" = message."id" AND attachment."uploaded_by_id" IS NULL;
ALTER TABLE "message_attachments" ALTER COLUMN "safe_name" SET NOT NULL;
ALTER TABLE "message_attachments" ALTER COLUMN "uploaded_by_id" SET NOT NULL;

CREATE TABLE "message_deliveries" (
  "message_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "status" "DeliveryStatus" NOT NULL DEFAULT 'QUEUED',
  "last_error" VARCHAR(500),
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "message_deliveries_pkey" PRIMARY KEY ("message_id", "user_id")
);
CREATE INDEX "message_deliveries_user_id_status_created_at_idx" ON "message_deliveries"("user_id", "status", "created_at");
ALTER TABLE "message_deliveries" ADD CONSTRAINT "message_deliveries_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "message_edit_history" (
  "id" UUID NOT NULL,
  "message_id" UUID NOT NULL,
  "previous_body" TEXT NOT NULL,
  "edited_by_id" UUID NOT NULL,
  "edited_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "message_edit_history_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "message_edit_history_message_id_edited_at_idx" ON "message_edit_history"("message_id", "edited_at");
ALTER TABLE "message_edit_history" ADD CONSTRAINT "message_edit_history_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "message_deletions" (
  "message_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "deleted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "message_deletions_pkey" PRIMARY KEY ("message_id", "user_id")
);
CREATE INDEX "message_deletions_user_id_deleted_at_idx" ON "message_deletions"("user_id", "deleted_at");
ALTER TABLE "message_deletions" ADD CONSTRAINT "message_deletions_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "message_stars" (
  "message_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "message_stars_pkey" PRIMARY KEY ("message_id", "user_id")
);
CREATE INDEX "message_stars_user_id_created_at_idx" ON "message_stars"("user_id", "created_at");
ALTER TABLE "message_stars" ADD CONSTRAINT "message_stars_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
