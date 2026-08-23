import { ConfigService } from "@nestjs/config";
import type { AuthPrincipal } from "../src/common/http/request-context";
import { PERMISSIONS_KEY } from "../src/common/decorators/permissions.decorator";
import { PrismaService } from "../src/database/prisma.service";
import { AccountStatus } from "../src/generated/prisma/enums";
import { AuditService } from "../src/modules/audit/audit.service";
import { SectionPlacementService } from "../src/modules/academic/section-placement.service";
import { OfficialGroupsService } from "../src/modules/conversations/official-groups.service";
import { UsersService } from "../src/modules/users/users.service";
import { UsersController } from "../src/modules/users/users.controller";

const actor: AuthPrincipal = {
  id: "admin-id",
  publicId: "admin-public-id",
  collegeId: "college-id",
  fullName: "Main Admin",
  email: "admin@college.edu",
  status: AccountStatus.ACTIVE,
  mustChangePassword: false,
  sessionId: "session-id",
  roles: ["MAIN_ADMIN"],
  permissions: ["users.read", "users.update"],
  scopes: [{ type: "COLLEGE", id: "college-id", issueCategoryId: null }],
};

function serviceWith(
  prisma: Record<string, unknown>,
  audit = { record: jest.fn() },
) {
  return {
    service: new UsersService(
      prisma as unknown as PrismaService,
      { get: jest.fn() } as unknown as ConfigService,
      audit as unknown as AuditService,
      { synchronizeCollege: jest.fn() } as unknown as OfficialGroupsService,
      {} as SectionPlacementService,
    ),
    audit,
  };
}

