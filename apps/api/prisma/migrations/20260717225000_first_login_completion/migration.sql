ALTER TABLE "users"
ADD COLUMN IF NOT EXISTS "first_login_completed_at" TIMESTAMPTZ(3);

INSERT INTO "permissions" ("code", "resource", "action", "description")
VALUES ('users.reset_password', 'users', 'reset_password', 'Reset user passwords and issue one-time temporary credentials.')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT "roles"."id", "permissions"."id"
FROM "roles"
JOIN "permissions" ON "permissions"."code" = 'users.reset_password'
WHERE "roles"."code" IN ('SUPER_ADMIN', 'MAIN_ADMIN')
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
