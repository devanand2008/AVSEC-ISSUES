BEGIN;

CREATE TYPE "AdmissionType" AS ENUM ('REGULAR', 'LATERAL_ENTRY', 'TRANSFER', 'READMISSION', 'OTHER');
CREATE TYPE "StudentAcademicStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'GRADUATED', 'ALUMNI', 'DISCONTINUED', 'TRANSFERRED');
CREATE TYPE "AcademicMembershipStatus" AS ENUM ('ACTIVE', 'MOVED', 'PROMOTED', 'COMPLETED', 'ARCHIVED');

CREATE TABLE "degree_types" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "college_id" UUID NOT NULL,
  "code" VARCHAR(30) NOT NULL,
  "name" VARCHAR(80) NOT NULL,
  "description" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "archived_at" TIMESTAMPTZ(3),
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "degree_types_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "degree_types_college_id_fkey" FOREIGN KEY ("college_id") REFERENCES "colleges"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "degree_types_college_id_code_key" ON "degree_types"("college_id", "code");
CREATE UNIQUE INDEX "degree_types_college_id_name_key" ON "degree_types"("college_id", "name");
CREATE UNIQUE INDEX "degree_types_college_normalized_code_uq" ON "degree_types"("college_id", lower(btrim("code")));
CREATE UNIQUE INDEX "degree_types_college_normalized_name_uq" ON "degree_types"("college_id", lower(btrim("name")));
CREATE INDEX "degree_types_college_id_is_active_sort_order_idx" ON "degree_types"("college_id", "is_active", "sort_order");
CREATE INDEX "degree_types_college_id_archived_at_idx" ON "degree_types"("college_id", "archived_at");

INSERT INTO "degree_types" ("college_id", "code", "name", "sort_order")
SELECT "id", 'BE', 'B.E.', 10 FROM "colleges"
UNION ALL
SELECT "id", 'BTECH', 'B.Tech.', 20 FROM "colleges";

ALTER TABLE "programmes"
  ADD COLUMN "degree_type_id" UUID,
  ADD COLUMN "total_semesters" INTEGER NOT NULL DEFAULT 8,
  ADD COLUMN "archived_at" TIMESTAMPTZ(3);

-- Preserve an already explicit, reviewed Programme mapping before applying any
-- AVS legacy fallback. This prevents AI/IT programmes configured as B.E. from
-- being silently changed to B.Tech during cutover.
UPDATE "programmes" AS programme
SET "degree_type_id" = degree_type."id",
    "degree_type" = degree_type."name",
    "total_semesters" = GREATEST(2, LEAST(8, programme."duration_years" * 2))
FROM "degree_types" AS degree_type
WHERE programme."college_id" = degree_type."college_id"
  AND programme."degree_type_id" IS NULL
  AND degree_type."code" = CASE
    WHEN regexp_replace(upper(coalesce(programme."degree_type", '')), '[^A-Z0-9]+', '', 'g') = 'BE' THEN 'BE'
    WHEN regexp_replace(upper(coalesce(programme."degree_type", '')), '[^A-Z0-9]+', '', 'g') = 'BTECH' THEN 'BTECH'
    ELSE NULL
  END;

-- The former system stored a combined value for older rows. Only those
-- genuinely ambiguous/null records receive the reviewed AVS canonical fallback.
-- AVS Engineering College's 2025-26 official fee structure identifies
-- CSE(AI&ML) as B.E., while AI&DS and IT are B.Tech.; this mapping is also
-- consistent with the Anna University AVS Engineering College programme list.
UPDATE "programmes" AS programme
SET "degree_type_id" = degree_type."id",
    "degree_type" = degree_type."name",
    "total_semesters" = GREATEST(2, LEAST(8, programme."duration_years" * 2))
