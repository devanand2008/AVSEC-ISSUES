import type { AuthPrincipal } from "../src/common/http/request-context";
import { ImportsService } from "../src/modules/imports/imports.service";

const jobId = "00000000-0000-4000-8000-000000000701";
const owner = {
  id: "00000000-0000-4000-8000-000000000702",
  collegeId: "00000000-0000-4000-8000-000000000703",
  permissions: ["users.import"],
  roles: ["MAIN_ADMIN"],
} as AuthPrincipal;

function serviceWith(dependencies: Record<string, unknown>): ImportsService {
  const service = Object.create(ImportsService.prototype) as ImportsService;
  Object.defineProperties(
    service,
    Object.fromEntries(
      Object.entries(dependencies).map(([property, value]) => [
        property,
        { value },
      ]),
    ),
  );
  return service;
}

describe("ImportsService read access boundaries", () => {
  it("combines current entity permissions with owner and audit visibility", async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = serviceWith({ prisma: { importJob: { findMany } } });

    await service.list(owner);
    await service.list({
      ...owner,
      permissions: ["users.import", "audit.read"],
    });

    expect(findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: {
          collegeId: owner.collegeId,
          entityType: {
            in: ["PEOPLE", "USERS", "STUDENTS", "STAFF"],
          },
          requestedById: owner.id,
        },
      }),
    );
    const auditWhere = findMany.mock.calls[1]?.[0]?.where as Record<
      string,
      unknown
    >;
    expect(auditWhere).toEqual(
      expect.objectContaining({
        collegeId: owner.collegeId,
        entityType: {
          in: ["PEOPLE", "USERS", "STUDENTS", "STAFF"],
        },
      }),
    );
    expect(auditWhere).not.toHaveProperty("requestedById");
  });

  it("rejects generic detail after the entity permission is revoked", async () => {
    const job = {
      id: jobId,
      collegeId: owner.collegeId,
      requestedById: owner.id,
      entityType: "PEOPLE",
    };
    const count = jest.fn();
    const service = serviceWith({
      prisma: {
        importJob: { findFirst: jest.fn().mockResolvedValue(job) },
        importJobRecord: { count },
      },
    });

    await expect(
      service.get({ ...owner, permissions: [] }, jobId),
    ).rejects.toThrow("You do not have permission to import this entity type.");
    expect(count).not.toHaveBeenCalled();
  });

  it("does not resolve a non-PEOPLE job through a People-scoped lookup", async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const service = serviceWith({
      prisma: { importJob: { findFirst } },
    });

    await expect(service.get(owner, jobId, "PEOPLE")).rejects.toThrow(
      "Import job not found.",
    );
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        id: jobId,
        collegeId: owner.collegeId,
        entityType: "PEOPLE",
        requestedById: owner.id,
      },
    });
  });

  it("limits People-scoped history to PEOPLE jobs", async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = serviceWith({ prisma: { importJob: { findMany } } });

    await service.list(owner, "PEOPLE");

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          collegeId: owner.collegeId,
          entityType: { in: ["PEOPLE"] },
          requestedById: owner.id,
        },
      }),
    );
  });

  it.each([
    [
      "confirm",
      (service: ImportsService) =>
        service.confirm(owner, jobId, "request-confirm", "PEOPLE"),
    ],
    [
      "cancel",
      (service: ImportsService) =>
        service.cancel(owner, jobId, "request-cancel", "PEOPLE"),
    ],
  ])("rejects a non-PEOPLE job before People-scoped %s", async (_name, run) => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const service = serviceWith({ prisma: { importJob: { findFirst } } });

    await expect(run(service)).rejects.toThrow("Import job not found.");
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        id: jobId,
        collegeId: owner.collegeId,
        entityType: "PEOPLE",
        requestedById: owner.id,
      },
    });
  });

  it("rejects generic history when no current import permission remains", async () => {
    const findMany = jest.fn();
    const service = serviceWith({ prisma: { importJob: { findMany } } });

    await expect(
      service.list({ ...owner, permissions: ["audit.read"] }),
    ).rejects.toThrow("You do not have permission to view import jobs.");
    expect(findMany).not.toHaveBeenCalled();
  });
});
