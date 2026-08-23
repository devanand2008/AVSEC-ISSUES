import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { Readable } from "node:stream";
import type { AuthPrincipal } from "../src/common/http/request-context";
import { PERMISSIONS_KEY } from "../src/common/decorators/permissions.decorator";
import { RoomType } from "../src/generated/prisma/enums";
import {
  AdminLocationListQueryDto,
  BulkLocationDto,
  CreateCampusDto,
  CreateRoomDto,
  PresignLocationImageDto,
  UpdateBlockDto,
  UpdateCampusDto,
  UpdateFloorDto,
  UpdateRoomDto,
} from "../src/modules/locations/dto/location.dto";
import { AdminLocationsController } from "../src/modules/locations/locations.controller";
import { LocationsService } from "../src/modules/locations/locations.service";
import { StorageService } from "../src/modules/storage/storage.service";

const collegeId = "00000000-0000-4000-8000-000000000003";
const campusId = "00000000-0000-4000-8000-000000000010";
const blockId = "00000000-0000-4000-8000-000000000011";
const floorId = "00000000-0000-4000-8000-000000000012";
const departmentId = "00000000-0000-4000-8000-000000000013";

function principal(overrides: Partial<AuthPrincipal> = {}): AuthPrincipal {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    publicId: "00000000-0000-4000-8000-000000000002",
    collegeId,
    fullName: "Main Admin",
    email: "admin@avs.edu.in",
    status: "ACTIVE",
    mustChangePassword: false,
    sessionId: "00000000-0000-4000-8000-000000000004",
    roles: ["MAIN_ADMIN"],
    permissions: ["locations.manage"],
    scopes: [],
    ...overrides,
  };
}

function location(overrides: Record<string, unknown> = {}) {
  return {
    id: campusId,
    collegeId,
    code: "MAIN",
    name: "Main Campus",
    isActive: true,
    archivedAt: null,
    isTestData: false,
    imageStorageKey: null,
    ...overrides,
  };
}

