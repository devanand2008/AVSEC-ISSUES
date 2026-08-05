import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { AuthPrincipal } from "../src/common/http/request-context";
import { IssuesService } from "../src/modules/issues/issues.service";

const user: AuthPrincipal = {
  id: "00000000-0000-0000-0000-000000000001",
  publicId: "00000000-0000-0000-0000-000000000002",
  collegeId: "00000000-0000-0000-0000-000000000003",
  fullName: "Student",
  email: null,
  status: "ACTIVE",
  mustChangePassword: false,
  sessionId: "00000000-0000-0000-0000-000000000004",
  roles: ["STUDENT"],
  permissions: ["issues.read_own", "issues.subscribe"],
  scopes: [{ type: "ASSIGNED_ISSUES", id: null, issueCategoryId: null }],
};

function setup() {
  const tx = {
    issue: { update: jest.fn(), updateMany: jest.fn(), findUniqueOrThrow: jest.fn() },
    issueAffectedUser: { findUnique: jest.fn(), create: jest.fn() },
    issueOccurrence: { create: jest.fn() },
    issueAssignmentHistory: { create: jest.fn() },
    issueStatusHistory: { create: jest.fn() },
    responsibleTeamMember: { findMany: jest.fn() },
    notification: { create: jest.fn() },
    outboxEvent: { create: jest.fn() },
    idempotencyKey: { create: jest.fn() },
  };
  const prisma = {
    issue: { findFirst: jest.fn() },
    room: { findFirst: jest.fn() },
    floor: { findFirst: jest.fn() },
    area: { findFirst: jest.fn() },
    asset: { findFirst: jest.fn() },
    issueCategory: { findFirst: jest.fn() },
    qrCode: { findUnique: jest.fn() },
    user: { findFirst: jest.fn() },
    responsibleTeam: { findFirst: jest.fn() },
    responsibleTeamMember: { findFirst: jest.fn() },
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
  };
  const access = { issueWhere: jest.fn(() => ({ collegeId: user.collegeId })) };
  const idempotency = { hash: jest.fn(() => "request-hash"), replay: jest.fn().mockResolvedValue(null) };
  const duplicateProofs = { issue: jest.fn(), verify: jest.fn() };
  const service = new IssuesService(prisma as never, access as never, idempotency as never, {} as never, {} as never, duplicateProofs as never);
  return { service, prisma, tx, access, idempotency, duplicateProofs };
}