FROM "departments" AS department
JOIN "degree_types" AS degree_type
  ON degree_type."college_id" = department."college_id"
 AND degree_type."code" = CASE
   WHEN regexp_replace(upper(btrim(department."code")), '[^A-Z0-9]+', '', 'g') IN ('CSE', 'ECE', 'EEE', 'MECH', 'ME', 'BME', 'AIML', 'CSEAIML') THEN 'BE'
   WHEN regexp_replace(upper(btrim(department."code")), '[^A-Z0-9]+', '', 'g') IN ('AIDS', 'IT') THEN 'BTECH'
   ELSE NULL
 END
WHERE programme."department_id" = department."id"
  AND programme."degree_type_id" IS NULL
  AND (
    programme."degree_type" IS NULL
    OR btrim(programme."degree_type") = ''
    OR regexp_replace(upper(programme."degree_type"), '[^A-Z0-9]+', '', 'g') IN ('BEBTECH', 'BTECHBE')
  );

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "programmes" WHERE "degree_type_id" IS NULL) THEN
    RAISE EXCEPTION 'Degree Type cutover stopped: one or more Programmes have no exact BE/BTECH mapping. Configure an exact Programme Master mapping before retrying.';
  END IF;
END $$;

ALTER TABLE "programmes"
  ALTER COLUMN "degree_type_id" SET NOT NULL,
  ADD CONSTRAINT "programmes_degree_type_id_fkey" FOREIGN KEY ("degree_type_id") REFERENCES "degree_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "programmes_duration_years_check" CHECK ("duration_years" BETWEEN 1 AND 4),
  ADD CONSTRAINT "programmes_total_semesters_check" CHECK ("total_semesters" BETWEEN 1 AND 8);
CREATE INDEX "programmes_college_id_degree_type_id_is_active_idx" ON "programmes"("college_id", "degree_type_id", "is_active");
CREATE INDEX "programmes_college_id_archived_at_idx" ON "programmes"("college_id", "archived_at");

ALTER TABLE "academic_years" ADD COLUMN "archived_at" TIMESTAMPTZ(3);

WITH ranked AS (
  SELECT "id", row_number() OVER (PARTITION BY "college_id" ORDER BY "starts_on" DESC, "created_at" DESC, "id") AS position
  FROM "academic_years"
  WHERE "is_current" = true
)
UPDATE "academic_years" AS academic_year
SET "is_current" = false
FROM ranked
WHERE academic_year."id" = ranked."id" AND ranked.position > 1;

ALTER TABLE "academic_years"
  ADD CONSTRAINT "academic_years_dates_check" CHECK ("ends_on" > "starts_on");
CREATE UNIQUE INDEX "academic_years_one_current_college_uq" ON "academic_years"("college_id") WHERE "is_current" = true;
CREATE UNIQUE INDEX "academic_years_college_normalized_name_uq" ON "academic_years"("college_id", lower(btrim("name")));
CREATE INDEX "academic_years_college_id_archived_at_idx" ON "academic_years"("college_id", "archived_at");

ALTER TABLE "student_profiles"
  ADD COLUMN "admission_type" "AdmissionType" NOT NULL DEFAULT 'REGULAR',
  ADD COLUMN "expected_graduation_year" INTEGER,
  ADD COLUMN "academic_status" "StudentAcademicStatus" NOT NULL DEFAULT 'ACTIVE';

UPDATE "student_profiles" AS profile
SET "expected_graduation_year" = profile."admission_year" + programme."duration_years"
FROM "programmes" AS programme
WHERE profile."programme_id" = programme."id" AND profile."expected_graduation_year" IS NULL;

UPDATE "student_profiles" AS profile
SET "academic_status" = 'GRADUATED'
FROM "users" AS student
WHERE profile."user_id" = student."id" AND student."status" = 'GRADUATED';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "student_profiles" WHERE "study_year" IS NOT NULL AND "study_year" NOT BETWEEN 1 AND 4) THEN
    RAISE EXCEPTION 'Cannot enforce Engineering study-year range: student profiles outside years 1-4 exist.';
  END IF;
  IF EXISTS (SELECT 1 FROM "sections" WHERE "study_year" IS NOT NULL AND "study_year" NOT BETWEEN 1 AND 4) THEN
    RAISE EXCEPTION 'Cannot enforce Engineering study-year range: sections outside years 1-4 exist.';
  END IF;