describe("UsersService People management", () => {
  it("requires the dedicated update permission for admin People edits", () => {
    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        UsersController.prototype.adminUpdate,
      ),
    ).toEqual(["users.update"]);
  });

  it("filters students through their relational assigned classroom", async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = {
      user: { findMany, count: jest.fn().mockResolvedValue(0) },
      campus: { findMany: jest.fn().mockResolvedValue([]) },
      block: { findMany: jest.fn().mockResolvedValue([]) },
      floor: { findMany: jest.fn().mockResolvedValue([]) },
      room: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn(async (operations: Array<Promise<unknown>>) =>
        Promise.all(operations),
      ),
    };
    const { service } = serviceWith(prisma);

    await service.list(actor, 1, 25, undefined, { roomId: "room-id" });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            expect.objectContaining({
              OR: expect.arrayContaining([
                { studentProfile: { section: { assignedRoomId: "room-id" } } },
              ]),
            }),
          ]),
        }),
      }),
    );
  });

  it("returns each section's assigned classroom in academic edit options", async () => {
    const sectionFindMany = jest.fn().mockResolvedValue([
      {
        id: "section-id",
        code: "A",
        name: "Section A",
        semesterId: "semester-id",
        studyYear: 2,
        capacity: 70,
        assignedRoom: { code: "CSE-201", name: "Second Year CSE" },
        _count: { memberships: 20 },
      },
    ]);
    const prisma = {
      campus: { findMany: jest.fn().mockResolvedValue([]) },
      department: { findMany: jest.fn().mockResolvedValue([]) },
      programme: { findMany: jest.fn().mockResolvedValue([]) },
      academicYear: { findMany: jest.fn().mockResolvedValue([]) },
      semester: { findMany: jest.fn().mockResolvedValue([]) },
      section: { findMany: sectionFindMany },
      block: { findMany: jest.fn().mockResolvedValue([]) },
      floor: { findMany: jest.fn().mockResolvedValue([]) },
      room: { findMany: jest.fn().mockResolvedValue([]) },
      issueCategory: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn(async (operations: Array<Promise<unknown>>) =>
        Promise.all(operations),
      ),
    };
    const { service } = serviceWith(prisma);

    const result = await service.scopeOptions(actor);

    expect(sectionFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          assignedRoom: { select: { code: true, name: true } },
        }),
      }),
    );
    expect(result.sections).toEqual([
      expect.objectContaining({
        id: "section-id",
        assignedRoom: { code: "CSE-201", name: "Second Year CSE" },
      }),
    ]);
  });

  it("updates a matching imported student ID with the account ID atomically", async () => {
    const target = {
      id: "user-id",
      collegeIdentityId: "AVS001",
      fullName: "Old Name",
      email: null,
      normalizedEmail: null,
      mobile: null,
      whatsappNumber: null,
      status: "ACTIVE",
      studentProfile: { id: "profile-id", studentId: "AVS001" },
      roles: [{ role: { code: "STUDENT" } }],
    };
    const tx = {
      $queryRawUnsafe: jest.fn().mockResolvedValue([]),
      user: {
        update: jest.fn().mockResolvedValue({
          publicId: "public-id",
          collegeIdentityId: "AVS002",
          fullName: "Updated Name",
          email: null,
          mobile: "9876543210",
          whatsappNumber: null,
          updatedAt: new Date(),
        }),
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(target)
          .mockResolvedValueOnce({
            roles: [
              {
                role: {
                  code: "MAIN_ADMIN",
                  permissions: [{ permission: { code: "users.update" } }],
                },
              },
            ],
          })
          .mockResolvedValueOnce(null),
      },
      studentProfile: {
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const prisma = {
      user: {
        findFirst: jest.fn().mockResolvedValue(target),
      },
      $transaction: jest.fn(async (work: (client: typeof tx) => unknown) =>
        work(tx),
      ),
    };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const { service } = serviceWith(prisma, audit);

    await service.updateBasic(
      actor,
      "public-id",
      {
        collegeIdentityId: "AVS002",
        fullName: "Updated Name",
        mobile: "9876543210",
      },
      "request-id",
    );

    expect(tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ collegeIdentityId: "AVS002" }),
      }),
    );
    expect(tx.studentProfile.update).toHaveBeenCalledWith({
      where: { id: "profile-id" },
      data: { studentId: "AVS002" },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "user.updated", entityId: "user-id" }),
      tx,
    );
  });

  it("updates a staff department atomically after tenant and active-state validation", async () => {
    const previousDepartmentId = "00000000-0000-4000-8000-000000000010";
    const departmentId = "00000000-0000-4000-8000-000000000020";
    const target = {
      id: "staff-user-id",
      collegeIdentityId: "FAC001",
      fullName: "Faculty Member",
      email: "faculty@college.edu",
      normalizedEmail: "faculty@college.edu",
      mobile: null,
      whatsappNumber: null,
      status: "ACTIVE",
      studentProfile: null,
      staffProfile: {
        id: "staff-profile-id",
        departmentId: previousDepartmentId,
      },
      roles: [{ role: { code: "FACULTY" } }],
    };
    const saved = {
      publicId: "staff-public-id",
      collegeIdentityId: "FAC001",
      fullName: "Faculty Member",
      email: "faculty@college.edu",
      mobile: null,
      whatsappNumber: null,
      updatedAt: new Date(),
    };
    const tx = {
      $queryRawUnsafe: jest.fn().mockResolvedValue([]),
      user: {
        update: jest.fn().mockResolvedValue(saved),
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(target)
          .mockResolvedValueOnce({
            roles: [
              {
                role: {
                  code: "MAIN_ADMIN",
                  permissions: [{ permission: { code: "users.update" } }],
                },
              },
            ],
          }),
      },
      department: {
        findFirst: jest.fn().mockResolvedValue({ id: departmentId }),
      },
      staffProfile: { update: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      user: { findFirst: jest.fn().mockResolvedValue(target) },
      $transaction: jest.fn(async (work: (client: typeof tx) => unknown) =>
        work(tx),
      ),
    };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const { service } = serviceWith(prisma, audit);

    await service.updateBasic(
      actor,
      "staff-public-id",
      { departmentId },
      "request-department-update",
    );

    expect(tx.department.findFirst).toHaveBeenCalledWith({
      where: {
        id: departmentId,
        collegeId: actor.collegeId,
        isActive: true,
        archivedAt: null,
      },
      select: { id: true },
    });
    expect(tx.staffProfile.update).toHaveBeenCalledWith({
      where: { id: "staff-profile-id" },
      data: { departmentId },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "user.updated",
        entityId: "staff-user-id",
        beforeValue: expect.objectContaining({
          staffProfile: { id: "staff-profile-id", departmentId: previousDepartmentId },
        }),
        afterValue: expect.objectContaining({
          staffProfile: { departmentId },
        }),
      }),
      tx,
    );
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
    });
  });

  it("rejects a staff department that is inactive or belongs to another college", async () => {
    const target = {
      id: "staff-user-id",
      collegeIdentityId: "FAC001",
      fullName: "Faculty Member",
      email: null,
      normalizedEmail: null,
      mobile: null,
      whatsappNumber: null,
      status: "ACTIVE",
      studentProfile: null,
      staffProfile: { id: "staff-profile-id", departmentId: null },
      roles: [{ role: { code: "FACULTY" } }],
    };
    const tx = {
      $queryRawUnsafe: jest.fn().mockResolvedValue([]),
      user: {
        update: jest.fn(),
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(target)
          .mockResolvedValueOnce({
            roles: [
              {
                role: {
                  code: "MAIN_ADMIN",
                  permissions: [{ permission: { code: "users.update" } }],
                },
              },
            ],
          }),
      },
      department: { findFirst: jest.fn().mockResolvedValue(null) },
      staffProfile: { update: jest.fn() },
    };
    const prisma = {
      user: { findFirst: jest.fn().mockResolvedValue(target) },
      $transaction: jest.fn(async (work: (client: typeof tx) => unknown) =>
        work(tx),
      ),
    };
    const audit = { record: jest.fn() };
    const { service } = serviceWith(prisma, audit);
    const departmentId = "00000000-0000-4000-8000-000000000099";

    await expect(
      service.updateBasic(
        actor,
        "staff-public-id",
        { departmentId },
        "request-invalid-department",
      ),
    ).rejects.toThrow("Staff department is not active in this college.");

    expect(tx.department.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: departmentId,
          collegeId: actor.collegeId,
          isActive: true,
          archivedAt: null,
        }),
      }),
    );
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.staffProfile.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("rechecks the live update permission before changing a staff department", async () => {
    const target = {
      id: "staff-user-id",
      collegeIdentityId: "FAC001",
      fullName: "Faculty Member",
      email: null,
      normalizedEmail: null,
      mobile: null,
      whatsappNumber: null,
      status: "ACTIVE",
      studentProfile: null,
      staffProfile: { id: "staff-profile-id", departmentId: null },
      roles: [{ role: { code: "FACULTY" } }],
    };
    const tx = {
      $queryRawUnsafe: jest.fn().mockResolvedValue([]),
      user: {
        update: jest.fn(),
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(target)
          .mockResolvedValueOnce({
            roles: [
              {
                role: {
                  code: "MAIN_ADMIN",
                  permissions: [],
                },
              },
            ],
          }),
      },
      department: { findFirst: jest.fn() },
      staffProfile: { update: jest.fn() },
    };
    const prisma = {
      user: { findFirst: jest.fn().mockResolvedValue(target) },
      $transaction: jest.fn(async (work: (client: typeof tx) => unknown) =>
        work(tx),
      ),
    };
    const { service } = serviceWith(prisma);

    await expect(
      service.updateBasic(
        actor,
        "staff-public-id",
        { departmentId: "00000000-0000-4000-8000-000000000020" },
        "request-stale-permission",
      ),
    ).rejects.toThrow(
      "Your administrative permissions have changed. Sign in again.",
    );

    expect(tx.department.findFirst).not.toHaveBeenCalled();
    expect(tx.staffProfile.update).not.toHaveBeenCalled();
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it.each([
    ["SUPER_ADMIN", "above"],
    ["MAIN_ADMIN", "equal"],
  ])(
    "denies a Main Admin editing a %s account at an %s rank",
    async (targetRole) => {
      const target = {
        id: "protected-user-id",
        collegeIdentityId: "PROTECTED001",
        fullName: "Protected Admin",
        email: "protected@college.edu",
        normalizedEmail: "protected@college.edu",
        mobile: null,
        whatsappNumber: null,
        status: "ACTIVE",
        studentProfile: null,
        roles: [{ role: { code: targetRole } }],
      };
      const prisma = {
        user: { findFirst: jest.fn().mockResolvedValue(target) },
        $transaction: jest.fn(),
      };
      const { service } = serviceWith(prisma);

      await expect(
        service.updateBasic(
          actor,
          "protected-public-id",
          { email: "attacker-controlled@example.com" },
          "request-protected",
        ),
      ).rejects.toThrow(
        "You cannot edit an account at or above your administrative level.",
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    },
  );

  it("denies an unranked custom administrator editing another unranked account", async () => {
    const customActor = { ...actor, roles: ["CUSTOM_ADMIN"] };
    const target = {
      id: "custom-target-id",
      collegeIdentityId: "CUSTOM001",
      fullName: "Custom Account",
      email: null,
      normalizedEmail: null,
      mobile: null,
      whatsappNumber: null,
      status: "ACTIVE",
      studentProfile: null,
      roles: [{ role: { code: "CUSTOM_ROLE" } }],
    };
    const prisma = {
      user: { findFirst: jest.fn().mockResolvedValue(target) },
      $transaction: jest.fn(),
    };
    const { service } = serviceWith(prisma);

    await expect(
      service.updateBasic(
        customActor,
        "custom-target-public-id",
        { email: "unsafe@example.com" },
        "request-custom-rank",
      ),
    ).rejects.toThrow(
      "You cannot edit an account at or above your administrative level.",
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("blocks the add-then-remove role path against a Super Admin account", async () => {
    const target = {
      id: "protected-super-id",
      publicId: "protected-super-public-id",
      status: AccountStatus.ACTIVE,
      archivedAt: null,
      roles: [
        {
          id: "super-assignment-id",
          roleId: "super-role-id",
          validFrom: new Date("2020-01-01T00:00:00.000Z"),
          validUntil: null,
          isPrimary: true,
          role: {
            id: "super-role-id",
            code: "SUPER_ADMIN",
            isActive: true,
          },
        },
        {
          id: "student-assignment-id",
          roleId: "student-role-id",
          validFrom: new Date("2020-01-01T00:00:00.000Z"),
          validUntil: null,
          isPrimary: false,
          role: {
            id: "student-role-id",
            code: "STUDENT",
            isActive: true,
          },
        },
      ],
      scopes: [],
    };
    const prisma = {
      user: { findFirst: jest.fn().mockResolvedValue(target) },
      role: { findFirst: jest.fn() },
      $transaction: jest.fn(),
    };
    const { service } = serviceWith(prisma);

    await expect(
      service.addRole(
        actor,
        target.publicId,
        { roleCode: "STUDENT", reason: "Attempt privilege bypass" },
        "request-add-bypass",
      ),
    ).rejects.toThrow(
      "You cannot edit an account at or above your administrative level.",
    );
    await expect(
      service.removeRole(
        actor,
        target.publicId,
        "SUPER_ADMIN",
        { reason: "Attempt privilege bypass" },
        "request-remove-bypass",
      ),
    ).rejects.toThrow(
      "You cannot edit an account at or above your administrative level.",
    );
    expect(prisma.role.findFirst).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    ["MAIN_ADMIN", ["MAIN_ADMIN", "STUDENT"]],
    ["STUDENT", ["FACULTY", "STUDENT"]],
  ])(
    "denies %s removing a role from an equal or higher-ranked account",
    async (actorRole, targetRoleCodes) => {
      const restrictedActor = { ...actor, roles: [actorRole] };
      const target = {
        id: "restricted-target-id",
        publicId: "restricted-target-public-id",
        status: AccountStatus.ACTIVE,
        roles: targetRoleCodes.map((code, index) => ({
          id: `assignment-${index}`,
          roleId: `role-${index}`,
          validFrom: new Date("2020-01-01T00:00:00.000Z"),
          validUntil: null,
          isPrimary: index === 0,
          role: { id: `role-${index}`, code, isActive: true },
        })),
        scopes: [],
      };
      const prisma = {
        user: { findFirst: jest.fn().mockResolvedValue(target) },
        $transaction: jest.fn(),
      };
      const { service } = serviceWith(prisma);

      await expect(
        service.removeRole(
          restrictedActor,
          target.publicId,
          targetRoleCodes[0]!,
          { reason: "Unauthorized role removal" },
          "request-rank-denial",
        ),
      ).rejects.toThrow(
        "You cannot edit an account at or above your administrative level.",
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    },
  );

  it("prevents removal of the last active Super Admin role", async () => {
    const superActor = {
      ...actor,
      id: "other-super-id",
      roles: ["SUPER_ADMIN"],
    };
    const target = {
      id: "last-super-id",
      publicId: "last-super-public-id",
      status: AccountStatus.ACTIVE,
      archivedAt: null,
      roles: [
        {
          id: "super-assignment-id",
          roleId: "super-role-id",
          validFrom: new Date("2020-01-01T00:00:00.000Z"),
          validUntil: null,
          isPrimary: true,
          role: {
            id: "super-role-id",
            code: "SUPER_ADMIN",
            isActive: true,
          },
        },
        {
          id: "student-assignment-id",
          roleId: "student-role-id",
          validFrom: new Date("2020-01-01T00:00:00.000Z"),
          validUntil: null,
          isPrimary: false,
          role: {
            id: "student-role-id",
            code: "STUDENT",
            isActive: true,
          },
        },
      ],
      scopes: [],
    };
    const tx = {
      $queryRawUnsafe: jest
        .fn()
        .mockResolvedValue([{ id: superActor.id }, { id: target.id }]),
      user: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({
            roles: [
              {
                role: {
                  code: "SUPER_ADMIN",
                  permissions: [{ permission: { code: "roles.manage" } }],
                },
              },
            ],
          })
          .mockResolvedValueOnce(target),
        count: jest.fn().mockResolvedValue(0),
      },
    };
    const prisma = {
      user: { findFirst: jest.fn().mockResolvedValue(target) },
      $transaction: jest.fn(async (work: (client: typeof tx) => unknown) =>
        work(tx),
      ),
    };
    const { service } = serviceWith(prisma);

    await expect(
      service.removeRole(
        superActor,
        target.publicId,
        "SUPER_ADMIN",
        { reason: "Remove redundant administrator" },
        "request-last-super",
      ),
    ).rejects.toThrow("The last active Super Admin cannot lose that role.");
    expect(tx.user.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { not: target.id },
          status: AccountStatus.ACTIVE,
        }),
      }),
    );
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
    });
  });

  it("rechecks role rank under lock before removing an assignment", async () => {
    const initialTarget = {
      id: "role-race-target-id",
      publicId: "role-race-target-public-id",
      status: AccountStatus.ACTIVE,
      roles: [
        {
          id: "student-assignment-id",
          roleId: "student-role-id",
          validFrom: new Date("2020-01-01T00:00:00.000Z"),
          validUntil: null,
          isPrimary: true,
          role: {
            id: "student-role-id",
            code: "STUDENT",
            isActive: true,
          },
        },
        {
          id: "custom-assignment-id",
          roleId: "custom-role-id",
          validFrom: new Date("2020-01-01T00:00:00.000Z"),
          validUntil: null,
          isPrimary: false,
          role: {
            id: "custom-role-id",
            code: "CUSTOM_ROLE",
            isActive: true,
          },
        },
      ],
      scopes: [],
    };
    const lockedTarget = {
      ...initialTarget,
      roles: [
        ...initialTarget.roles,
        {
          id: "super-assignment-id",
          roleId: "super-role-id",
          validFrom: new Date("2020-01-01T00:00:00.000Z"),
          validUntil: null,
          isPrimary: false,
          role: {
            id: "super-role-id",
            code: "SUPER_ADMIN",
            isActive: true,
          },
        },
      ],
    };
    const tx = {
      $queryRawUnsafe: jest.fn().mockResolvedValue([]),
      user: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({
            roles: [
              {
                role: {
                  code: "MAIN_ADMIN",
                  permissions: [{ permission: { code: "roles.manage" } }],
                },
              },
            ],
          })
          .mockResolvedValueOnce(lockedTarget),
      },
    };
    const prisma = {
      user: { findFirst: jest.fn().mockResolvedValue(initialTarget) },
      $transaction: jest.fn(async (work: (client: typeof tx) => unknown) =>
        work(tx),
      ),
    };
    const { service } = serviceWith(prisma);

    await expect(
      service.removeRole(
        actor,
        initialTarget.publicId,
        "STUDENT",
        { reason: "Remove obsolete assignment" },
        "request-role-race",
      ),
    ).rejects.toThrow(
      "You cannot edit an account at or above your administrative level.",
    );
    expect(tx.$queryRawUnsafe).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
    });
  });

  it("rechecks protected-account rank under lock before changing status", async () => {
    const initialTarget = {
      id: "status-race-target-id",
      publicId: "status-race-target-public-id",
      collegeIdentityId: "STATUS001",
      status: AccountStatus.ACTIVE,
      roles: [{ role: { code: "STUDENT" } }],
      studentProfile: null,
    };
    const tx = {
      $queryRawUnsafe: jest.fn().mockResolvedValue([]),
      user: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({
            roles: [
              {
                role: {
                  code: "MAIN_ADMIN",
                  permissions: [{ permission: { code: "users.suspend" } }],
                },
              },
            ],
          })
          .mockResolvedValueOnce({
            ...initialTarget,
            roles: [{ role: { code: "SUPER_ADMIN" } }],
            sectionMemberships: [],
          }),
        update: jest.fn(),
      },
    };
    const prisma = {
      user: { findFirst: jest.fn().mockResolvedValue(initialTarget) },
      $transaction: jest.fn(async (work: (client: typeof tx) => unknown) =>
        work(tx),
      ),
    };
    const { service } = serviceWith(prisma);

    await expect(
      service.status(
        actor,
        initialTarget.publicId,
        {
          status: AccountStatus.SUSPENDED,
          reason: "Administrative suspension",
        },
        "request-status-race",
      ),
    ).rejects.toThrow(
      "You cannot change the status of an account at or above your administrative level.",
    );
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
    });
  });

  it("rechecks last-active-Super protection inside a status transaction", async () => {
    const superActor = {
      ...actor,
      id: "status-super-actor-id",
      roles: ["SUPER_ADMIN"],
      permissions: ["users.suspend"],
    };
    const target = {
      id: "last-status-super-id",
      publicId: "last-status-super-public-id",
      collegeIdentityId: "SUPER001",
      status: AccountStatus.ACTIVE,
      roles: [{ role: { code: "SUPER_ADMIN" } }],
      studentProfile: null,
    };
    const tx = {
      $queryRawUnsafe: jest.fn().mockResolvedValue([]),
      user: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({
            roles: [
              {
                role: {
                  code: "SUPER_ADMIN",
                  permissions: [{ permission: { code: "users.suspend" } }],
                },
              },
            ],
          })
          .mockResolvedValueOnce({
            ...target,
            sectionMemberships: [],
          }),
        count: jest.fn().mockResolvedValue(0),
        update: jest.fn(),
      },
    };
    const prisma = {
      user: {
        findFirst: jest.fn().mockResolvedValue(target),
        count: jest.fn().mockResolvedValue(1),
      },
      $transaction: jest.fn(async (work: (client: typeof tx) => unknown) =>
        work(tx),
      ),
    };
    const { service } = serviceWith(prisma);

    await expect(
      service.status(
        superActor,
        target.publicId,
        {
          status: AccountStatus.SUSPENDED,
          reason: "Administrative suspension",
        },
        "request-last-status-super",
      ),
    ).rejects.toThrow("The last active Super Admin cannot be deactivated.");
    expect(prisma.user.count).toHaveBeenCalledTimes(1);
    expect(tx.user.count).toHaveBeenCalledTimes(1);
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it("rechecks protected-account rank under lock before resetting a password", async () => {
    const initialTarget = {
      id: "password-race-target-id",
      publicId: "password-race-target-public-id",
      collegeIdentityId: "PASSWORD001",
      fullName: "Password Target",
      status: AccountStatus.ACTIVE,
      roles: [{ role: { code: "STUDENT" } }],
    };
    const tx = {
      $queryRawUnsafe: jest.fn().mockResolvedValue([]),
      user: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({
            roles: [
              {
                role: {
                  code: "MAIN_ADMIN",
                  permissions: [
                    { permission: { code: "users.reset_password" } },
                  ],
                },
              },
            ],
          })
          .mockResolvedValueOnce({
            ...initialTarget,
            roles: [{ role: { code: "SUPER_ADMIN" } }],
          }),
        update: jest.fn(),
      },
      userCredential: { upsert: jest.fn() },
    };
    const prisma = {
      user: { findFirst: jest.fn().mockResolvedValue(initialTarget) },
      $transaction: jest.fn(async (work: (client: typeof tx) => unknown) =>
        work(tx),
      ),
    };
    const { service } = serviceWith(prisma);

    await expect(
      service.resetPassword(
        actor,
        initialTarget.publicId,
        {
          temporaryPassword: "ValidTemp@123",
          reason: "Requested password reset",
        },
        "request-password-race",
      ),
    ).rejects.toThrow(
      "You cannot reset a password for an account at or above your administrative level.",
    );
    expect(tx.userCredential.upsert).not.toHaveBeenCalled();
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
    });
  });

  it("rechecks protected-account rank under lock before replacing access", async () => {
    const activeSince = new Date("2020-01-01T00:00:00.000Z");
    const studentRole = {
      id: "student-role-id",
      code: "STUDENT",
      isActive: true,
      permissions: [],
    };
    const initialTarget = {
      id: "access-race-target-id",
      publicId: "access-race-target-public-id",
      status: AccountStatus.ACTIVE,
      archivedAt: null,
      roles: [
        {
          id: "student-assignment-id",
          roleId: studentRole.id,
          validFrom: activeSince,
          validUntil: null,
          role: studentRole,
        },
      ],
      scopes: [],
    };
    const lockedTarget = {
      ...initialTarget,
      roles: [
        ...initialTarget.roles,
        {
          id: "super-assignment-id",
          roleId: "super-role-id",
          validFrom: activeSince,
          validUntil: null,
          role: {
            id: "super-role-id",
            code: "SUPER_ADMIN",
            isActive: true,
          },
        },
      ],
    };
    const tx = {
      $queryRawUnsafe: jest.fn().mockResolvedValue([]),
      user: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({
            roles: [
              {
                role: {
                  code: "MAIN_ADMIN",
                  permissions: [
                    { permission: { code: "roles.manage" } },
                    { permission: { code: "scopes.manage" } },
                  ],
                },
              },
            ],
          })
          .mockResolvedValueOnce(lockedTarget),
      },
      userRole: { deleteMany: jest.fn() },
    };
    const prisma = {
      user: { findFirst: jest.fn().mockResolvedValue(initialTarget) },
      role: { findMany: jest.fn().mockResolvedValue([studentRole]) },
      $transaction: jest.fn(async (work: (client: typeof tx) => unknown) =>
        work(tx),
      ),
    };
    const accessActor = {
      ...actor,
      permissions: ["roles.manage", "scopes.manage"],
    };
    const { service } = serviceWith(prisma);

    await expect(
      service.updateAccess(
        accessActor,
        initialTarget.publicId,
        {
          roleCodes: ["STUDENT"],
          scopes: [{ type: "ASSIGNED_ISSUES" }],
          reason: "Refresh student access",
        },
        "request-access-race",
      ),
    ).rejects.toThrow(
      "You cannot change access for an account at or above your administrative level.",
    );
    expect(tx.userRole.deleteMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
    });
  });

  it("rechecks last-active-Super protection inside an access transaction", async () => {
    const activeSince = new Date("2020-01-01T00:00:00.000Z");
    const studentRole = {
      id: "student-role-id",
      code: "STUDENT",
      isActive: true,
      permissions: [],
    };
    const target = {
      id: "last-access-super-id",
      publicId: "last-access-super-public-id",
      status: AccountStatus.ACTIVE,
      archivedAt: null,
      roles: [
        {
          id: "super-assignment-id",
          roleId: "super-role-id",
          validFrom: activeSince,
          validUntil: null,
          role: {
            id: "super-role-id",
            code: "SUPER_ADMIN",
            isActive: true,
          },
        },
        {
          id: "student-assignment-id",
          roleId: studentRole.id,
          validFrom: activeSince,
          validUntil: null,
          role: studentRole,
        },
      ],
      scopes: [],
    };
    const superActor = {
      ...actor,
      id: "super-actor-id",
      roles: ["SUPER_ADMIN"],
      permissions: ["roles.manage", "scopes.manage"],
    };
    const tx = {
      $queryRawUnsafe: jest.fn().mockResolvedValue([]),
      user: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({
            roles: [
              {
                role: {
                  code: "SUPER_ADMIN",
                  permissions: [
                    { permission: { code: "roles.manage" } },
                    { permission: { code: "scopes.manage" } },
                  ],
                },
              },
            ],
          })
          .mockResolvedValueOnce(target),
        count: jest.fn().mockResolvedValue(0),
      },
      role: { findMany: jest.fn().mockResolvedValue([studentRole]) },
      userRole: { deleteMany: jest.fn() },
    };
    const prisma = {
      user: { findFirst: jest.fn().mockResolvedValue(target) },
      role: { findMany: jest.fn().mockResolvedValue([studentRole]) },
      $transaction: jest.fn(async (work: (client: typeof tx) => unknown) =>
        work(tx),
      ),
    };
    const { service } = serviceWith(prisma);

    await expect(
      service.updateAccess(
        superActor,
        target.publicId,
        {
          roleCodes: ["STUDENT"],
          scopes: [{ type: "ASSIGNED_ISSUES" }],
          reason: "Remove redundant Super access",
        },
        "request-last-access-super",
      ),
    ).rejects.toThrow("The last active Super Admin cannot lose that role.");
    expect(tx.user.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { not: target.id },
          status: AccountStatus.ACTIVE,
          archivedAt: null,
        }),
      }),
    );
    expect(tx.userRole.deleteMany).not.toHaveBeenCalled();
  });

  it("rejects a role mutation after the actor loses roles.manage", async () => {
    const activeSince = new Date("2020-01-01T00:00:00.000Z");
    const target = {
      id: "permission-race-target-id",
      publicId: "permission-race-target-public-id",
      status: AccountStatus.ACTIVE,
      roles: [
        {
          id: "student-assignment-id",
          roleId: "student-role-id",
          validFrom: activeSince,
          validUntil: null,
          isPrimary: true,
          role: {
            id: "student-role-id",
            code: "STUDENT",
            isActive: true,
          },
        },
        {
          id: "custom-assignment-id",
          roleId: "custom-role-id",
          validFrom: activeSince,
          validUntil: null,
          isPrimary: false,
          role: {
            id: "custom-role-id",
            code: "CUSTOM_ROLE",
            isActive: true,
          },
        },
      ],
      scopes: [],
    };
    const tx = {
      $queryRawUnsafe: jest.fn().mockResolvedValue([]),
      user: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({
            roles: [
              {
                role: { code: "MAIN_ADMIN", permissions: [] },
              },
            ],
          })
          .mockResolvedValueOnce(target),
      },
      userRole: { delete: jest.fn() },
    };
    const prisma = {
      user: { findFirst: jest.fn().mockResolvedValue(target) },
      $transaction: jest.fn(async (work: (client: typeof tx) => unknown) =>
        work(tx),
      ),
    };
    const { service } = serviceWith(prisma);

    await expect(
      service.removeRole(
        actor,
        target.publicId,
        "CUSTOM_ROLE",
        { reason: "Remove custom access" },
        "request-permission-race",
      ),
    ).rejects.toThrow(
      "Your administrative permissions have changed. Sign in again.",
    );
    expect(tx.userRole.delete).not.toHaveBeenCalled();
  });

  it("rechecks target and actor rank after locking before saving identity fields", async () => {
    const initialTarget = {
      id: "target-id",
      collegeIdentityId: "STUDENT001",
      fullName: "Student One",
      email: null,
      normalizedEmail: null,
      mobile: null,
      whatsappNumber: null,
      status: "ACTIVE",
      studentProfile: null,
      roles: [{ role: { code: "STUDENT" } }],
    };
    const tx = {
      $queryRawUnsafe: jest.fn().mockResolvedValue([]),
      user: {
        update: jest.fn(),
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({
            ...initialTarget,
            roles: [{ role: { code: "SUPER_ADMIN" } }],
          })
          .mockResolvedValueOnce({
            roles: [
              {
                role: {
                  code: "MAIN_ADMIN",
                  permissions: [{ permission: { code: "users.update" } }],
                },
              },
            ],
          }),
      },
    };
    const prisma = {
      user: { findFirst: jest.fn().mockResolvedValue(initialTarget) },
      $transaction: jest.fn(async (work: (client: typeof tx) => unknown) =>
        work(tx),
      ),
    };
    const { service } = serviceWith(prisma);

    await expect(
      service.updateBasic(
        actor,
        "target-public-id",
        { email: "unsafe@example.com" },
        "request-race",
      ),
    ).rejects.toThrow(
      "You cannot edit an account at or above your administrative level.",
    );
    expect(tx.$queryRawUnsafe).toHaveBeenCalledTimes(1);
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
    });
  });

  it("denies a Main Admin revoking a Super Admin's sessions under lock", async () => {
    const target = {
      id: "super-session-target-id",
      publicId: "super-session-target-public-id",
      fullName: "Protected Super Admin",
    };
    const tx = {
      $queryRawUnsafe: jest.fn().mockResolvedValue([]),
      user: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({
            roles: [
              {
                role: {
                  code: "MAIN_ADMIN",
                  permissions: [
                    { permission: { code: "sessions.revoke_any" } },
                  ],
                },
              },
            ],
          })
          .mockResolvedValueOnce({
            id: target.id,
            publicId: target.publicId,
            roles: [{ role: { code: "SUPER_ADMIN" } }],
          }),
      },
      session: { count: jest.fn(), updateMany: jest.fn() },
      refreshToken: { updateMany: jest.fn() },
    };
    const prisma = {
      user: { findFirst: jest.fn().mockResolvedValue(target) },
      $transaction: jest.fn(async (work: (client: typeof tx) => unknown) =>
        work(tx),
      ),
    };
    const revokeActor = {
      ...actor,
      permissions: ["sessions.revoke_any"],
    };
    const { service } = serviceWith(prisma);

    await expect(
      service.revokeSessions(
        revokeActor,
        target.publicId,
        "Security response",
        "request-revoke-super",
      ),
    ).rejects.toThrow(
      "You cannot revoke sessions for an account at or above your administrative level.",
    );
    expect(tx.$queryRawUnsafe).toHaveBeenCalledTimes(1);
    expect(tx.session.count).not.toHaveBeenCalled();
    expect(tx.session.updateMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
    });
  });

  it("rejects session revocation after the actor loses sessions.revoke_any", async () => {
    const target = {
      id: "student-session-target-id",
      publicId: "student-session-target-public-id",
      fullName: "Student Target",
    };
    const tx = {
      $queryRawUnsafe: jest.fn().mockResolvedValue([]),
      user: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({
            roles: [
              { role: { code: "MAIN_ADMIN", permissions: [] } },
            ],
          })
          .mockResolvedValueOnce({
            id: target.id,
            publicId: target.publicId,
            roles: [{ role: { code: "STUDENT" } }],
          }),
      },
      session: { count: jest.fn(), updateMany: jest.fn() },
      refreshToken: { updateMany: jest.fn() },
    };
    const prisma = {
      user: { findFirst: jest.fn().mockResolvedValue(target) },
      $transaction: jest.fn(async (work: (client: typeof tx) => unknown) =>
        work(tx),
      ),
    };
    const revokeActor = {
      ...actor,
      permissions: ["sessions.revoke_any"],
    };
    const { service } = serviceWith(prisma);

    await expect(
      service.revokeSessions(
        revokeActor,
        target.publicId,
        "Security response",
        "request-revoked-permission",
      ),
    ).rejects.toThrow(
      "Your administrative permissions have changed. Sign in again.",
    );
    expect(tx.$queryRawUnsafe).toHaveBeenCalledTimes(1);
    expect(tx.session.count).not.toHaveBeenCalled();
    expect(tx.session.updateMany).not.toHaveBeenCalled();
  });
});