describe("campus setup backend", () => {
  it("protects every admin location route with locations.manage", () => {
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, AdminLocationsController),
    ).toEqual(["locations.manage"]);
  });

  it("validates paged filters and normalizes readable room types", async () => {
    const input = plainToInstance(AdminLocationListQueryDto, {
      page: "2",
      pageSize: "25",
      campusId,
      roomType: "Faculty Room",
      status: "ACTIVE",
    });

    await expect(validate(input)).resolves.toEqual([]);
    expect(input).toEqual(
      expect.objectContaining({
        page: 2,
        pageSize: 25,
        roomType: RoomType.FACULTY_ROOM,
      }),
    );
  });

  it("rejects unsupported image formats and oversized bulk location actions", async () => {
    const image = plainToInstance(PresignLocationImageDto, {
      fileName: "campus.gif",
      mimeType: "image/gif",
      sizeBytes: 1024,
    });
    const bulk = plainToInstance(BulkLocationDto, {
      ids: Array.from({ length: 101 }, () => campusId),
      reason: "Verified test cleanup",
    });

    await expect(validate(image)).resolves.not.toEqual([]);
    await expect(validate(bulk)).resolves.not.toEqual([]);
  });

  it("normalizes required names and codes before validation and rejects blanks", async () => {
    const valid = plainToInstance(CreateRoomDto, {
      floorId,
      code: "  cse-101  ",
      name: "  Computer Laboratory  ",
      roomType: "laboratory",
    });
    const blankCampus = plainToInstance(CreateCampusDto, {
      code: "   ",
      name: "   ",
    });

    await expect(validate(valid)).resolves.toEqual([]);
    expect(valid.code).toBe("cse-101");
    expect(valid.name).toBe("Computer Laboratory");
    await expect(validate(blankCampus)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ property: "code" }),
        expect.objectContaining({ property: "name" }),
      ]),
    );
  });

  it.each([
    [UpdateCampusDto, { code: null }],
    [UpdateCampusDto, { name: null }],
    [UpdateCampusDto, { isActive: null }],
    [UpdateBlockDto, { campusId: null }],
    [UpdateFloorDto, { blockId: null }],
    [UpdateFloorDto, { level: null }],
    [UpdateRoomDto, { floorId: null }],
    [UpdateRoomDto, { roomType: null }],
    [UpdateRoomDto, { sortOrder: null }],
  ])("rejects null for non-nullable update field %#", async (Dto, value) => {
    const input = plainToInstance(Dto, value);
    await expect(validate(input)).resolves.not.toEqual([]);
  });

  it("applies hierarchy, department, type, search and pagination on the server", async () => {
    const findMany = jest.fn().mockResolvedValue([{ id: "room-1" }]);
    const count = jest.fn().mockResolvedValue(31);
    const prisma = { room: { findMany, count } };
    const service = new LocationsService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.adminList(principal(), "room", {
        campusId,
        blockId,
        floorId,
        departmentId,
        roomType: RoomType.LABORATORY,
        search: "Computer Lab",
        status: "ACTIVE",
        page: 2,
        pageSize: 10,
      }),
    ).resolves.toEqual({
      data: [{ id: "room-1" }],
      meta: { page: 2, pageSize: 10, total: 31, pageCount: 4 },
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 10,
        take: 10,
        where: expect.objectContaining({
          floorId,
          departmentId,
          roomType: RoomType.LABORATORY,
          archivedAt: null,
          isActive: true,
          floor: expect.objectContaining({
            blockId,
            block: expect.objectContaining({
              campusId,
              campus: { collegeId },
            }),
          }),
          OR: expect.arrayContaining([
            { name: { contains: "Computer Lab", mode: "insensitive" } },
            {
              customRoomTypeLabel: {
                contains: "Computer Lab",
                mode: "insensitive",
              },
            },
          ]),
        }),
      }),
    );
    expect(count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ floorId, departmentId }),
      }),
    );
  });

  it("validates the complete active ancestor chain inside room creation transaction", async () => {
    const tx = {
      floor: { findFirst: jest.fn().mockResolvedValue(null) },
      department: { findFirst: jest.fn() },
      room: { create: jest.fn() },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    const service = new LocationsService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.createRoom(
        principal(),
        {
          floorId,
          departmentId,
          code: "LAB-101",
          name: "Computer Lab",
          roomType: RoomType.LABORATORY,
        },
        "request-1",
      ),
    ).rejects.toThrow("Active floor not found in your college.");
    expect(tx.room.create).not.toHaveBeenCalled();
  });

  it("requires and trims the custom label in direct OTHER room service calls", async () => {
    const tx = {
      floor: { findFirst: jest.fn().mockResolvedValue({ id: floorId }) },
      department: { findFirst: jest.fn() },
      room: {
        create: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({ id: "room-other", ...data }),
        ),
      },
    };
    const prisma = {
      $transaction: jest.fn(
        async (callback: (client: typeof tx) => Promise<unknown>) =>
          callback(tx),
      ),
    };
    const service = new LocationsService(
      prisma as never,
      {} as never,
      { record: jest.fn().mockResolvedValue(undefined) } as never,
      {} as never,
    );

    await expect(
      service.createRoom(
        principal(),
        {
          floorId,
          code: "INNOVATION",
          name: "Innovation Studio",
          roomType: RoomType.OTHER,
          customRoomTypeLabel: "  Innovation Studio  ",
        },
        "request-other",
      ),
    ).resolves.toEqual(
      expect.objectContaining({ customRoomTypeLabel: "Innovation Studio" }),
    );
    expect(tx.room.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          roomType: RoomType.OTHER,
          customRoomTypeLabel: "Innovation Studio",
        }),
      }),
    );

    await expect(
      service.createRoom(
        principal(),
        {
          floorId,
          code: "OTHER-BLANK",
          name: "Other Room",
          roomType: RoomType.OTHER,
        },
        "request-other-blank",
      ),
    ).rejects.toThrow("Custom room type label must be between 2 and 80 characters");
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it("clears a custom room type label when an OTHER room becomes standard", async () => {
    const existing = location({
      id: "room-other",
      floorId,
      roomType: RoomType.OTHER,
      customRoomTypeLabel: "Innovation Studio",
    });
    const tx = {
      room: {
        update: jest.fn().mockResolvedValue({
          ...existing,
          roomType: RoomType.CLASSROOM,
          customRoomTypeLabel: null,
        }),
      },
    };
    const prisma = {
      room: { findFirst: jest.fn().mockResolvedValue(existing) },
      $transaction: jest.fn(
        async (callback: (client: typeof tx) => Promise<unknown>) =>
          callback(tx),
      ),
    };
    const service = new LocationsService(
      prisma as never,
      {} as never,
      { record: jest.fn().mockResolvedValue(undefined) } as never,
      {} as never,
    );

    await expect(
      service.updateRoom(
        principal(),
        "room-other",
        { roomType: RoomType.CLASSROOM },
        "request-standard",
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        roomType: RoomType.CLASSROOM,
        customRoomTypeLabel: null,
      }),
    );
    expect(tx.room.update).toHaveBeenCalledWith({
      where: { id: "room-other" },
      data: {
        roomType: RoomType.CLASSROOM,
        customRoomTypeLabel: null,
      },
    });
  });

  it("preserves a backfilled OTHER label during an unrelated room update", async () => {
    const existing = location({
      id: "room-other",
      floorId,
      roomType: RoomType.OTHER,
      customRoomTypeLabel: "Other",
    });
    const tx = {
      room: {
        update: jest.fn().mockResolvedValue({
          ...existing,
          name: "Renamed Other Room",
        }),
      },
    };
    const prisma = {
      room: { findFirst: jest.fn().mockResolvedValue(existing) },
      $transaction: jest.fn(
        async (callback: (client: typeof tx) => Promise<unknown>) =>
          callback(tx),
      ),
    };
    const service = new LocationsService(
      prisma as never,
      {} as never,
      { record: jest.fn().mockResolvedValue(undefined) } as never,
      {} as never,
    );

    await expect(
      service.updateRoom(
        principal(),
        "room-other",
        { name: "Renamed Other Room" },
        "request-rename",
      ),
    ).resolves.toEqual(
      expect.objectContaining({ customRoomTypeLabel: "Other" }),
    );
    expect(tx.room.update).toHaveBeenCalledWith({
      where: { id: "room-other" },
      data: {
        name: "Renamed Other Room",
        customRoomTypeLabel: "Other",
      },
    });
  });

  it("reports floor areas as dependencies before permanent deletion", async () => {
    const prisma = {
      floor: {
        findFirst: jest
          .fn()
          .mockResolvedValue(location({ id: floorId, blockId })),
      },
      userScope: { count: jest.fn().mockResolvedValue(0) },
      announcementAudience: { count: jest.fn().mockResolvedValue(0) },
      qrCode: { count: jest.fn().mockResolvedValue(0) },
      conversation: { count: jest.fn().mockResolvedValue(0) },
      room: { count: jest.fn().mockResolvedValue(2) },
      area: { count: jest.fn().mockResolvedValue(3) },
      issue: { count: jest.fn().mockResolvedValue(0) },
      feedbackTarget: { count: jest.fn().mockResolvedValue(0) },
      issueAssignmentRule: { count: jest.fn().mockResolvedValue(0) },
    };
    const service = new LocationsService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.dependencyReport(principal(), "floor", floorId),
    ).resolves.toEqual(
      expect.objectContaining({
        canDelete: false,
        totalDependencies: 5,
        counts: expect.objectContaining({ rooms: 2, areas: 3 }),
        dependencies: expect.objectContaining({ rooms: 2, areas: 3 }),
      }),
    );
  });

  it("includes nested rooms and areas in a block dependency report", async () => {
    const prisma = {
      block: {
        findFirst: jest
          .fn()
          .mockResolvedValue(location({ id: blockId, campusId })),
      },
      userScope: { count: jest.fn().mockResolvedValue(0) },
      announcementAudience: { count: jest.fn().mockResolvedValue(0) },
      qrCode: { count: jest.fn().mockResolvedValue(0) },
      conversation: { count: jest.fn().mockResolvedValue(0) },
      floor: { count: jest.fn().mockResolvedValue(3) },
      room: { count: jest.fn().mockResolvedValue(24) },
      area: { count: jest.fn().mockResolvedValue(2) },
      issue: { count: jest.fn().mockResolvedValue(0) },
      feedbackTarget: { count: jest.fn().mockResolvedValue(0) },
      issueAssignmentRule: { count: jest.fn().mockResolvedValue(0) },
    };
    const service = new LocationsService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.dependencyReport(principal(), "block", blockId),
    ).resolves.toEqual(
      expect.objectContaining({
        canDelete: false,
        totalDependencies: 29,
        dependencies: expect.objectContaining({
          floors: 3,
          rooms: 24,
          areas: 2,
        }),
      }),
    );
    expect(prisma.room.count).toHaveBeenCalledWith({
      where: { floor: { blockId } },
    });
    expect(prisma.area.count).toHaveBeenCalledWith({
      where: { floor: { blockId } },
    });
  });

  it("refuses permanent deletion of active production locations", async () => {
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(0),
      campus: {
        findFirst: jest.fn().mockResolvedValue(location()),
        delete: jest.fn(),
      },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    const service = new LocationsService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.removePermanently(
        principal(),
        "campus",
        campusId,
        "No longer required",
        "PERMANENTLY DELETE LOCATION",
        "request-2",
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.campus.delete).not.toHaveBeenCalled();
  });

  it("replaces an image only after verification and removes the prior object after DB commit", async () => {
    const oldKey = `colleges/${collegeId}/campus-images/campuses/${campusId}/00000000-0000-4000-8000-000000000020.jpg`;
    const newKey = `colleges/${collegeId}/campus-images/campuses/${campusId}/00000000-0000-4000-8000-000000000021.jpg`;
    const rootCampus = {
      findFirst: jest
        .fn()
        .mockResolvedValue(location({ imageStorageKey: oldKey })),
    };
    const imageEvents: string[] = [];
    const tx = {
      $executeRaw: jest.fn().mockImplementation(async () => {
        imageEvents.push("lock");
        return 0;
      }),
      campus: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(location({ imageStorageKey: oldKey }))
          .mockResolvedValueOnce(location({ imageStorageKey: newKey })),
        update: jest
          .fn()
          .mockResolvedValue(location({ imageStorageKey: newKey })),
      },
      outboxEvent: { upsert: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      campus: rootCampus,
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const storage = {
      prepareManagedImage: jest.fn().mockImplementation(async () => {
        imageEvents.push("prepare");
        return {
          storageKey: newKey,
          thumbnailKey: `${newKey}.thumbnail.webp`,
          width: 1600,
          height: 900,
          sizeBytes: 120_000,
          sha256: "sha256",
        };
      }),
      deleteManagedImageObjects: jest
        .fn()
        .mockResolvedValue({ deleted: 2, failed: 0 }),
      managedImageUrls: jest.fn().mockResolvedValue({
        imageUrl: "signed-image",
        thumbnailUrl: "signed-thumbnail",
        expiresIn: 300,
      }),
    };
    const service = new LocationsService(
      prisma as never,
      {} as never,
      audit as never,
      storage as never,
    );

    await expect(
      service.completeImage(
        principal(),
        "campus",
        campusId,
        {
          fileName: "campus.jpg",
          mimeType: "image/jpeg",
          sizeBytes: 120_000,
          storageKey: newKey,
        },
        "request-3",
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        record: expect.objectContaining({ imageStorageKey: newKey }),
        storageCleanup: { deleted: 2, failed: 0 },
      }),
    );
    expect(tx.campus.update).toHaveBeenCalledWith({
      where: { id: campusId },
      data: { imageStorageKey: newKey },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "location.campus_image_replaced",
        beforeValue: { imageStorageKey: oldKey },
        afterValue: expect.objectContaining({ imageStorageKey: newKey }),
      }),
      tx,
    );
    expect(storage.deleteManagedImageObjects).toHaveBeenCalledWith(
      principal(),
      "campuses",
      campusId,
      oldKey,
    );
    expect(tx.outboxEvent.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          aggregateId: campusId,
          eventType: "storage.managed_image.delete",
          payload: expect.objectContaining({
            collegeId,
            folder: "campuses",
            entityId: campusId,
            storageKey: oldKey,
            reason: "REPLACED",
          }),
        }),
      }),
    );
    expect(imageEvents.slice(0, 2)).toEqual(["lock", "prepare"]);
  });

  it("commits a cleanup ledger with image removal before a failed object delete", async () => {
    const oldKey = `colleges/${collegeId}/campus-images/campuses/${campusId}/00000000-0000-4000-8000-000000000028.jpg`;
    const mutationTx = {
      $executeRaw: jest.fn().mockResolvedValue(0),
      campus: {
        findFirst: jest
          .fn()
          .mockResolvedValue(location({ imageStorageKey: oldKey })),
        update: jest
          .fn()
          .mockResolvedValue(location({ imageStorageKey: null })),
      },
      outboxEvent: { upsert: jest.fn().mockResolvedValue({}) },
    };
    const cleanupTx = {
      $executeRaw: jest.fn().mockResolvedValue(0),
      campus: {
        findFirst: jest
          .fn()
          .mockResolvedValue(location({ imageStorageKey: null })),
      },
    };
    const prisma = {
      $transaction: jest
        .fn()
        .mockImplementationOnce(
          async (callback: (client: typeof mutationTx) => Promise<unknown>) =>
            callback(mutationTx),
        )
        .mockImplementationOnce(
          async (callback: (client: typeof cleanupTx) => Promise<unknown>) =>
            callback(cleanupTx),
        ),
    };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const storage = {
      deleteManagedImageObjects: jest
        .fn()
        .mockResolvedValue({ deleted: 1, failed: 1 }),
    };
    const service = new LocationsService(
      prisma as never,
      {} as never,
      audit as never,
      storage as never,
    );

    await expect(
      service.removeImage(principal(), "campus", campusId, "request-remove"),
    ).resolves.toEqual({
      removed: true,
      storageCleanup: { deleted: 1, failed: 1 },
    });
    expect(mutationTx.outboxEvent.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          eventType: "storage.managed_image.delete",
          payload: expect.objectContaining({
            storageKey: oldKey,
            reason: "REMOVED",
          }),
        }),
      }),
    );
  });

  it("preserves an archived location image so a restore does not lose it", async () => {
    const oldKey = `colleges/${collegeId}/campus-images/campuses/${campusId}/00000000-0000-4000-8000-000000000029.jpg`;
    const existing = location({ imageStorageKey: oldKey });
    const archived = location({
      imageStorageKey: oldKey,
      isActive: false,
      archivedAt: new Date("2026-08-23T00:00:00.000Z"),
    });
    const tx = {
      campus: { update: jest.fn().mockResolvedValue(archived) },
      archivedRecord: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      campus: { findFirst: jest.fn().mockResolvedValue(existing) },
      $transaction: jest.fn(
        async (callback: (client: typeof tx) => Promise<unknown>) =>
          callback(tx),
      ),
    };
    const service = new LocationsService(
      prisma as never,
      {} as never,
      { record: jest.fn().mockResolvedValue(undefined) } as never,
      {} as never,
    );

    await expect(
      service.archive(
        principal(),
        "campus",
        campusId,
        { reason: "Seasonal closure" },
        "request-archive",
      ),
    ).resolves.toEqual(expect.objectContaining({ imageStorageKey: oldKey }));
    expect(tx.campus.update).toHaveBeenCalledWith({
      where: { id: campusId },
      data: { archivedAt: expect.any(Date), isActive: false },
    });
  });

  it("commits permanent-delete image cleanup in the location transaction", async () => {
    const oldKey = `colleges/${collegeId}/campus-images/campuses/${campusId}/00000000-0000-4000-8000-00000000002a.jpg`;
    const existing = location({
      imageStorageKey: oldKey,
      isActive: false,
      archivedAt: new Date("2026-08-23T00:00:00.000Z"),
    });
    const mutationTx = {
      $executeRaw: jest.fn().mockResolvedValue(0),
      campus: {
        findFirst: jest.fn().mockResolvedValue(existing),
        delete: jest.fn().mockResolvedValue(existing),
      },
      outboxEvent: { upsert: jest.fn().mockResolvedValue({}) },
    };
    const cleanupTx = {
      $executeRaw: jest.fn().mockResolvedValue(0),
      campus: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const prisma = {
      $transaction: jest
        .fn()
        .mockImplementationOnce(
          async (callback: (client: typeof mutationTx) => Promise<unknown>) =>
            callback(mutationTx),
        )
        .mockImplementationOnce(
          async (callback: (client: typeof cleanupTx) => Promise<unknown>) =>
            callback(cleanupTx),
        ),
    };
    const storage = {
      deleteManagedImageObjects: jest
        .fn()
        .mockResolvedValue({ deleted: 1, failed: 1 }),
    };
    const service = new LocationsService(
      prisma as never,
      {} as never,
      { record: jest.fn().mockResolvedValue(undefined) } as never,
      storage as never,
    );
    jest.spyOn(service, "dependencyReport").mockResolvedValue({
      kind: "campus",
      id: campusId,
      canDelete: true,
      totalDependencies: 0,
      counts: {
        assignedUsers: 0,
        announcements: 0,
        qrCodes: 0,
        messengerGroups: 0,
      },
      dependencies: {
        assignedUsers: 0,
        announcements: 0,
        qrCodes: 0,
        messengerGroups: 0,
      },
      message: "No dependencies were found.",
    });

    await expect(
      service.removePermanently(
        principal(),
        "campus",
        campusId,
        "Verified cleanup",
        "PERMANENTLY DELETE LOCATION",
        "request-delete",
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        deleted: true,
        storageCleanup: { deleted: 1, failed: 1 },
      }),
    );
    expect(mutationTx.outboxEvent.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          eventType: "storage.managed_image.delete",
          payload: expect.objectContaining({
            storageKey: oldKey,
            reason: "PERMANENT_DELETE",
          }),
        }),
      }),
    );
    expect(mutationTx.campus.delete).toHaveBeenCalledWith({
      where: { id: campusId },
    });
  });

  it("compensates a failed image DB commit by deleting the newly uploaded objects", async () => {
    const newKey = `colleges/${collegeId}/campus-images/campuses/${campusId}/00000000-0000-4000-8000-000000000022.png`;
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(0),
      campus: {
        findFirst: jest.fn().mockResolvedValue(location()),
        update: jest
          .fn()
          .mockResolvedValue(location({ imageStorageKey: newKey })),
      },
    };
    const compensationTx = {
      $executeRaw: jest.fn().mockResolvedValue(0),
      campus: { findFirst: jest.fn().mockResolvedValue(location()) },
    };
    const prisma = {
      campus: { findFirst: jest.fn().mockResolvedValue(location()) },
      outboxEvent: { upsert: jest.fn().mockResolvedValue({}) },
      $transaction: jest
        .fn()
        .mockImplementationOnce(
          async (callback: (client: typeof tx) => Promise<unknown>) => {
            await callback(tx);
            throw new Error("database unavailable");
          },
        )
        .mockImplementationOnce(
          async (
            callback: (client: typeof compensationTx) => Promise<unknown>,
          ) => callback(compensationTx),
        ),
    };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const storage = {
      prepareManagedImage: jest.fn().mockResolvedValue({
        storageKey: newKey,
        thumbnailKey: `${newKey}.thumbnail.webp`,
        width: 800,
        height: 600,
        sizeBytes: 1024,
        sha256: "sha256",
      }),
      deleteManagedImageObjects: jest
        .fn()
        .mockResolvedValue({ deleted: 2, failed: 0 }),
    };
    const service = new LocationsService(
      prisma as never,
      {} as never,
      audit as never,
      storage as never,
    );

    await expect(
      service.completeImage(
        principal(),
        "campus",
        campusId,
        {
          fileName: "campus.png",
          mimeType: "image/png",
          sizeBytes: 1024,
          storageKey: newKey,
        },
        "request-4",
      ),
    ).rejects.toThrow("database unavailable");
    expect(storage.deleteManagedImageObjects).toHaveBeenCalledWith(
      principal(),
      "campuses",
      campusId,
      newKey,
    );
    expect(prisma.outboxEvent.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          eventType: "storage.managed_image.delete",
          payload: expect.objectContaining({
            storageKey: newKey,
            reason: "COMPENSATION",
          }),
        }),
      }),
    );
  });

  it("compensates a rejected image only after confirming its key is unreferenced", async () => {
    const rejectedKey = `colleges/${collegeId}/campus-images/campuses/${campusId}/00000000-0000-4000-8000-000000000026.jpg`;
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(0),
      campus: { findFirst: jest.fn().mockResolvedValue(location()) },
    };
    const prisma = {
      campus: {
        findFirst: jest.fn().mockResolvedValue(location()),
      },
      outboxEvent: { upsert: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn(
        async (callback: (client: typeof tx) => Promise<unknown>) =>
          callback(tx),
      ),
    };
    const storage = {
      prepareManagedImage: jest
        .fn()
        .mockRejectedValue(new BadRequestException("invalid image content")),
      deleteManagedImageObjects: jest
        .fn()
        .mockResolvedValue({ deleted: 1, failed: 0 }),
    };
    const service = new LocationsService(
      prisma as never,
      {} as never,
      {} as never,
      storage as never,
    );

    await expect(
      service.completeImage(
        principal(),
        "campus",
        campusId,
        {
          fileName: "campus.jpg",
          mimeType: "image/jpeg",
          sizeBytes: 1024,
          storageKey: rejectedKey,
        },
        "request-invalid-image",
      ),
    ).rejects.toThrow("invalid image content");
    expect(storage.deleteManagedImageObjects).toHaveBeenCalledWith(
      principal(),
      "campuses",
      campusId,
      rejectedKey,
    );
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
  });

  it("does not compensate a replayed key that a concurrent request committed", async () => {
    const liveKey = `colleges/${collegeId}/campus-images/campuses/${campusId}/00000000-0000-4000-8000-000000000025.png`;
    const findFirst = jest
      .fn()
      .mockResolvedValueOnce(location())
      .mockResolvedValueOnce(location({ imageStorageKey: liveKey }));
    const compensationTx = {
      $executeRaw: jest.fn().mockResolvedValue(0),
      campus: { findFirst },
    };
    const prisma = {
      campus: { findFirst },
      outboxEvent: { upsert: jest.fn().mockResolvedValue({}) },
      $transaction: jest
        .fn()
        .mockRejectedValueOnce(new Error("serialization conflict"))
        .mockImplementationOnce(
          async (
            callback: (client: typeof compensationTx) => Promise<unknown>,
          ) => callback(compensationTx),
        ),
    };
    const storage = {
      prepareManagedImage: jest.fn().mockResolvedValue({
        storageKey: liveKey,
        thumbnailKey: `${liveKey}.thumbnail.webp`,
        width: 1200,
        height: 800,
        sizeBytes: 64_000,
        sha256: "sha256",
      }),
      deleteManagedImageObjects: jest
        .fn()
        .mockResolvedValue({ deleted: 2, failed: 0 }),
    };
    const service = new LocationsService(
      prisma as never,
      {} as never,
      {} as never,
      storage as never,
    );

    await expect(
      service.completeImage(
        principal(),
        "campus",
        campusId,
        {
          fileName: "campus.png",
          mimeType: "image/png",
          sizeBytes: 64_000,
          storageKey: liveKey,
        },
        "request-concurrent",
      ),
    ).rejects.toThrow("serialization conflict");
    expect(findFirst).toHaveBeenCalledTimes(2);
    expect(storage.deleteManagedImageObjects).not.toHaveBeenCalled();
  });

  it("treats a same-key completion retry as idempotent without reprocessing the live image", async () => {
    const liveKey = `colleges/${collegeId}/campus-images/campuses/${campusId}/00000000-0000-4000-8000-000000000024.webp`;
    const prisma = {
      campus: {
        findFirst: jest
          .fn()
          .mockResolvedValue(location({ imageStorageKey: liveKey })),
      },
      $transaction: jest
        .fn()
        .mockRejectedValue(new Error("database unavailable")),
    };
    const storage = {
      prepareManagedImage: jest.fn(),
      managedImageUrls: jest.fn().mockResolvedValue({
        imageUrl: "signed-image",
        thumbnailUrl: "signed-thumbnail",
        expiresIn: 300,
      }),
      deleteManagedImageObjects: jest
        .fn()
        .mockResolvedValue({ deleted: 2, failed: 0 }),
    };
    const service = new LocationsService(
      prisma as never,
      {} as never,
      {} as never,
      storage as never,
    );

    await expect(
      service.completeImage(
        principal(),
        "campus",
        campusId,
        {
          fileName: "campus.webp",
          mimeType: "image/webp",
          sizeBytes: 1024,
          storageKey: liveKey,
        },
        "request-5",
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        record: expect.objectContaining({ imageStorageKey: liveKey }),
        image: expect.objectContaining({ imageUrl: "signed-image" }),
        storageCleanup: { deleted: 0, failed: 0 },
      }),
    );
    expect(storage.prepareManagedImage).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(storage.deleteManagedImageObjects).not.toHaveBeenCalled();
  });
});

