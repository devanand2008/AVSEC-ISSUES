BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "departments"
    GROUP BY "college_id", lower(btrim("code"))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot add normalized department-code uniqueness: duplicate trimmed case-insensitive codes exist.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "departments"
    GROUP BY "college_id", lower(btrim("name"))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot add normalized department-name uniqueness: duplicate trimmed case-insensitive names exist.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "programmes"
    GROUP BY "department_id", lower(btrim("code"))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot add normalized programme-code uniqueness: duplicate trimmed case-insensitive codes exist in a department.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "programmes"
    GROUP BY "department_id", lower(btrim("name"))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot add normalized programme-name uniqueness: duplicate trimmed case-insensitive names exist in a department.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "sections"
    GROUP BY "semester_id", lower(btrim("code"))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot add normalized section-code uniqueness: duplicate trimmed case-insensitive codes exist in a semester.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "sections"
    GROUP BY "semester_id", lower(btrim("name"))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot add normalized section-name uniqueness: duplicate trimmed case-insensitive names exist in a semester.';
  END IF;
END $$;

CREATE UNIQUE INDEX "departments_college_normalized_code_uq"
  ON "departments" ("college_id", lower(btrim("code")));
CREATE UNIQUE INDEX "departments_college_normalized_name_uq"
  ON "departments" ("college_id", lower(btrim("name")));
CREATE UNIQUE INDEX "programmes_department_normalized_code_uq"
  ON "programmes" ("department_id", lower(btrim("code")));
CREATE UNIQUE INDEX "programmes_department_normalized_name_uq"
  ON "programmes" ("department_id", lower(btrim("name")));
CREATE UNIQUE INDEX "sections_semester_normalized_code_uq"
  ON "sections" ("semester_id", lower(btrim("code")));
CREATE UNIQUE INDEX "sections_semester_normalized_name_uq"
  ON "sections" ("semester_id", lower(btrim("name")));

COMMIT;
