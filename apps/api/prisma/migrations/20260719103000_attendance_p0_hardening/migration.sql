CREATE TYPE "StaffAttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'LEAVE', 'ON_DUTY');
CREATE TYPE "StaffAttendanceSource" AS ENUM ('MANUAL', 'IMPORT', 'BIOMETRIC', 'API');
CREATE TYPE "AttendanceInterventionType" AS ENUM ('EMAIL', 'WHATSAPP', 'WARNING_LETTER', 'COUNSELLING');
CREATE TYPE "AttendanceInterventionStatus" AS ENUM ('PENDING', 'QUEUED', 'SENT', 'DELIVERED', 'COMPLETED', 'FAILED', 'CANCELLED');

CREATE TABLE "staff_attendance_records" (
  "id" UUID NOT NULL,
  "college_id" UUID NOT NULL,
  "staff_user_id" UUID NOT NULL,
  "attendance_date" DATE NOT NULL,
  "status" "StaffAttendanceStatus" NOT NULL,
  "check_in_at" TIMESTAMPTZ(3),
  "check_out_at" TIMESTAMPTZ(3),
  "is_late" BOOLEAN NOT NULL DEFAULT false,
  "late_minutes" INTEGER NOT NULL DEFAULT 0,
  "is_early_departure" BOOLEAN NOT NULL DEFAULT false,
  "early_departure_minutes" INTEGER NOT NULL DEFAULT 0,
  "source" "StaffAttendanceSource" NOT NULL DEFAULT 'MANUAL',
  "notes" VARCHAR(1000),
  "created_by_id" UUID NOT NULL,
  "updated_by_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "staff_attendance_records_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "staff_attendance_records_late_minutes_check" CHECK ("late_minutes" BETWEEN 0 AND 1440),
  CONSTRAINT "staff_attendance_records_early_minutes_check" CHECK ("early_departure_minutes" BETWEEN 0 AND 1440),
  CONSTRAINT "staff_attendance_records_late_flag_check" CHECK ("is_late" OR "late_minutes" = 0),
  CONSTRAINT "staff_attendance_records_early_flag_check" CHECK ("is_early_departure" OR "early_departure_minutes" = 0),
  CONSTRAINT "staff_attendance_records_clock_order_check" CHECK ("check_out_at" IS NULL OR "check_in_at" IS NULL OR "check_out_at" >= "check_in_at")
);

CREATE TABLE "attendance_interventions" (
  "id" UUID NOT NULL,
  "college_id" UUID NOT NULL,
  "student_user_id" UUID NOT NULL,
  "type" "AttendanceInterventionType" NOT NULL,
  "status" "AttendanceInterventionStatus" NOT NULL DEFAULT 'PENDING',
  "provider_reference" VARCHAR(200),
  "error_message" VARCHAR(2000),
  "notes" VARCHAR(2000),
  "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "attendance_interventions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "staff_attendance_records_staff_user_id_attendance_date_key"
  ON "staff_attendance_records"("staff_user_id", "attendance_date");
CREATE INDEX "staff_attendance_records_college_id_attendance_date_status_idx"
  ON "staff_attendance_records"("college_id", "attendance_date", "status");
CREATE INDEX "staff_attendance_records_college_id_source_idx"
  ON "staff_attendance_records"("college_id", "source");
CREATE INDEX "attendance_interventions_college_id_occurred_at_idx"
  ON "attendance_interventions"("college_id", "occurred_at");
CREATE INDEX "attendance_interventions_student_user_id_type_status_occurred_at_idx"
  ON "attendance_interventions"("student_user_id", "type", "status", "occurred_at");

ALTER TABLE "staff_attendance_records"
  ADD CONSTRAINT "staff_attendance_records_college_id_fkey" FOREIGN KEY ("college_id") REFERENCES "colleges"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "staff_attendance_records_staff_user_id_fkey" FOREIGN KEY ("staff_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "staff_attendance_records_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "staff_attendance_records_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "attendance_interventions"
  ADD CONSTRAINT "attendance_interventions_college_id_fkey" FOREIGN KEY ("college_id") REFERENCES "colleges"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "attendance_interventions_student_user_id_fkey" FOREIGN KEY ("student_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "attendance_interventions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "permissions" ("id", "code", "resource", "action", "description")
VALUES
  (gen_random_uuid(), 'attendance.staff.manage', 'attendance', 'staff.manage', 'Create and update scoped staff attendance records.'),
  (gen_random_uuid(), 'attendance.interventions.manage', 'attendance', 'interventions.manage', 'Record scoped low-attendance interventions.')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "created_at")
SELECT role_row."id", permission_row."id", CURRENT_TIMESTAMP
FROM "roles" AS role_row
CROSS JOIN "permissions" AS permission_row
WHERE role_row."code" IN ('SUPER_ADMIN', 'MAIN_ADMIN', 'PRINCIPAL', 'VICE_PRINCIPAL', 'HOD')
  AND permission_row."code" IN ('attendance.staff.manage', 'attendance.interventions.manage')
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