describe("managed campus image storage", () => {
  const clients: Array<{ destroy?: () => void }> = [];

  afterEach(() => {
    for (const client of clients) {
      client.destroy?.();
    }
    clients.length = 0;
  });

  function storageService(prisma: Record<string, unknown> = {}) {
    const values: Record<string, unknown> = {
      S3_BUCKET: "test-bucket",
      S3_ENDPOINT: "http://127.0.0.1:9000",
      S3_REGION: "us-east-1",
      S3_FORCE_PATH_STYLE: true,
      S3_ACCESS_KEY: "test-access",
      S3_SECRET_KEY: "test-secret",
      MAX_IMAGE_SIZE_MB: 10,
      MALWARE_SCAN_ENABLED: false,
    };
    const config = {
      getOrThrow: jest.fn((key: string) => {
        if (!(key in values)) throw new Error(`Missing ${key}`);
        return values[key];
      }),
      get: jest.fn(
        (key: string, fallback?: unknown) => values[key] ?? fallback,
      ),
    };
    const storage = new StorageService(
      prisma as never,
      config as never,
      {} as never,
      {} as never,
    );
    clients.push(
      (storage as unknown as { client: { destroy?: () => void } }).client,
    );
    return storage;
  }

  it("rejects a storage key belonging to another college or entity", async () => {
    const storage = storageService();
    const wrongKey = `colleges/00000000-0000-4000-8000-000000000099/campus-images/campuses/${campusId}/00000000-0000-4000-8000-000000000020.jpg`;

    await expect(
      storage.managedImageUrls(principal(), "campuses", campusId, wrongKey),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      storage.deleteManagedImageObjectsIfUnreferenced({
        collegeId,
        folder: "campuses",
        entityId: campusId,
        storageKey: wrongKey,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("rechecks the owning tenant reference before retrying a managed image deletion", async () => {
    const storageKey = `colleges/${collegeId}/campus-images/campuses/${campusId}/00000000-0000-4000-8000-000000000020.jpg`;
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(0),
      campus: {
        findFirst: jest.fn().mockResolvedValue({ imageStorageKey: storageKey }),
      },
    };
    const storage = storageService({
      $transaction: jest.fn(
        async (callback: (client: typeof tx) => Promise<unknown>) =>
          callback(tx),
      ),
    });
    const send = jest.fn().mockResolvedValue({});
    (storage as unknown as { client: { send: typeof send } }).client = { send };

    await expect(
      storage.deleteManagedImageObjectsIfUnreferenced({
        collegeId,
        folder: "campuses",
        entityId: campusId,
        storageKey,
      }),
    ).resolves.toEqual({
      deleted: 0,
      failed: 0,
      skippedReferenced: true,
    });
    expect(send).not.toHaveBeenCalled();
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it("deletes both owned objects after the retry proves the key is unreferenced", async () => {
    const storageKey = `colleges/${collegeId}/campus-images/campuses/${campusId}/00000000-0000-4000-8000-000000000020.jpg`;
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(0),
      campus: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const storage = storageService({
      $transaction: jest.fn(
        async (callback: (client: typeof tx) => Promise<unknown>) =>
          callback(tx),
      ),
    });
    const send = jest.fn().mockResolvedValue({});
    (storage as unknown as { client: { send: typeof send } }).client = { send };

    await expect(
      storage.deleteManagedImageObjectsIfUnreferenced({
        collegeId,
        folder: "campuses",
        entityId: campusId,
        storageKey,
      }),
    ).resolves.toEqual({
      deleted: 2,
      failed: 0,
      skippedReferenced: false,
    });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("rejects signature-mismatched image content without making an unsafe ownership cleanup decision", async () => {
    const storage = storageService();
    const content = Buffer.from("not-jpeg");
    const storageKey = `colleges/${collegeId}/campus-images/campuses/${campusId}/00000000-0000-4000-8000-000000000023.jpg`;
    const send = jest.fn(async (command: object) => {
      const commandName = command.constructor.name;
      if (commandName === "HeadObjectCommand")
        return { ContentLength: content.length, ContentType: "image/jpeg" };
      if (commandName === "GetObjectCommand")
        return { Body: Readable.from([content]) };
      return {};
    });
    (storage as unknown as { client: { send: typeof send } }).client = { send };

    await expect(
      storage.prepareManagedImage(principal(), "campuses", campusId, {
        fileName: "campus.jpg",
        mimeType: "image/jpeg",
        sizeBytes: content.length,
        storageKey,
      }),
    ).rejects.toThrow("content does not match its declared file type");
    expect(
      send.mock.calls.filter(
        ([command]) => command.constructor.name === "DeleteObjectCommand",
      ),
    ).toHaveLength(0);
  });
});
