-- Prisma's UUID defaults are client-side. Raw SQL seed migrations need a
-- database default so they can insert permission rows safely on a clean install.
ALTER TABLE "permissions"
ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
