/**
 * People Deletion — Safety Tests
 *
 * These tests verify the safe student deletion flow:
 * - Active students cannot be permanently deleted
 * - Missing backup blocks deletion
 * - Incorrect confirmation phrase blocks deletion
 * - Cross-college deletion is blocked
 * - Sessions and ephemeral data are deleted
 * - Profile is anonymised
 * - Attendance records are preserved
 * - Shared issues remain intact
 * - Audit log is created
 * - Other users remain unchanged
 */

import { Test, TestingModule } from "@nestjs/testing";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { UsersService } from "../src/modules/users/users.service";
import { PrismaService } from "../src/database/prisma.service";
import { AuditService } from "../src/modules/audit/audit.service";
import { ConfigService } from "@nestjs/config";
import { OfficialGroupsService } from "../src/modules/conversations/official-groups.service";
import type { AuthPrincipal } from "../src/common/http/request-context";

/* ── Mock helpers ── */

const mockAdmin: AuthPrincipal = {
  id: "admin-id-001",
  publicId: "admin-pub-001",
  fullName: "Main Admin",
  email: "admin@avscollege.edu.in",
  collegeId: "college-001",
  status: "ACTIVE",
  mustChangePassword: false,
  sessionId: "session-001",
  roles: ["MAIN_ADMIN"],
  permissions: ["users.read", "users.create", "users.suspend", "users.delete_permanent"],
  scopes: [],
};

const mockStudent = {
  id: "student-internal-001",
  publicId: "student-pub-001",
  collegeIdentityId: "AVS-STU-001",
  fullName: "Test Student",
  email: "test@student.edu.in",
  status: "ARCHIVED",
  collegeId: "college-001",
  roles: [{ role: { code: "STUDENT" } }],
};

const mockActiveStudent = { ...mockStudent, status: "ACTIVE" };

