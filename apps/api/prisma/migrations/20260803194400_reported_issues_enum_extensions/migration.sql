-- Enum additions must commit before later migrations reference the new values.
-- Keeping these changes separate is required by PostgreSQL's enum safety rules.

ALTER TYPE "ScopeType" ADD VALUE IF NOT EXISTS 'AREA';
ALTER TYPE "AttendanceCode" ADD VALUE IF NOT EXISTS 'HALF_DAY_PRESENT';
ALTER TYPE "AttendanceCode" ADD VALUE IF NOT EXISTS 'HALF_DAY_ABSENT';
ALTER TYPE "IssueStatus" ADD VALUE IF NOT EXISTS 'WAITING_FOR_PARTS';
ALTER TYPE "IssueStatus" ADD VALUE IF NOT EXISTS 'WAITING_FOR_APPROVAL';
ALTER TYPE "IssueStatus" ADD VALUE IF NOT EXISTS 'OVERDUE';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BroadcastAudienceType') THEN
    ALTER TYPE "BroadcastAudienceType" ADD VALUE IF NOT EXISTS 'PROGRAMME';
    ALTER TYPE "BroadcastAudienceType" ADD VALUE IF NOT EXISTS 'ACADEMIC_YEAR';
    ALTER TYPE "BroadcastAudienceType" ADD VALUE IF NOT EXISTS 'SEMESTER';
  END IF;
END $$;