describe("IssuesService authorization and assignment hardening", () => {
  it("blocks direct resolution without the finish-work evidence flow", async () => {
    const { service, prisma } = setup();
    const issueId = "00000000-0000-4000-8000-000000000010";
    prisma.issue.findFirst.mockResolvedValue({
      id: issueId,
      collegeId: user.collegeId,
      status: "IN_PROGRESS",
    });

    await expect(
      service.status(
        user,
        issueId,
        { status: "RESOLVED", comment: "Work completed." },
        { requestId: "request-1" },
      ),
    ).rejects.toThrow("Use the finish-work action with verified completion photo evidence.");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("links a probable duplicate and increments its occurrence count", async () => {
    const { service, prisma, tx } = setup();
    const roomId = "00000000-0000-0000-0000-000000000020";
    const categoryId = "00000000-0000-0000-0000-000000000021";
    const duplicate = { id: "00000000-0000-0000-0000-000000000022", issueNumber: "ISS-2026-000022", title: "Fan stopped", status: "ASSIGNED", affectedUserCount: 1 };
    prisma.room.findFirst.mockResolvedValue({
      id: roomId,
      departmentId: null,
      roomType: "CLASSROOM",
      floorId: "00000000-0000-0000-0000-000000000023",
      floor: {
        blockId: "00000000-0000-0000-0000-000000000024",
        block: { campusId: "00000000-0000-0000-0000-000000000025", campus: { id: "00000000-0000-0000-0000-000000000025" } },
      },
    });
    prisma.issueCategory.findFirst.mockResolvedValue({ id: categoryId });
    prisma.issue.findFirst.mockResolvedValue(duplicate);
    tx.issueAffectedUser.findUnique.mockResolvedValue(null);
    tx.issue.update.mockResolvedValue({ ...duplicate, occurrenceCount: 2 });
    tx.notification.create.mockResolvedValue({ id: "00000000-0000-4000-8000-000000000026" });

    await expect(
      service.create(user, { roomId, categoryId, title: "Fan stopped", description: "The ceiling fan has stopped." }, "idempotency-key", { requestId: "request-1" }),
    ).resolves.toEqual(expect.objectContaining({
      id: duplicate.id,
      linkedToExisting: true,
      occurrenceCount: 2,
    }));
    expect(tx.issueOccurrence.create).toHaveBeenCalledWith({
      data: { issueId: duplicate.id, reporterUserId: user.id, description: "The ceiling fan has stopped." },
    });
  });

  it("validates a registered asset against the selected area", async () => {
    const { service, prisma, tx } = setup();
    const floorId = "00000000-0000-4000-8000-000000000030";
    const areaId = "00000000-0000-4000-8000-000000000031";
    const assetId = "00000000-0000-4000-8000-000000000032";
    const categoryId = "00000000-0000-4000-8000-000000000033";
    const duplicate = {
      id: "00000000-0000-4000-8000-000000000034",
      issueNumber: "ISS-2026-000034",
      title: "Projector fault",
      status: "ASSIGNED",
      affectedUserCount: 1,
      reporterId: user.id,
      assignedToId: null,
      priority: "MEDIUM",
      teamId: null,
      acknowledgementDueAt: null,
      resolutionDueAt: null,
    };
    prisma.floor.findFirst.mockResolvedValue({
      id: floorId,
      blockId: "00000000-0000-4000-8000-000000000035",
      block: {
        id: "00000000-0000-4000-8000-000000000035",
        campusId: "00000000-0000-4000-8000-000000000036",
        campus: { id: "00000000-0000-4000-8000-000000000036" },
      },
    });
    prisma.area.findFirst.mockResolvedValue({ id: areaId, floorId });
    prisma.asset.findFirst.mockResolvedValue({ id: assetId, areaId });
    prisma.issueCategory.findFirst.mockResolvedValue({ id: categoryId });
    prisma.issue.findFirst.mockResolvedValue(duplicate);
    tx.issueAffectedUser.findUnique.mockResolvedValue({ issueId: duplicate.id, userId: user.id });
    tx.issue.update.mockResolvedValue({ ...duplicate, occurrenceCount: 2 });
    tx.notification.create.mockResolvedValue({ id: "00000000-0000-4000-8000-000000000037" });

    await expect(service.create(user, {
      locationType: "AREA",
      floorId,
      areaId,
      assetId,
      categoryId,
      title: "Projector fault",
      description: "The auditorium projector does not power on.",
    }, "area-idempotency-key", { requestId: "request-area" })).resolves.toEqual(expect.objectContaining({
      linkedToExisting: true,
      id: duplicate.id,
    }));
    expect(prisma.asset.findFirst).toHaveBeenCalledWith({
      where: { id: assetId, isActive: true, areaId },
    });
    expect(prisma.issue.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ roomId: null, areaId, customAreaName: null, assetId }),
    }));
  });

  it("accepts a secure block QR token for issue submission inside that block", async () => {
    const { service, prisma, tx } = setup();
    const roomId = "00000000-0000-0000-0000-000000000020";
    const categoryId = "00000000-0000-0000-0000-000000000021";
    const blockId = "00000000-0000-0000-0000-000000000024";
    const qrToken = "QR_abcdefghijklmnopqrstuvwxyz1234567890ABCDEFG";
    const duplicate = { id: "00000000-0000-0000-0000-000000000022", issueNumber: "ISS-2026-000022", title: "Fan stopped", status: "ASSIGNED", affectedUserCount: 1 };
    prisma.room.findFirst.mockResolvedValue({
      id: roomId,
      qrToken: "11111111-1111-4111-8111-111111111111",
      departmentId: null,
      roomType: "CLASSROOM",
      floorId: "00000000-0000-0000-0000-000000000023",
      floor: {
        id: "00000000-0000-0000-0000-000000000023",
        blockId,
        block: { id: blockId, campusId: "00000000-0000-0000-0000-000000000025", campus: { id: "00000000-0000-0000-0000-000000000025" } },
      },
    });
    prisma.issueCategory.findFirst.mockResolvedValue({ id: categoryId });
    prisma.qrCode.findUnique.mockResolvedValue({
      collegeId: user.collegeId,
      qrType: "BLOCK",
      entityId: blockId,
      status: "ACTIVE",
      expiryDate: null,
    });
    prisma.issue.findFirst.mockResolvedValue(duplicate);
    tx.issueAffectedUser.findUnique.mockResolvedValue(null);
    tx.issue.update.mockResolvedValue({ ...duplicate, occurrenceCount: 2 });
    tx.notification.create.mockResolvedValue({ id: "00000000-0000-4000-8000-000000000026" });

    await expect(
      service.create(
        user,
        { roomId, categoryId, title: "Fan stopped", description: "The ceiling fan has stopped.", submissionSource: "QR_SCAN", qrToken },
        "idempotency-key",
        { requestId: "request-1" },
      ),
    ).resolves.toEqual(expect.objectContaining({ linkedToExisting: true, occurrenceCount: 2 }));
    expect(prisma.qrCode.findUnique).toHaveBeenCalledWith({
      where: { secureTokenHash: createHash("sha256").update(qrToken).digest("hex") },
      select: { collegeId: true, qrType: true, entityId: true, status: true, expiryDate: true },
    });
  });

  it("rejects a secure block QR token when it does not match the selected room", async () => {
    const { service, prisma } = setup();
    const roomId = "00000000-0000-0000-0000-000000000020";
    const categoryId = "00000000-0000-0000-0000-000000000021";
    const qrToken = "QR_abcdefghijklmnopqrstuvwxyz1234567890ABCDEFG";
    prisma.room.findFirst.mockResolvedValue({
      id: roomId,
      qrToken: "11111111-1111-4111-8111-111111111111",
      departmentId: null,
      roomType: "CLASSROOM",
      floorId: "00000000-0000-0000-0000-000000000023",
      floor: {
        id: "00000000-0000-0000-0000-000000000023",
        blockId: "00000000-0000-0000-0000-000000000024",
        block: { id: "00000000-0000-0000-0000-000000000024", campusId: "00000000-0000-0000-0000-000000000025", campus: { id: "00000000-0000-0000-0000-000000000025" } },
      },
    });
    prisma.issueCategory.findFirst.mockResolvedValue({ id: categoryId });
    prisma.qrCode.findUnique.mockResolvedValue({
      collegeId: user.collegeId,
      qrType: "BLOCK",
      entityId: "00000000-0000-0000-0000-000000000099",
      status: "ACTIVE",
      expiryDate: null,
    });

    await expect(
      service.create(
        user,
        { roomId, categoryId, title: "Fan stopped", description: "The ceiling fan has stopped.", submissionSource: "QR_SCAN", qrToken },
        "idempotency-key",
        { requestId: "request-1" },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.issue.findFirst).not.toHaveBeenCalled();
  });

  it("requires a valid duplicate proof when the issue is not already visible", async () => {
    const { service, prisma, duplicateProofs } = setup();
    const issueId = "00000000-0000-4000-8000-000000000010";
    prisma.issue.findFirst.mockResolvedValueOnce({ id: issueId }).mockResolvedValueOnce(null);
    duplicateProofs.verify.mockReturnValue(false);

    await expect(service.subscribe(user, issueId)).rejects.toBeInstanceOf(ForbiddenException);
    expect(duplicateProofs.verify).toHaveBeenCalledWith(user.id, issueId, undefined);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("accepts a bound proof and subscribes idempotently", async () => {
    const { service, prisma, tx, duplicateProofs } = setup();
    const issueId = "00000000-0000-4000-8000-000000000010";
    prisma.issue.findFirst.mockResolvedValueOnce({ id: issueId }).mockResolvedValueOnce(null);
    duplicateProofs.verify.mockReturnValue(true);
    tx.issueAffectedUser.findUnique.mockResolvedValue(null);

    await expect(service.subscribe(user, issueId, "proof")).resolves.toEqual({ subscribed: true, alreadySubscribed: false });
    expect(tx.issueAffectedUser.create).toHaveBeenCalledWith({ data: { issueId, userId: user.id } });
    expect(tx.issue.update).toHaveBeenCalledWith({
      where: { id: issueId },
      data: expect.objectContaining({
        affectedUserCount: { increment: 1 },
        occurrenceCount: { increment: 1 },
        lastReportedAt: expect.any(Date),
      }),
    });
  });

  it("does not require a proof when the issue is already visible", async () => {
    const { service, prisma, tx, duplicateProofs } = setup();
    const issueId = "00000000-0000-4000-8000-000000000010";
    prisma.issue.findFirst.mockResolvedValueOnce({ id: issueId }).mockResolvedValueOnce({ id: issueId });
    tx.issueAffectedUser.findUnique.mockResolvedValue({ issueId, userId: user.id });

    await expect(service.subscribe(user, issueId)).resolves.toEqual({ subscribed: true, alreadySubscribed: true });
    expect(duplicateProofs.verify).not.toHaveBeenCalled();
    expect(tx.issueAffectedUser.create).not.toHaveBeenCalled();
  });

  it("uses an optimistic assignment update and creates delivery records", async () => {
    const { service, prisma, tx } = setup();
    const issueId = "00000000-0000-4000-8000-000000000010";
    const reporterId = "00000000-0000-4000-8000-000000000011";
    const assigneeId = "00000000-0000-4000-8000-000000000012";
    const issue = { id: issueId, collegeId: user.collegeId, version: 4, status: "NEEDS_MANUAL_ASSIGNMENT", assignedToId: null, reporterId, issueNumber: "ISS-2026-000010", priority: "MEDIUM" };
    prisma.issue.findFirst.mockResolvedValue(issue);
    prisma.user.findFirst.mockResolvedValue({ id: assigneeId });
    tx.issue.updateMany.mockResolvedValue({ count: 1 });
    tx.issue.findUniqueOrThrow.mockResolvedValue({ ...issue, version: 5, status: "ASSIGNED", assignedToId: assigneeId });
    tx.notification.create.mockResolvedValue({ id: "00000000-0000-4000-8000-000000000013" });

    await service.assign(user, issueId, { userId: assigneeId, reason: "Manual dispatch" }, { requestId: "request-1" });

    expect(tx.issue.updateMany).toHaveBeenCalledWith({
      where: { id: issueId, version: 4, status: "NEEDS_MANUAL_ASSIGNMENT" },
      data: { teamId: null, assignedToId: assigneeId, status: "ASSIGNED", version: { increment: 1 } },
    });
    expect(tx.notification.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: "ISSUE_ASSIGNED", recipients: { create: [{ userId: reporterId }, { userId: assigneeId }] } }),
    }));
    expect(tx.outboxEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ eventType: "issue.status_changed", idempotencyKey: `issue.assigned:${issueId}:5` }),
    }));
  });
});