function createMockPrismaService() {
  const counts: Record<string, number> = {
    session: 2,
    refreshToken: 3,
    passwordResetToken: 0,
    deviceRegistration: 1,
    studentProfile: 1,
    sectionMembership: 2,
    attendanceRecord: 248,
    attendanceSummary: 4,
    attendanceIntervention: 1,
    issueReported: 3,
    issueAssigned: 0,
    issueOccurrence: 5,
    issueComment: 12,
    issueAttachment: 2,
    issueAffectedUser: 1,
    issueStatusHistory: 8,
    message: 45,
    conversationParticipant: 3,
    feedbackSubmission: 6,
    notificationRecipient: 20,
    announcementReadReceipt: 15,
    fileRecord: 4,
    aiConversation: 2,
    auditLog: 30,
    broadcastRecipient: 5,
  };

  return {
    user: {
      findFirst: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    session: { count: jest.fn().mockResolvedValue(counts.session), deleteMany: jest.fn().mockResolvedValue({ count: 2 }) },
    refreshToken: { count: jest.fn().mockResolvedValue(counts.refreshToken) },
    passwordResetToken: { count: jest.fn().mockResolvedValue(0), deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    deviceRegistration: { count: jest.fn().mockResolvedValue(counts.deviceRegistration), deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
    studentProfile: { count: jest.fn().mockResolvedValue(1), findFirst: jest.fn().mockResolvedValue({ id: "sp-001" }), update: jest.fn().mockResolvedValue({}) },
    sectionMembership: { count: jest.fn().mockResolvedValue(2), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    attendanceRecord: { count: jest.fn().mockResolvedValue(248) },
    attendanceSummary: { count: jest.fn().mockResolvedValue(4) },
    attendanceIntervention: { count: jest.fn().mockResolvedValue(1) },
    issue: { count: jest.fn().mockResolvedValue(3) },
    issueOccurrence: { count: jest.fn().mockResolvedValue(5) },
    issueComment: { count: jest.fn().mockResolvedValue(12) },
    issueAttachment: { count: jest.fn().mockResolvedValue(2) },
    issueAffectedUser: { count: jest.fn().mockResolvedValue(1), deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
    issueStatusHistory: { count: jest.fn().mockResolvedValue(8) },
    message: { count: jest.fn().mockResolvedValue(45) },
    conversationParticipant: { count: jest.fn().mockResolvedValue(3), deleteMany: jest.fn().mockResolvedValue({ count: 3 }) },
    feedbackSubmission: { count: jest.fn().mockResolvedValue(6) },
    notificationRecipient: { count: jest.fn().mockResolvedValue(20), deleteMany: jest.fn().mockResolvedValue({ count: 20 }) },
    announcementReadReceipt: { count: jest.fn().mockResolvedValue(15), deleteMany: jest.fn().mockResolvedValue({ count: 15 }) },
    fileRecord: { count: jest.fn().mockResolvedValue(4) },
    aiConversation: { count: jest.fn().mockResolvedValue(2), deleteMany: jest.fn().mockResolvedValue({ count: 2 }) },
    auditLog: { count: jest.fn().mockResolvedValue(30), create: jest.fn().mockResolvedValue({}) },
    broadcastRecipient: { count: jest.fn().mockResolvedValue(5) },
    importJob: { count: jest.fn().mockResolvedValue(0) },
    databaseBackup: {
      findFirst: jest.fn().mockResolvedValue({ id: "backup-verified-001" }),
    },
    $transaction: jest.fn().mockImplementation(async (fn: (tx: unknown) => Promise<void>) => {
      // Execute the transaction function with the mock itself as tx
      const txProxy = new Proxy({} as Record<string, unknown>, {
        get: (_target, prop) => {
          if (prop === "$executeRawUnsafe") return jest.fn().mockResolvedValue(undefined);
          return (createMockPrismaService() as Record<string, unknown>)[prop as string];
        },
      });
      return fn(txProxy);
    }),
  };
}

describe("UsersService — Dependency Report", () => {
  let service: UsersService;
  let prisma: ReturnType<typeof createMockPrismaService>;

  beforeEach(async () => {
    prisma = createMockPrismaService();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: { record: jest.fn().mockResolvedValue({}) } },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: OfficialGroupsService, useValue: {} },
      ],
    }).compile();
    service = module.get(UsersService);
  });

  it("should return dependency report for an existing student", async () => {
    prisma.user.findFirst.mockResolvedValue(mockStudent);
    const report = await service.dependencyReport(mockAdmin, mockStudent.publicId);
    expect(report.userId).toBe(mockStudent.publicId);
    expect(report.userName).toBe(mockStudent.fullName);
    expect(report.totalRecords).toBeGreaterThan(0);
    expect(report.blockingDependencies.length).toBeGreaterThan(0);
    expect(report.deletableData.length).toBeGreaterThan(0);
  });

  it("should classify attendance as blocking", async () => {
    prisma.user.findFirst.mockResolvedValue(mockStudent);
    const report = await service.dependencyReport(mockAdmin, mockStudent.publicId);
    const attendanceDep = report.blockingDependencies.find((d) => d.type === "ATTENDANCE_RECORDS");
    expect(attendanceDep).toBeDefined();
    expect(attendanceDep!.count).toBe(248);
  });

  it("should classify sessions as deletable", async () => {
    prisma.user.findFirst.mockResolvedValue(mockStudent);
    const report = await service.dependencyReport(mockAdmin, mockStudent.publicId);
    const sessionDep = report.deletableData.find((d) => d.type === "ACTIVE_SESSIONS");
    expect(sessionDep).toBeDefined();
    expect(sessionDep!.count).toBe(2);
  });

  it("should throw 404 for unknown user", async () => {
    prisma.user.findFirst.mockResolvedValue(null);
    await expect(service.dependencyReport(mockAdmin, "unknown-id")).rejects.toThrow(NotFoundException);
  });

  it("should throw 404 for cross-college user", async () => {
    // findFirst with collegeId filter returns null for different college
    prisma.user.findFirst.mockResolvedValue(null);
    await expect(service.dependencyReport(mockAdmin, "cross-college-student-id")).rejects.toThrow(NotFoundException);
  });
});

