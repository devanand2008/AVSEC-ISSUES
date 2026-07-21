ALTER TABLE "user_credentials"
  ALTER COLUMN "password_changed_at" DROP DEFAULT,
  ALTER COLUMN "password_changed_at" DROP NOT NULL;
