-- Make operational records tenant-addressable so actorless/system records never
-- become visible across colleges.
ALTER TABLE "audit_logs" ADD COLUMN "college_id" UUID;
ALTER TABLE "background_job_failures" ADD COLUMN "college_id" UUID;
ALTER TABLE "message_attachments" ADD COLUMN "sha256" VARCHAR(64);
ALTER TABLE "message_attachments" ADD COLUMN "deleted_at" TIMESTAMPTZ(3);
ALTER TABLE "reported_messages" ADD COLUMN "reviewed_by_id" UUID;
ALTER TABLE "reported_messages" ADD COLUMN "review_note" VARCHAR(1000);
ALTER TABLE "reported_messages" ADD COLUMN "reviewed_at" TIMESTAMPTZ(3);

UPDATE "audit_logs" AS audit
SET "college_id" = users."college_id"
FROM "users"
WHERE audit."actor_id" = users."id" AND audit."college_id" IS NULL;

UPDATE "background_job_failures" AS failure
SET "college_id" = jobs."college_id"
FROM "import_jobs" AS jobs
WHERE failure."queue_name" = 'data-imports'
  AND failure."payload_redacted"->>'importJobId' = jobs."id"::text
  AND failure."college_id" IS NULL;

ALTER TABLE "audit_logs"
  ADD CONSTRAINT "audit_logs_college_id_fkey" FOREIGN KEY ("college_id") REFERENCES "colleges"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "background_job_failures"
  ADD CONSTRAINT "background_job_failures_college_id_fkey" FOREIGN KEY ("college_id") REFERENCES "colleges"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "issue_attachments"
  ADD CONSTRAINT "issue_attachments_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reported_messages"
  ADD CONSTRAINT "reported_messages_reported_by_id_fkey" FOREIGN KEY ("reported_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reported_messages"
  ADD CONSTRAINT "reported_messages_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The append-only trigger makes SET NULL on user deletion impossible. Retain
-- the actor reference explicitly instead of leaving a contradictory FK action.
ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_actor_id_fkey";
ALTER TABLE "audit_logs"
  ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "audit_logs_college_id_created_at_idx" ON "audit_logs"("college_id", "created_at");
CREATE INDEX "background_job_failures_college_id_resolved_at_failed_at_idx" ON "background_job_failures"("college_id", "resolved_at", "failed_at");

-- Audit rows are append-only even if application code is compromised into using
-- an update/delete ORM operation.
CREATE OR REPLACE FUNCTION prevent_audit_log_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_prevent_update
BEFORE UPDATE ON "audit_logs"
FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation();

CREATE TRIGGER audit_logs_prevent_delete
BEFORE DELETE ON "audit_logs"
FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation();
