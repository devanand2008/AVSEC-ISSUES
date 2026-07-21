-- Preserve enough provenance to recover a partially completed import without
-- trusting an object-storage report, and close several concurrency/integrity
-- gaps that cannot be represented by Prisma's schema language.

ALTER TABLE "attendance_change_histories"
  ADD COLUMN "previous_note" VARCHAR(500),
  ADD COLUMN "new_note" VARCHAR(500);

ALTER TABLE "attendance_change_histories"
  ADD CONSTRAINT "attendance_change_histories_changed_by_id_fkey"
  FOREIGN KEY ("changed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "import_jobs"
  ADD CONSTRAINT "import_jobs_requested_by_id_fkey"
  FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "import_job_records" (
  "id" UUID NOT NULL,
  "import_job_id" UUID NOT NULL,
  "row_number" INTEGER NOT NULL,
  "model" VARCHAR(80) NOT NULL,
  "record_id" UUID NOT NULL,
  "label" VARCHAR(300) NOT NULL,
  "rolled_back_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "import_job_records_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "import_job_records_import_job_id_fkey"
    FOREIGN KEY ("import_job_id") REFERENCES "import_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "import_job_records_import_job_id_model_record_id_key"
  ON "import_job_records"("import_job_id", "model", "record_id");
CREATE INDEX "import_job_records_import_job_id_row_number_created_at_idx"
  ON "import_job_records"("import_job_id", "row_number", "created_at");

-- Fail explicitly when pre-existing data violates a newly enforced invariant.
-- Operators can then resolve the conflicting business record deliberately.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "class_representative_assignments"
    WHERE "is_active" = TRUE
    GROUP BY "section_id" HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'multiple active class representatives exist for a section';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "app_settings"
    WHERE "college_id" IS NULL
    GROUP BY "key" HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'duplicate global app setting keys exist';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "attendance_correction_requests"
    WHERE "status" = 'PENDING'
    GROUP BY "record_id" HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'multiple pending corrections exist for an attendance record';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "rooms" r
    JOIN "floors" f ON f."id" = r."floor_id"
    JOIN "blocks" b ON b."id" = f."block_id"
    GROUP BY b."campus_id", UPPER(r."code")
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'duplicate room codes exist within a campus';
  END IF;
END;
$$;

CREATE UNIQUE INDEX "class_representative_assignments_one_active_per_section_key"
  ON "class_representative_assignments"("section_id") WHERE "is_active" = TRUE;

CREATE UNIQUE INDEX "app_settings_global_key_key"
  ON "app_settings"("key") WHERE "college_id" IS NULL;

CREATE UNIQUE INDEX "attendance_correction_requests_one_pending_per_record_key"
  ON "attendance_correction_requests"("record_id") WHERE "status" = 'PENDING';

CREATE OR REPLACE FUNCTION enforce_room_code_unique_per_campus()
RETURNS trigger AS $$
DECLARE
  selected_campus_id UUID;
BEGIN
  SELECT b."campus_id" INTO selected_campus_id
  FROM "floors" f
  JOIN "blocks" b ON b."id" = f."block_id"
  WHERE f."id" = NEW."floor_id";

  IF selected_campus_id IS NULL THEN
    RAISE EXCEPTION 'room floor does not resolve to a campus';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "rooms" r
    JOIN "floors" f ON f."id" = r."floor_id"
    JOIN "blocks" b ON b."id" = f."block_id"
    WHERE b."campus_id" = selected_campus_id
      AND UPPER(r."code") = UPPER(NEW."code")
      AND r."id" <> NEW."id"
  ) THEN
    RAISE EXCEPTION 'room code % already exists in this campus', NEW."code"
      USING ERRCODE = 'unique_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER rooms_enforce_code_per_campus
BEFORE INSERT OR UPDATE OF "floor_id", "code" ON "rooms"
FOR EACH ROW EXECUTE FUNCTION enforce_room_code_unique_per_campus();

-- Operational histories are evidence. Prevent application-level update/delete
-- calls from rewriting them after the fact.
CREATE OR REPLACE FUNCTION prevent_immutable_history_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER attendance_change_histories_prevent_update
BEFORE UPDATE ON "attendance_change_histories"
FOR EACH ROW EXECUTE FUNCTION prevent_immutable_history_mutation();
CREATE TRIGGER attendance_change_histories_prevent_delete
BEFORE DELETE ON "attendance_change_histories"
FOR EACH ROW EXECUTE FUNCTION prevent_immutable_history_mutation();

CREATE TRIGGER issue_status_histories_prevent_update
BEFORE UPDATE ON "issue_status_histories"
FOR EACH ROW EXECUTE FUNCTION prevent_immutable_history_mutation();
CREATE TRIGGER issue_status_histories_prevent_delete
BEFORE DELETE ON "issue_status_histories"
FOR EACH ROW EXECUTE FUNCTION prevent_immutable_history_mutation();

CREATE TRIGGER issue_assignment_histories_prevent_update
BEFORE UPDATE ON "issue_assignment_histories"
FOR EACH ROW EXECUTE FUNCTION prevent_immutable_history_mutation();
CREATE TRIGGER issue_assignment_histories_prevent_delete
BEFORE DELETE ON "issue_assignment_histories"
FOR EACH ROW EXECUTE FUNCTION prevent_immutable_history_mutation();
