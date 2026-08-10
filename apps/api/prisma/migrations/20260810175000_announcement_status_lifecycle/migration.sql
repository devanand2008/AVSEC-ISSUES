-- Align the production enum with the lifecycle states already used by the
-- announcement delivery service and generated Prisma client.
ALTER TYPE "AnnouncementStatus" ADD VALUE IF NOT EXISTS 'PUBLISHING' BEFORE 'PUBLISHED';
ALTER TYPE "AnnouncementStatus" ADD VALUE IF NOT EXISTS 'PARTIALLY_DELIVERED' AFTER 'PUBLISHED';
ALTER TYPE "AnnouncementStatus" ADD VALUE IF NOT EXISTS 'EXPIRED' BEFORE 'ARCHIVED';
ALTER TYPE "AnnouncementStatus" ADD VALUE IF NOT EXISTS 'UNPUBLISHED' BEFORE 'ARCHIVED';
ALTER TYPE "AnnouncementStatus" ADD VALUE IF NOT EXISTS 'FAILED' AFTER 'ARCHIVED';
