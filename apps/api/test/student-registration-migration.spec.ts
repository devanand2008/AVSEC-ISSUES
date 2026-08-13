import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("student registration academic master migration", () => {
  const migration = readFileSync(
    resolve(
      process.cwd(),
      "prisma/migrations/20260813073000_student_registration_academic_master/migration.sql",
    ),
    "utf8",
  );

  it("preserves explicit BE/BTECH programme mappings before canonical fallback", () => {
    const explicitMapping = migration.indexOf(
      "regexp_replace(upper(coalesce(programme.\"degree_type\", ''))",
    );
    const departmentFallback = migration.indexOf(
      "regexp_replace(upper(btrim(department.\"code\"))",
    );

    expect(explicitMapping).toBeGreaterThan(-1);
    expect(departmentFallback).toBeGreaterThan(explicitMapping);
    expect(migration).toContain(
      'WHERE programme."department_id" = department."id"\n  AND programme."degree_type_id" IS NULL',
    );
  });

  it("limits fallback to ambiguous legacy values and fails closed when unmapped", () => {
    expect(migration).toContain("IN ('BEBTECH', 'BTECHBE')");
    expect(migration).toContain(
      'IF EXISTS (SELECT 1 FROM "programmes" WHERE "degree_type_id" IS NULL)',
    );
    expect(migration).toContain(
      "Degree Type cutover stopped: one or more Programmes have no exact BE/BTECH mapping",
    );
  });

  it("uses the reviewed AVS mapping only for ambiguous legacy values", () => {
    expect(migration).toContain(
      "('CSE', 'ECE', 'EEE', 'MECH', 'ME', 'BME', 'AIML', 'CSEAIML') THEN 'BE'",
    );
    expect(migration).toContain("IN ('AIDS', 'IT') THEN 'BTECH'");
    expect(migration).toContain("official fee structure identifies");
  });
});