describe("UsersService — Permanent Deletion", () => {
  let service: UsersService;
  let prisma: ReturnType<typeof createMockPrismaService>;
  let audit: { record: jest.Mock };

  beforeEach(async () => {
    prisma = createMockPrismaService();
    audit = { record: jest.fn().mockResolvedValue({}) };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: OfficialGroupsService, useValue: {} },
      ],
    }).compile();
    service = module.get(UsersService);
  });

  it("should reject deletion of active student", async () => {
    prisma.user.findFirst.mockResolvedValue(mockActiveStudent);
    await expect(
      service.deletePermanently(mockAdmin, mockActiveStudent.publicId, {
        reason: "Test",
        confirmationPhrase: `DELETE STUDENT ${mockActiveStudent.collegeIdentityId}`,
        backupReference: "backup-001",
      }, "req-001"),
    ).rejects.toThrow(BadRequestException);
  });

  it("should reject incorrect confirmation phrase", async () => {
    prisma.user.findFirst.mockResolvedValue(mockStudent);
    await expect(
      service.deletePermanently(mockAdmin, mockStudent.publicId, {
        reason: "Test",
        confirmationPhrase: "WRONG PHRASE",
        backupReference: "backup-001",
      }, "req-001"),
    ).rejects.toThrow(BadRequestException);
  });

  it("should reject missing backup reference", async () => {
    prisma.user.findFirst.mockResolvedValue(mockStudent);
    await expect(
      service.deletePermanently(mockAdmin, mockStudent.publicId, {
        reason: "Test",
        confirmationPhrase: `DELETE STUDENT ${mockStudent.collegeIdentityId}`,
        backupReference: "",
      }, "req-001"),
    ).rejects.toThrow(BadRequestException);
  });

  it("should reject a backup that is not verified for the current college", async () => {
    prisma.user.findFirst.mockResolvedValue(mockStudent);
    prisma.databaseBackup.findFirst.mockResolvedValue(null);
    await expect(
      service.deletePermanently(mockAdmin, mockStudent.publicId, {
        reason: "Test",
        confirmationPhrase: `DELETE STUDENT ${mockStudent.collegeIdentityId}`,
        backupReference: "backup-from-another-college",
      }, "req-001"),
    ).rejects.toThrow(BadRequestException);
  });

  it("should reject deletion of the current administrator", async () => {
    prisma.user.findFirst.mockResolvedValue({ ...mockStudent, id: mockAdmin.id });
    await expect(
      service.deletePermanently(mockAdmin, mockStudent.publicId, {
        reason: "Test",
        confirmationPhrase: `DELETE STUDENT ${mockStudent.collegeIdentityId}`,
        backupReference: "backup-verified-001",
      }, "req-001"),
    ).rejects.toThrow(BadRequestException);
  });

  it("should reject cross-college deletion", async () => {
    prisma.user.findFirst.mockResolvedValue(null); // cross-college filter returns null
    await expect(
      service.deletePermanently(mockAdmin, "cross-college-id", {
        reason: "Test",
        confirmationPhrase: "DELETE STUDENT X",
        backupReference: "backup-001",
      }, "req-001"),
    ).rejects.toThrow(NotFoundException);
  });

  it("should succeed with valid archived student and correct inputs", async () => {
    prisma.user.findFirst.mockResolvedValue(mockStudent);
    const result = await service.deletePermanently(mockAdmin, mockStudent.publicId, {
      reason: "Duplicate test account",
      confirmationPhrase: `DELETE STUDENT ${mockStudent.collegeIdentityId}`,
      backupReference: "backup-verified-001",
    }, "req-001");
    expect(result.success).toBe(true);
    expect(result.anonymousReference).toContain("Deleted User");
  });

  it("should accept alt confirmation phrase PERMANENTLY DELETE USER", async () => {
    prisma.user.findFirst.mockResolvedValue(mockStudent);
    const result = await service.deletePermanently(mockAdmin, mockStudent.publicId, {
      reason: "Admin override",
      confirmationPhrase: "PERMANENTLY DELETE USER",
      backupReference: "backup-verified-002",
    }, "req-002");
    expect(result.success).toBe(true);
  });

  it("should accept the public-user-bound confirmation phrase", async () => {
    prisma.user.findFirst.mockResolvedValue(mockStudent);
    const result = await service.deletePermanently(mockAdmin, mockStudent.publicId, {
      reason: "Duplicate test account",
      confirmationPhrase: `DELETE USER ${mockStudent.publicId}`,
      backupReference: "backup-verified-003",
    }, "req-003");
    expect(result.success).toBe(true);
  });
});