END $$;

ALTER TABLE "student_profiles"
  ADD CONSTRAINT "student_profiles_study_year_check" CHECK ("study_year" IS NULL OR "study_year" BETWEEN 1 AND 4),
  ADD CONSTRAINT "student_profiles_expected_graduation_year_check" CHECK ("expected_graduation_year" IS NULL OR "expected_graduation_year" > "admission_year");
ALTER TABLE "sections" ADD CONSTRAINT "sections_study_year_check" CHECK ("study_year" IS NULL OR "study_year" BETWEEN 1 AND 4);

ALTER TABLE "section_memberships"
  ADD COLUMN "department_id" UUID,
  ADD COLUMN "programme_id" UUID,
  ADD COLUMN "semester_id" UUID,
  ADD COLUMN "study_year" INTEGER,
  ADD COLUMN "status" "AcademicMembershipStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "changed_by_id" UUID,
  ADD COLUMN "reason" VARCHAR(500);

UPDATE "section_memberships" AS membership
SET "academic_year_id" = semester."academic_year_id",
    "department_id" = programme."department_id",
    "programme_id" = programme."id",
    "semester_id" = semester."id",
    "study_year" = COALESCE(section."study_year", GREATEST(1, LEAST(4, (semester."number" + 1) / 2))),
    "status" = CASE WHEN membership."is_active" THEN 'ACTIVE'::"AcademicMembershipStatus" ELSE 'MOVED'::"AcademicMembershipStatus" END
FROM "sections" AS section
JOIN "semesters" AS semester ON semester."id" = section."semester_id"
JOIN "programmes" AS programme ON programme."id" = semester."programme_id"
WHERE membership."section_id" = section."id";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "section_memberships"
    WHERE "academic_year_id" IS NULL OR "department_id" IS NULL OR "programme_id" IS NULL OR "semester_id" IS NULL OR "study_year" IS NULL
  ) THEN
    RAISE EXCEPTION 'Cannot backfill academic membership snapshots because an academic parent is missing.';
  END IF;
END $$;

ALTER TABLE "section_memberships"
  ALTER COLUMN "academic_year_id" SET NOT NULL,
  ALTER COLUMN "department_id" SET NOT NULL,
  ALTER COLUMN "programme_id" SET NOT NULL,
  ALTER COLUMN "semester_id" SET NOT NULL,
  ALTER COLUMN "study_year" SET NOT NULL,
  ADD CONSTRAINT "section_memberships_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "section_memberships_programme_id_fkey" FOREIGN KEY ("programme_id") REFERENCES "programmes"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "section_memberships_semester_id_fkey" FOREIGN KEY ("semester_id") REFERENCES "semesters"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "section_memberships_changed_by_id_fkey" FOREIGN KEY ("changed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "section_memberships_study_year_check" CHECK ("study_year" BETWEEN 1 AND 4);
CREATE INDEX "section_memberships_student_user_id_academic_year_id_starts_on_idx" ON "section_memberships"("student_user_id", "academic_year_id", "starts_on");
CREATE INDEX "section_memberships_programme_id_academic_year_id_study_year_semester_id_idx" ON "section_memberships"("programme_id", "academic_year_id", "study_year", "semester_id");

INSERT INTO "permissions" ("id", "code", "resource", "action", "description")
VALUES (gen_random_uuid(), 'academic.override_placement', 'academic', 'override_placement', 'Override normal Engineering study-year and semester placement with a required audited reason.')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT role."id", permission."id"
FROM "roles" AS role
CROSS JOIN "permissions" AS permission
WHERE role."code" IN ('SUPER_ADMIN', 'MAIN_ADMIN')
  AND permission."code" = 'academic.override_placement'
ON CONFLICT DO NOTHING;

COMMIT;
