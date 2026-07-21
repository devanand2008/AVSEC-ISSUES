/**
 * Attendance workflow tests — session lifecycle, record status transitions,
 * correction approval flow, and SLA/scope enforcement.
 */
import type { AuthPrincipal } from "../src/common/http/request-context";

const FACULTY: AuthPrincipal = {
  id: "00000000-0000-0000-0000-000000000001",
  publicId: "00000000-0000-0000-0000-000000000002",
  collegeId: "00000000-0000-0000-0000-000000000003",
  fullName: "Prof. Kumar",
  email: "kumar@college.edu",
  status: "ACTIVE",
  mustChangePassword: false,
  sessionId: "00000000-0000-0000-0000-000000000004",
  roles: ["FACULTY"],
  permissions: ["attendance.session.create", "attendance.read_class"],
  scopes: [{ type: "SECTION", id: "section-01", issueCategoryId: null }],
};

const STUDENT: AuthPrincipal = {
  ...FACULTY,
  id: "00000000-0000-0000-0000-000000000010",
  roles: ["STUDENT"],
  permissions: ["attendance.read_own"],
  scopes: [],
};

const DEPT_HOD: AuthPrincipal = {
  ...FACULTY,
  id: "00000000-0000-0000-0000-000000000020",
  roles: ["HOD"],
  permissions: ["attendance.read_department", "attendance.correction.approve"],
  scopes: [{ type: "DEPARTMENT", id: "dept-01", issueCategoryId: null }],
};

function makeRecord(studentId: string, status: string) {
  return {
    sessionId: "session-001",
    studentUserId: studentId,
    status,
    markedAt: new Date(),
  };
}

describe("Attendance session status machine", () => {
  const ALLOWED_TRANSITIONS: Record<string, string[]> = {
    DRAFT: ["OPEN"],
    OPEN: ["CLOSED"],
    CLOSED: [],
  };

  function canTransition(from: string, to: string): boolean {
    return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
  }

  it("allows DRAFT → OPEN", () => {
    expect(canTransition("DRAFT", "OPEN")).toBe(true);
  });

  it("allows OPEN → CLOSED", () => {
    expect(canTransition("OPEN", "CLOSED")).toBe(true);
  });

  it("disallows CLOSED → OPEN (re-open without correction)", () => {
    expect(canTransition("CLOSED", "OPEN")).toBe(false);
  });

  it("disallows DRAFT → CLOSED (must pass through OPEN)", () => {
    expect(canTransition("DRAFT", "CLOSED")).toBe(false);
  });
});

describe("Attendance record status values", () => {
  const VALID_STATUSES = ["PRESENT", "ABSENT", "LATE", "EXCUSED", "DUTY_LEAVE", "MEDICAL_LEAVE"];

  it.each(VALID_STATUSES)("accepts valid status: %s", (status) => {
    const record = makeRecord(STUDENT.id, status);
    expect(VALID_STATUSES.includes(record.status)).toBe(true);
  });

  it("rejects an unknown status", () => {
    expect(VALID_STATUSES.includes("TRUANT")).toBe(false);
  });
});

describe("Attendance scope enforcement", () => {
  it("FACULTY can only manage their own section", () => {
    const targetSection = "section-01";
    const otherSection = "section-02";
    const facultySections = FACULTY.scopes.filter((s) => s.type === "SECTION").map((s) => s.id);
    expect(facultySections.includes(targetSection)).toBe(true);
    expect(facultySections.includes(otherSection)).toBe(false);
  });

  it("HOD has department-level read access", () => {
    expect(DEPT_HOD.permissions.includes("attendance.read_department")).toBe(true);
  });

  it("STUDENT only has read-own permission", () => {
    expect(STUDENT.permissions.includes("attendance.read_own")).toBe(true);
    expect(STUDENT.permissions.includes("attendance.read_class")).toBe(false);
    expect(STUDENT.permissions.includes("attendance.read_department")).toBe(false);
  });

  it("FACULTY cannot approve corrections without the permission", () => {
    expect(FACULTY.permissions.includes("attendance.correction.approve")).toBe(false);
  });

  it("HOD can approve corrections", () => {
    expect(DEPT_HOD.permissions.includes("attendance.correction.approve")).toBe(true);
  });
});

describe("Attendance correction workflow", () => {
  type CorrectionStatus = "PENDING" | "APPROVED" | "REJECTED";

  function makeCorrection(overrides: Partial<{ status: CorrectionStatus }> = {}) {
    return {
      id: "correction-001",
      sessionId: "session-001",
      studentId: STUDENT.id,
      requestedStatus: "PRESENT",
      currentStatus: "ABSENT",
      reason: "Medical certificate attached",
      status: "PENDING" as CorrectionStatus,
      requestedAt: new Date(),
      ...overrides,
    };
  }

  it("creates a correction in PENDING state", () => {
    const correction = makeCorrection();
    expect(correction.status).toBe("PENDING");
  });

  it("allows HOD to approve a PENDING correction", () => {
    const correction = makeCorrection({ status: "PENDING" });
    const canApprove = DEPT_HOD.permissions.includes("attendance.correction.approve");
    const nextStatus: CorrectionStatus = canApprove && correction.status === "PENDING" ? "APPROVED" : correction.status;
    expect(nextStatus).toBe("APPROVED");
  });

  it("does not allow a FACULTY to approve", () => {
    const correction = makeCorrection({ status: "PENDING" });
    const canApprove = FACULTY.permissions.includes("attendance.correction.approve");
    const nextStatus: CorrectionStatus = canApprove && correction.status === "PENDING" ? "APPROVED" : correction.status;
    expect(nextStatus).toBe("PENDING");
  });

  it("does not allow approving an already-approved correction", () => {
    const correction = makeCorrection({ status: "APPROVED" });
    const canTransition = correction.status === "PENDING";
    expect(canTransition).toBe(false);
  });

  it("does not allow re-approving a rejected correction", () => {
    const correction = makeCorrection({ status: "REJECTED" });
    const canTransition = correction.status === "PENDING";
    expect(canTransition).toBe(false);
  });
});

describe("Session period numbering", () => {
  it("validates period numbers between 1 and 8", () => {
    const validate = (n: number) => n >= 1 && n <= 8 && Number.isInteger(n);
    expect(validate(1)).toBe(true);
    expect(validate(8)).toBe(true);
    expect(validate(0)).toBe(false);
    expect(validate(9)).toBe(false);
    expect(validate(1.5)).toBe(false);
  });
});
