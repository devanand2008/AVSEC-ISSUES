ALTER TABLE "users"
ADD COLUMN "notification_preferences" JSONB NOT NULL
DEFAULT '{"in_app": true, "push": true, "email": true, "whatsapp": false}'::jsonb;
