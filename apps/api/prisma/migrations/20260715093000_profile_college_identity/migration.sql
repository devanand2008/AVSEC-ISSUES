-- Establish tenant-level uniqueness for student and employee identities.
-- The columns are added nullable, backfilled from the owning user, then made
-- mandatory so existing installations migrate without losing profile rows.
ALTER TABLE "student_profiles" ADD COLUMN "college_id" UUID;
ALTER TABLE "staff_profiles" ADD COLUMN "college_id" UUID;

UPDATE "student_profiles" AS profile
SET "college_id" = users."college_id"
FROM "users"
WHERE users."id" = profile."user_id";

UPDATE "staff_profiles" AS profile
SET "college_id" = users."college_id"
FROM "users"
WHERE users."id" = profile."user_id";

ALTER TABLE "student_profiles" ALTER COLUMN "college_id" SET NOT NULL;
ALTER TABLE "staff_profiles" ALTER COLUMN "college_id" SET NOT NULL;

ALTER TABLE "student_profiles" DROP CONSTRAINT IF EXISTS "student_profiles_department_id_student_id_key";
DROP INDEX IF EXISTS "staff_profiles_department_id_employee_id_idx";

CREATE UNIQUE INDEX "student_profiles_college_id_student_id_key" ON "student_profiles"("college_id", "student_id");
CREATE UNIQUE INDEX "staff_profiles_college_id_employee_id_key" ON "staff_profiles"("college_id", "employee_id");
CREATE INDEX "staff_profiles_department_id_idx" ON "staff_profiles"("department_id");

ALTER TABLE "student_profiles"
  ADD CONSTRAINT "student_profiles_college_id_fkey"
  FOREIGN KEY ("college_id") REFERENCES "colleges"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "staff_profiles"
  ADD CONSTRAINT "staff_profiles_college_id_fkey"
  FOREIGN KEY ("college_id") REFERENCES "colleges"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
