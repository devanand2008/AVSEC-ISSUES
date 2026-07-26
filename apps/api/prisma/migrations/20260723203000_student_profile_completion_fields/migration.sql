ALTER TABLE "student_profiles"
  ADD COLUMN "register_number" VARCHAR(60),
  ADD COLUMN "admission_number" VARCHAR(60),
  ADD COLUMN "study_year" INTEGER,
  ADD COLUMN "date_of_birth" DATE,
  ADD COLUMN "gender" VARCHAR(30),
  ADD COLUMN "personal_email" VARCHAR(254),
  ADD COLUMN "blood_group" VARCHAR(10),
  ADD COLUMN "address" VARCHAR(500),
  ADD COLUMN "city" VARCHAR(100),
  ADD COLUMN "district" VARCHAR(100),
  ADD COLUMN "state" VARCHAR(100),
  ADD COLUMN "pin_code" VARCHAR(12),
  ADD COLUMN "parent_name" VARCHAR(180),
  ADD COLUMN "parent_mobile_number" VARCHAR(30),
  ADD COLUMN "emergency_contact" VARCHAR(30);

CREATE UNIQUE INDEX "student_profiles_college_id_register_number_key"
  ON "student_profiles"("college_id", "register_number");
