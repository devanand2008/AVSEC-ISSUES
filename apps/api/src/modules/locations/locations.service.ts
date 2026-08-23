import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash, randomUUID } from "node:crypto";
import QRCode from "qrcode";
import { AuditService } from "../audit/audit.service";
import type { AuthPrincipal } from "../../common/http/request-context";
import { PrismaService } from "../../database/prisma.service";
import { RoomType } from "../../generated/prisma/enums";
import type { Prisma } from "../../generated/prisma/client";
import {
  StorageService,
  type ManagedImageFolder,
} from "../storage/storage.service";
import type {
  CompleteLocationImageDto,
  ArchiveLocationDto,
  CreateAreaDto,
  CreateBlockDto,
  CreateCampusDto,
  CreateFloorDto,
  CreateRoomDto,
  PresignLocationImageDto,
  UpdateBlockDto,
  UpdateCampusDto,
  UpdateFloorDto,
  UpdateRoomDto,
} from "./dto/location.dto";

export type LocationKind = "campus" | "block" | "floor" | "room";

interface LocationFilters {
  search?: string;
  status?: string;
  parentId?: string;
  campusId?: string;
  blockId?: string;
  floorId?: string;
  roomType?: RoomType;
  departmentId?: string;
  page?: number;
  pageSize?: number;
}

type LocationClient = PrismaService | Prisma.TransactionClient;

interface LocationSnapshot {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  archivedAt: Date | null;
  isTestData: boolean;
  imageStorageKey: string | null;
  campusId?: string;
  blockId?: string;
  floorId?: string;
  departmentId?: string | null;
  [key: string]: unknown;
}

@Injectable()
export class LocationsService {
  private readonly logger = new Logger(LocationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  campuses(user: AuthPrincipal) {
    return this.prisma.campus.findMany({
      where: { collegeId: user.collegeId, isActive: true, archivedAt: null },
      select: {
        id: true,
        code: true,
        name: true,
        description: true,
        address: true,
        contactNumber: true,
        isActive: true,
      },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
  }

  async blocks(user: AuthPrincipal, campusId: string) {
    const campus = await this.prisma.campus.findFirst({
      where: {
        id: campusId,
        collegeId: user.collegeId,
        isActive: true,
        archivedAt: null,
      },
      select: { id: true },
    });
    if (!campus)
      throw new NotFoundException("Active campus not found in your college.");
    return this.prisma.block.findMany({
      where: {
        campusId,
        campus: { collegeId: user.collegeId, isActive: true, archivedAt: null },
        isActive: true,
        archivedAt: null,
      },
      select: {
        id: true,
        code: true,
        name: true,
        description: true,
        campusId: true,
        isActive: true,
      },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
  }

  async floors(user: AuthPrincipal, blockId: string) {
    const block = await this.prisma.block.findFirst({
      where: {
        id: blockId,
        isActive: true,
        archivedAt: null,
        campus: { collegeId: user.collegeId, isActive: true, archivedAt: null },
      },
      select: { id: true },
    });
    if (!block)
      throw new NotFoundException("Active block not found in your college.");
    return this.prisma.floor.findMany({
      where: {
        blockId,
        block: {
          campus: { collegeId: user.collegeId, archivedAt: null },
          archivedAt: null,
        },
        isActive: true,
        archivedAt: null,
      },
      select: {
        id: true,
        code: true,
        name: true,
        level: true,
        description: true,
        blockId: true,
        isActive: true,
      },
      orderBy: [{ sortOrder: "asc" }, { level: "asc" }],
    });
  }

  async rooms(user: AuthPrincipal, floorId: string) {
    await this.requireActiveFloor(user, floorId);
    return this.prisma.room.findMany({
      where: {
        floorId,
        floor: {
          block: {
            campus: {
              collegeId: user.collegeId,
              isActive: true,
              archivedAt: null,
            },
            isActive: true,
            archivedAt: null,
          },
          isActive: true,
          archivedAt: null,
        },
        isActive: true,
        archivedAt: null,
      },
      select: {
        id: true,
        code: true,
        name: true,
        roomNumber: true,
        roomType: true,
        customRoomTypeLabel: true,
        capacity: true,
        description: true,
        floorId: true,
        departmentId: true,
        isActive: true,
      },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
  }

  async areas(user: AuthPrincipal, floorId: string) {
    await this.requireActiveFloor(user, floorId);
    return this.prisma.area.findMany({
      where: {
        floorId,
        floor: {
          block: {
            campus: {
              collegeId: user.collegeId,
              isActive: true,
              archivedAt: null,
            },
            isActive: true,
            archivedAt: null,
          },
          isActive: true,
          archivedAt: null,
        },
        isActive: true,
        archivedAt: null,
      },
      select: {
        id: true,
        code: true,
        name: true,
        description: true,
        floorId: true,
        isActive: true,
      },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
  }

  async adminList(
    user: AuthPrincipal,
    kind: LocationKind,
    filters: LocationFilters = {},
  ) {
    const search = filters.search?.trim();
    const status = this.statusWhere(filters.status);
    switch (kind) {
      case "campus": {
        const where: Prisma.CampusWhereInput = {
          collegeId: user.collegeId,
          ...status,
          ...(search
            ? {
                OR: [
                  { name: { contains: search, mode: "insensitive" } },
                  { code: { contains: search, mode: "insensitive" } },
                  { description: { contains: search, mode: "insensitive" } },
                  { address: { contains: search, mode: "insensitive" } },
                ],
              }
            : {}),
        };
        return this.locationListResult(
          filters,
          (pagination) =>
            this.prisma.campus.findMany({
              where,
              include: {
                _count: {
                  select: { blocks: true, departments: true, issues: true },
                },
              },
              orderBy: [
                { archivedAt: "asc" },
                { sortOrder: "asc" },
                { name: "asc" },
              ],
              ...pagination,
            }),
          () => this.prisma.campus.count({ where }),
        );
      }
      case "block": {
        const campusId = filters.campusId ?? filters.parentId;
        const where: Prisma.BlockWhereInput = {
          ...(campusId ? { campusId } : {}),
          campus: { collegeId: user.collegeId },
          ...status,
          ...(search
            ? {
                OR: [
                  { name: { contains: search, mode: "insensitive" } },
                  { code: { contains: search, mode: "insensitive" } },
                  { description: { contains: search, mode: "insensitive" } },
                  {
                    campus: { name: { contains: search, mode: "insensitive" } },
                  },
                  {
                    campus: { code: { contains: search, mode: "insensitive" } },
                  },
                ],
              }
            : {}),
        };
        return this.locationListResult(
          filters,
          (pagination) =>
            this.prisma.block.findMany({
              where,
              include: {
                campus: { select: { id: true, name: true, code: true } },
                _count: { select: { floors: true, issues: true } },
              },
              orderBy: [
                { archivedAt: "asc" },
                { sortOrder: "asc" },
                { name: "asc" },
              ],
              ...pagination,
            }),
          () => this.prisma.block.count({ where }),
        );
      }
      case "floor": {
        const blockId = filters.blockId ?? filters.parentId;
        const where: Prisma.FloorWhereInput = {
          ...(blockId ? { blockId } : {}),
          block: {
            ...(filters.campusId ? { campusId: filters.campusId } : {}),
            campus: { collegeId: user.collegeId },
          },
          ...status,
          ...(search
            ? {
                OR: [
                  { name: { contains: search, mode: "insensitive" } },
                  { code: { contains: search, mode: "insensitive" } },
                  { description: { contains: search, mode: "insensitive" } },
                  {
                    block: { name: { contains: search, mode: "insensitive" } },
                  },
                  {
                    block: { code: { contains: search, mode: "insensitive" } },
                  },
                  {
                    block: {
                      campus: {
                        name: { contains: search, mode: "insensitive" },
                      },
                    },
                  },
                  {
                    block: {
                      campus: {
                        code: { contains: search, mode: "insensitive" },
                      },
                    },
                  },
                ],
              }
            : {}),
        };
        return this.locationListResult(
          filters,
          (pagination) =>
            this.prisma.floor.findMany({
              where,
              include: {
                block: {
                  select: {
                    id: true,
                    name: true,
                    code: true,
                    campus: { select: { id: true, name: true } },
                  },
                },
                _count: { select: { rooms: true, issues: true } },
              },
              orderBy: [
                { archivedAt: "asc" },
                { sortOrder: "asc" },
                { level: "asc" },
              ],
              ...pagination,
            }),
          () => this.prisma.floor.count({ where }),
        );
      }
      case "room": {
        const floorId = filters.floorId ?? filters.parentId;
        const normalizedSearchType = search
          ?.toUpperCase()
          .replace(/[\s-]+/g, "_") as RoomType | undefined;
        const matchesRoomType =
          normalizedSearchType !== undefined &&
          Object.values(RoomType).includes(normalizedSearchType);
        const where: Prisma.RoomWhereInput = {
          ...(floorId ? { floorId } : {}),
          ...(filters.departmentId
            ? { departmentId: filters.departmentId }
            : {}),
          ...(filters.roomType ? { roomType: filters.roomType } : {}),
          floor: {
            ...(filters.blockId ? { blockId: filters.blockId } : {}),
            block: {
              ...(filters.campusId ? { campusId: filters.campusId } : {}),
              campus: { collegeId: user.collegeId },
            },
          },
          ...status,
          ...(search
            ? {
                OR: [
                  { name: { contains: search, mode: "insensitive" } },
                  { code: { contains: search, mode: "insensitive" } },
                  { roomNumber: { contains: search, mode: "insensitive" } },
                  {
                    customRoomTypeLabel: {
                      contains: search,
                      mode: "insensitive",
                    },
                  },
                  { description: { contains: search, mode: "insensitive" } },
                  ...(matchesRoomType
                    ? [{ roomType: normalizedSearchType }]
                    : []),
                  {
                    department: {
                      name: { contains: search, mode: "insensitive" },
                    },
                  },
                  {
                    department: {
                      code: { contains: search, mode: "insensitive" },
                    },
                  },
                  {
                    floor: { name: { contains: search, mode: "insensitive" } },
                  },
                  {
                    floor: { code: { contains: search, mode: "insensitive" } },
                  },
                  {
                    floor: {
                      block: {
                        name: { contains: search, mode: "insensitive" },
                      },
                    },
                  },
                  {
                    floor: {
                      block: {
                        code: { contains: search, mode: "insensitive" },
                      },
                    },
                  },
                  {
                    floor: {
                      block: {
                        campus: {
                          name: { contains: search, mode: "insensitive" },
                        },
                      },
                    },
                  },
                  {
                    floor: {
                      block: {
                        campus: {
                          code: { contains: search, mode: "insensitive" },
                        },
                      },
                    },
                  },
                ],
              }
            : {}),
        };
        return this.locationListResult(
          filters,
          (pagination) =>
            this.prisma.room.findMany({
              where,
              include: {
                department: { select: { id: true, code: true, name: true } },
                floor: {
                  select: {
                    id: true,
                    name: true,
                    block: {
                      select: {
                        id: true,
                        name: true,
                        campus: { select: { id: true, name: true } },
                      },
                    },
                  },
                },
                _count: {
                  select: {
                    assignedSections: true,
                    assets: true,
                    issues: true,
                    responsiblePeople: true,
                  },
                },
              },
              orderBy: [
                { archivedAt: "asc" },
                { sortOrder: "asc" },
                { name: "asc" },
              ],
              ...pagination,
            }),
          () => this.prisma.room.count({ where }),
        );
      }
    }
  }

  async assets(
    user: AuthPrincipal,
    location: { roomId?: string; areaId?: string },
  ) {
    if (Boolean(location.roomId) === Boolean(location.areaId)) {
      throw new BadRequestException(
        "Select either a room or an area to load assets.",
      );
    }
    if (location.roomId) {
      const room = await this.prisma.room.findFirst({
        where: {
          id: location.roomId,
          isActive: true,
          archivedAt: null,
          floor: {
            isActive: true,
            archivedAt: null,
            block: {
              isActive: true,
              archivedAt: null,
              campus: {
                collegeId: user.collegeId,
                isActive: true,
                archivedAt: null,
              },
            },
          },
        },
        select: { id: true },
      });
      if (!room)
        throw new NotFoundException("Active room not found in your college.");
    } else {
      const area = await this.prisma.area.findFirst({
        where: {
          id: location.areaId,
          isActive: true,
          archivedAt: null,
          floor: {
            isActive: true,
            archivedAt: null,
            block: {
              isActive: true,
              archivedAt: null,
              campus: {
                collegeId: user.collegeId,
                isActive: true,
                archivedAt: null,
              },
            },
          },
        },
        select: { id: true },
      });
      if (!area)
        throw new NotFoundException("Active area not found in your college.");
    }
    return this.prisma.asset.findMany({
      where: {
        ...(location.roomId
          ? { roomId: location.roomId }
          : { areaId: location.areaId }),
        isActive: true,
      },
      select: {
        id: true,
        code: true,
        name: true,
        roomId: true,
        areaId: true,
        category: { select: { name: true } },
        room: { select: { code: true, name: true } },
        area: { select: { code: true, name: true } },
      },
      orderBy: { name: "asc" },
    });
  }

  async roomByQr(user: AuthPrincipal, token: string) {
    const room = await this.prisma.room.findFirst({
      where: {
        qrToken: token,
        isActive: true,
        archivedAt: null,
        floor: { block: { campus: { collegeId: user.collegeId } } },
      },
      select: {
        id: true,
        code: true,
        name: true,
        roomType: true,
        customRoomTypeLabel: true,
        floor: {
          select: {
            id: true,
            name: true,
            block: {
              select: {
                id: true,
                name: true,
                campus: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
    });
    if (!room) throw new NotFoundException("Active room not found.");
    return room;
  }

  async roomQr(user: AuthPrincipal, id: string) {
    const room = await this.qrRoom(user, { id });
    return this.qrPayload(room);
  }

  async qrSheet(user: AuthPrincipal, floorId: string) {
    const floor = await this.prisma.floor.findFirst({
      where: {
        id: floorId,
        archivedAt: null,
        block: { campus: { collegeId: user.collegeId } },
      },
      select: {
        id: true,
        name: true,
        block: { select: { name: true, campus: { select: { name: true } } } },
      },
    });
    if (!floor) throw new NotFoundException("Floor not found.");
    const rooms = await this.prisma.room.findMany({
      where: { floorId, isActive: true, archivedAt: null },
      select: {
        id: true,
        code: true,
        name: true,
        roomNumber: true,
        roomType: true,
        customRoomTypeLabel: true,
        qrToken: true,
        floor: {
          select: {
            name: true,
            block: {
              select: { name: true, campus: { select: { name: true } } },
            },
          },
        },
      },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      take: 100,
    });
    return {
      floor,
      rooms: await Promise.all(rooms.map((room) => this.qrPayload(room))),
    };
  }

  async rotateQr(user: AuthPrincipal, id: string) {
    await this.qrRoom(user, { id });
    const room = await this.prisma.room.update({
      where: { id },
      data: { qrToken: randomUUID() },
      select: {
        id: true,
        code: true,
        name: true,
        roomNumber: true,
        roomType: true,
        customRoomTypeLabel: true,
        qrToken: true,
        floor: {
          select: {
            name: true,
            block: {
              select: { name: true, campus: { select: { name: true } } },
            },
          },
        },
      },
    });
    return this.qrPayload(room);
  }

  async createCampus(
    user: AuthPrincipal,
    input: CreateCampusDto,
    requestId: string,
  ) {
    const campus = await this.locationMutation(() =>
      this.prisma.$transaction(async (tx) => {
        const created = await tx.campus.create({
          data: {
            collegeId: user.collegeId,
            code: input.code.trim().toUpperCase(),
            name: input.name.trim(),
            description: input.description?.trim(),
            address: input.address?.trim(),
            contactNumber: input.contactNumber?.trim(),
            isActive: input.isActive ?? true,
            sortOrder: input.sortOrder ?? 0,
          },
        });
        await this.audit.record(
          {
            actorId: user.id,
            action: "location.campus_created",
            entityType: "Campus",
            entityId: created.id,
            afterValue: created,
            requestId,
          },
          tx,
        );
        return created;
      }),
    );
    return campus;
  }

  async createBlock(
    user: AuthPrincipal,
    input: CreateBlockDto,
    requestId: string,
  ) {
    return this.locationMutation(() =>
      this.prisma.$transaction(
        async (tx) => {
          await this.requireActiveCampus(user, input.campusId, tx);
          const created = await tx.block.create({
            data: {
              ...input,
              description: input.description?.trim(),
              code: input.code.trim().toUpperCase(),
              name: input.name.trim(),
            },
          });
          await this.audit.record(
            {
              actorId: user.id,
              action: "location.block_created",
              entityType: "Block",
              entityId: created.id,
              afterValue: created,
              requestId,
            },
            tx,
          );
          return created;
        },
        { isolationLevel: "Serializable" },
      ),
    );
  }

  async createFloor(
    user: AuthPrincipal,
    input: CreateFloorDto,
    requestId: string,
  ) {
    return this.locationMutation(() =>
      this.prisma.$transaction(
        async (tx) => {
          await this.requireActiveBlock(user, input.blockId, tx);
          const created = await tx.floor.create({
            data: {
              ...input,
              description: input.description?.trim(),
              code: input.code.trim().toUpperCase(),
              name: input.name.trim(),
            },
          });
          await this.audit.record(
            {
              actorId: user.id,
              action: "location.floor_created",
              entityType: "Floor",
              entityId: created.id,
              afterValue: created,
              requestId,
            },
            tx,
          );
          return created;
        },
        { isolationLevel: "Serializable" },
      ),
    );
  }

  async createRoom(
    user: AuthPrincipal,
    input: CreateRoomDto,
    requestId: string,
  ) {
    const customRoomTypeLabel = this.validatedCustomRoomTypeLabel(
      input.roomType,
      input.customRoomTypeLabel,
    );
    return this.locationMutation(() =>
      this.prisma.$transaction(
        async (tx) => {
          await this.validateRoomParents(
            user,
            input.floorId,
            input.departmentId,
            tx,
          );
          const created = await tx.room.create({
            data: {
              ...input,
              code: input.code.trim().toUpperCase(),
              name: input.name.trim(),
              roomNumber: input.roomNumber?.trim(),
              description: input.description?.trim(),
              customRoomTypeLabel,
            },
          });
          await this.audit.record(
            {
              actorId: user.id,
              action: "location.room_created",
              entityType: "Room",
              entityId: created.id,
              afterValue: created,
              requestId,
            },
            tx,
          );
          return created;
        },
        { isolationLevel: "Serializable" },
      ),
    );
  }

  async createArea(
    user: AuthPrincipal,
    input: CreateAreaDto,
    requestId: string,
  ) {
    return this.prisma.$transaction(
      async (tx) => {
        await this.validateRoomParents(user, input.floorId, undefined, tx);
        const created = await tx.area.create({
          data: {
            floorId: input.floorId,
            code: input.code.trim().toUpperCase(),
            name: input.name.trim(),
            description: input.description?.trim(),
            sortOrder: input.sortOrder ?? 0,
            isActive: input.isActive ?? true,
          },
        });
        await this.audit.record(
          {
            actorId: user.id,
            action: "location.area_created",
            entityType: "Area",
            entityId: created.id,
            afterValue: created,
            requestId,
          },
          tx,
        );
        return created;
      },
      { isolationLevel: "Serializable" },
    );
  }

  private async requireActiveCampus(
    user: AuthPrincipal,
    campusId: string,
    client: LocationClient = this.prisma,
  ): Promise<void> {
    const campus = await client.campus.findFirst({
      where: {
        id: campusId,
        collegeId: user.collegeId,
        isActive: true,
        archivedAt: null,
      },
      select: { id: true },
    });
    if (!campus)
      throw new BadRequestException("The selected campus is not active.");
  }

  private async requireActiveBlock(
    user: AuthPrincipal,
    blockId: string,
    client: LocationClient = this.prisma,
  ): Promise<void> {
    const block = await client.block.findFirst({
      where: {
        id: blockId,
        isActive: true,
        archivedAt: null,
        campus: {
          collegeId: user.collegeId,
          isActive: true,
          archivedAt: null,
        },
      },
      select: { id: true },
    });
    if (!block)
      throw new BadRequestException(
        "The selected block and its campus must be active.",
      );
  }

  private async requireActiveFloor(
    user: AuthPrincipal,
    floorId: string,
    client: LocationClient = this.prisma,
  ): Promise<void> {
    const floor = await client.floor.findFirst({
      where: {
        id: floorId,
        isActive: true,
        archivedAt: null,
        block: {
          isActive: true,
          archivedAt: null,
          campus: {
            collegeId: user.collegeId,
            isActive: true,
            archivedAt: null,
          },
        },
      },
      select: { id: true },
    });
    if (!floor)
      throw new NotFoundException("Active floor not found in your college.");
  }

  async updateCampus(
    user: AuthPrincipal,
    id: string,
    input: UpdateCampusDto,
    requestId: string,
  ) {
    const existing = await this.requireLocation(user, "campus", id);
    return this.locationMutation(() =>
      this.prisma.$transaction(async (tx) => {
        const updated = await tx.campus.update({
          where: { id },
          data: {
            ...(input.code !== undefined
              ? { code: input.code.trim().toUpperCase() }
              : {}),
            ...(input.name !== undefined ? { name: input.name.trim() } : {}),
            ...(input.description !== undefined
              ? { description: input.description?.trim() || null }
              : {}),
            ...(input.address !== undefined
              ? { address: input.address?.trim() || null }
              : {}),
            ...(input.contactNumber !== undefined
              ? { contactNumber: input.contactNumber?.trim() || null }
              : {}),
            ...(input.isActive !== undefined
              ? { isActive: input.isActive }
              : {}),
            ...(input.isTestData !== undefined
              ? { isTestData: input.isTestData }
              : {}),
            ...(input.sortOrder !== undefined
              ? { sortOrder: input.sortOrder }
              : {}),
          },
        });
        await this.audit.record(
          {
            actorId: user.id,
            action: "location.campus_updated",
            entityType: "Campus",
            entityId: id,
            beforeValue: existing,
            afterValue: updated,
            requestId,
          },
          tx,
        );
        return updated;
      }),
    );
  }

  async updateBlock(
    user: AuthPrincipal,
    id: string,
    input: UpdateBlockDto,
    requestId: string,
  ) {
    const existing = await this.requireLocation(user, "block", id);
    return this.locationMutation(() =>
      this.prisma.$transaction(
        async (tx) => {
          if (input.campusId)
            await this.requireActiveCampus(user, input.campusId, tx);
          const updated = await tx.block.update({
            where: { id },
            data: {
              ...(input.campusId !== undefined
                ? { campusId: input.campusId }
                : {}),
              ...(input.code !== undefined
                ? { code: input.code.trim().toUpperCase() }
                : {}),
              ...(input.name !== undefined ? { name: input.name.trim() } : {}),
              ...(input.description !== undefined
                ? { description: input.description?.trim() || null }
                : {}),
              ...(input.isActive !== undefined
                ? { isActive: input.isActive }
                : {}),
              ...(input.isTestData !== undefined
                ? { isTestData: input.isTestData }
                : {}),
              ...(input.sortOrder !== undefined
                ? { sortOrder: input.sortOrder }
                : {}),
            },
          });
          await this.audit.record(
            {
              actorId: user.id,
              action: "location.block_updated",
              entityType: "Block",
              entityId: id,
              beforeValue: existing,
              afterValue: updated,
              requestId,
            },
            tx,
          );
          return updated;
        },
        { isolationLevel: "Serializable" },
      ),
    );
  }

  async updateFloor(
    user: AuthPrincipal,
    id: string,
    input: UpdateFloorDto,
    requestId: string,
  ) {
    const existing = await this.requireLocation(user, "floor", id);
    return this.locationMutation(() =>
      this.prisma.$transaction(
        async (tx) => {
          if (input.blockId)
            await this.requireActiveBlock(user, input.blockId, tx);
          const updated = await tx.floor.update({
            where: { id },
            data: {
              ...(input.blockId !== undefined
                ? { blockId: input.blockId }
                : {}),
              ...(input.code !== undefined
                ? { code: input.code.trim().toUpperCase() }
                : {}),
              ...(input.name !== undefined ? { name: input.name.trim() } : {}),
              ...(input.level !== undefined ? { level: input.level } : {}),
              ...(input.description !== undefined
                ? { description: input.description?.trim() || null }
                : {}),
              ...(input.isActive !== undefined
                ? { isActive: input.isActive }
                : {}),
              ...(input.isTestData !== undefined
                ? { isTestData: input.isTestData }
                : {}),
              ...(input.sortOrder !== undefined
                ? { sortOrder: input.sortOrder }
                : {}),
            },
          });
          await this.audit.record(
            {
              actorId: user.id,
              action: "location.floor_updated",
              entityType: "Floor",
              entityId: id,
              beforeValue: existing,
              afterValue: updated,
              requestId,
            },
            tx,
          );
          return updated;
        },
        { isolationLevel: "Serializable" },
      ),
    );
  }

  async updateRoom(
    user: AuthPrincipal,
    id: string,
    input: UpdateRoomDto,
    requestId: string,
  ) {
    const existing = await this.requireLocation(user, "room", id);
    const floorId = input.floorId ?? existing.floorId;
    const roomType = input.roomType ?? (existing.roomType as RoomType);
    const customRoomTypeLabel = this.validatedCustomRoomTypeLabel(
      roomType,
      input.customRoomTypeLabel !== undefined
        ? input.customRoomTypeLabel
        : (existing.customRoomTypeLabel as string | null | undefined),
    );
    if (!floorId)
      throw new BadRequestException(
        "The room does not have a valid parent floor.",
      );
    return this.locationMutation(() =>
      this.prisma.$transaction(
        async (tx) => {
          if (input.floorId || input.departmentId)
            await this.validateRoomParents(
              user,
              floorId,
              input.departmentId ?? undefined,
              tx,
            );
          const updated = await tx.room.update({
            where: { id },
            data: {
              ...(input.floorId !== undefined
                ? { floorId: input.floorId }
                : {}),
              ...(input.departmentId !== undefined
                ? { departmentId: input.departmentId }
                : {}),
              ...(input.code !== undefined
                ? { code: input.code.trim().toUpperCase() }
                : {}),
              ...(input.name !== undefined ? { name: input.name.trim() } : {}),
              ...(input.roomNumber !== undefined
                ? { roomNumber: input.roomNumber?.trim() || null }
                : {}),
              ...(input.roomType !== undefined
                ? { roomType: input.roomType }
                : {}),
              customRoomTypeLabel,
              ...(input.capacity !== undefined
                ? { capacity: input.capacity }
                : {}),
              ...(input.description !== undefined
                ? { description: input.description?.trim() || null }
                : {}),
              ...(input.isActive !== undefined
                ? { isActive: input.isActive }
                : {}),
              ...(input.isTestData !== undefined
                ? { isTestData: input.isTestData }
                : {}),
              ...(input.sortOrder !== undefined
                ? { sortOrder: input.sortOrder }
                : {}),
            },
          });
          await this.audit.record(
            {
              actorId: user.id,
              action: "location.room_updated",
              entityType: "Room",
              entityId: id,
              beforeValue: existing,
              afterValue: updated,
              requestId,
            },
            tx,
          );
          return updated;
        },
        { isolationLevel: "Serializable" },
      ),
    );
  }

  async presignImage(
    user: AuthPrincipal,
    kind: LocationKind,
    id: string,
    input: PresignLocationImageDto,
    publicEndpoint?: string,
  ) {
    const existing = await this.requireLocation(user, kind, id);
    this.requireNotArchived(existing);
    return this.storage.presignManagedImage(
      user,
      this.imageFolder(kind),
      id,
      input,
      publicEndpoint,
    );
  }

  async completeImage(
    user: AuthPrincipal,
    kind: LocationKind,
    id: string,
    input: CompleteLocationImageDto,
    requestId: string,
    publicEndpoint?: string,
  ) {
    const existing = await this.requireLocation(user, kind, id);
    this.requireNotArchived(existing);
    if (input.storageKey === existing.imageStorageKey) {
      const urls = await this.storage.managedImageUrls(
        user,
        this.imageFolder(kind),
        id,
        input.storageKey,
        publicEndpoint,
      );
      return {
        record: existing as unknown,
        image: urls,
        storageCleanup: { deleted: 0, failed: 0 },
      };
    }
    let outcome: {
      record: unknown;
      previousStorageKey: string | null;
      prepared?: Awaited<ReturnType<StorageService["prepareManagedImage"]>>;
    };
    try {
      outcome = await this.locationMutation(() =>
        this.prisma.$transaction(
          async (tx) => {
            await this.lockLocationImage(tx, user, kind, id);
            const current = await this.requireLocation(user, kind, id, tx);
            this.requireNotArchived(current);
            if (current.imageStorageKey === input.storageKey) {
              return {
                record: current as unknown,
                previousStorageKey: current.imageStorageKey,
              };
            }
            const prepared = await this.storage.prepareManagedImage(
              user,
              this.imageFolder(kind),
              id,
              input,
            );
            const updated = await this.updateImageStorageKey(
              tx,
              kind,
              id,
              input.storageKey,
            );
            if (current.imageStorageKey) {
              await this.enqueueManagedImageCleanup(
                tx,
                user,
                kind,
                id,
                current.imageStorageKey,
                "REPLACED",
              );
            }
            await this.audit.record(
              {
                actorId: user.id,
                action: current.imageStorageKey
                  ? `location.${kind}_image_replaced`
                  : `location.${kind}_image_uploaded`,
                entityType: this.entityName(kind),
                entityId: id,
                beforeValue: { imageStorageKey: current.imageStorageKey },
                afterValue: {
                  imageStorageKey: input.storageKey,
                  thumbnailKey: prepared.thumbnailKey,
                  width: prepared.width,
                  height: prepared.height,
                  sizeBytes: prepared.sizeBytes,
                  sha256: prepared.sha256,
                },
                requestId,
              },
              tx,
            );
            return {
              record: updated,
              previousStorageKey: current.imageStorageKey,
              prepared,
            };
          },
          { isolationLevel: "Serializable" },
        ),
      );
    } catch (error) {
      try {
        await this.enqueueManagedImageCleanup(
          this.prisma,
          user,
          kind,
          id,
          input.storageKey,
          "COMPENSATION",
        );
      } catch (cleanupQueueError) {
        this.logger.error(
          {
            kind,
            entityId: id,
            error:
              cleanupQueueError instanceof Error
                ? cleanupQueueError.message
                : "Unknown cleanup ledger error",
          },
          "Could not persist managed image compensation cleanup",
        );
      }
      await this.deleteImageIfUnreferenced(user, kind, id, input.storageKey);
      throw error;
    }
    if (!outcome.prepared) {
      const urls = await this.storage.managedImageUrls(
        user,
        this.imageFolder(kind),
        id,
        input.storageKey,
        publicEndpoint,
      );
      return {
        record: outcome.record,
        image: urls,
        storageCleanup: { deleted: 0, failed: 0 },
      };
    }
    const storageCleanup =
      outcome.previousStorageKey &&
      outcome.previousStorageKey !== input.storageKey
        ? await this.deleteImageIfUnreferenced(
            user,
            kind,
            id,
            outcome.previousStorageKey,
          )
        : { deleted: 0, failed: 0 };
    const urls = await this.storage.managedImageUrls(
      user,
      this.imageFolder(kind),
      id,
      input.storageKey,
      publicEndpoint,
    );
    return {
      record: outcome.record,
      image: {
        ...urls,
        width: outcome.prepared.width,
        height: outcome.prepared.height,
        sizeBytes: outcome.prepared.sizeBytes,
        sha256: outcome.prepared.sha256,
      },
      storageCleanup,
    };
  }

  private async deleteImageIfUnreferenced(
    user: AuthPrincipal,
    kind: LocationKind,
    id: string,
    storageKey: string,
  ): Promise<{ deleted: number; failed: number }> {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          await this.lockLocationImage(tx, user, kind, id);
          try {
            const current = await this.requireLocation(user, kind, id, tx);
            if (current.imageStorageKey === storageKey) {
              return { deleted: 0, failed: 0 };
            }
          } catch (error) {
            if (!(error instanceof NotFoundException)) throw error;
          }
          return this.storage.deleteManagedImageObjects(
            user,
            this.imageFolder(kind),
            id,
            storageKey,
          );
        },
        { isolationLevel: "Serializable" },
      );
    } catch (error) {
      this.logger.warn(
        {
          kind,
          entityId: id,
          error:
            error instanceof Error
              ? error.message
              : "Unknown storage cleanup error",
        },
        "Skipped or failed unreferenced image compensation",
      );
      return { deleted: 0, failed: 1 };
    }
  }

  async image(
    user: AuthPrincipal,
    kind: LocationKind,
    id: string,
    publicEndpoint?: string,
  ) {
    const existing = await this.requireLocation(user, kind, id);
    if (!existing.imageStorageKey)
      throw new NotFoundException("Location image not found.");
    return this.storage.managedImageUrls(
      user,
      this.imageFolder(kind),
      id,
      existing.imageStorageKey,
      publicEndpoint,
    );
  }

  async removeImage(
    user: AuthPrincipal,
    kind: LocationKind,
    id: string,
    requestId: string,
  ) {
    const storageKey = await this.locationMutation(() =>
      this.prisma.$transaction(
        async (tx) => {
          await this.lockLocationImage(tx, user, kind, id);
          const existing = await this.requireLocation(user, kind, id, tx);
          if (!existing.imageStorageKey) return null;
          await this.updateImageStorageKey(tx, kind, id, null);
          await this.enqueueManagedImageCleanup(
            tx,
            user,
            kind,
            id,
            existing.imageStorageKey,
            "REMOVED",
          );
          await this.audit.record(
            {
              actorId: user.id,
              action: `location.${kind}_image_removed`,
              entityType: this.entityName(kind),
              entityId: id,
              beforeValue: { imageStorageKey: existing.imageStorageKey },
              afterValue: { imageStorageKey: null },
              requestId,
            },
            tx,
          );
          return existing.imageStorageKey;
        },
        { isolationLevel: "Serializable" },
      ),
    );
    if (!storageKey)
      return { removed: false, storageCleanup: { deleted: 0, failed: 0 } };
    const storageCleanup = await this.deleteImageIfUnreferenced(
      user,
      kind,
      id,
      storageKey,
    );
    return { removed: true, storageCleanup };
  }

  async dependencyReport(
    user: AuthPrincipal,
    kind: LocationKind,
    id: string,
    client: LocationClient = this.prisma,
  ) {
    await this.requireLocation(user, kind, id, client);
    const scopeType = kind.toUpperCase() as
      | "CAMPUS"
      | "BLOCK"
      | "FLOOR"
      | "ROOM";
    const common = await Promise.all([
      client.userScope.count({ where: { scopeType, scopeId: id } }),
      client.announcementAudience.count({ where: { scopeType, scopeId: id } }),
      client.qrCode.count({
        where: {
          entityType: { equals: kind, mode: "insensitive" },
          entityId: id,
        },
      }),
      client.conversation.count({
        where: { collegeId: user.collegeId, linkedEntityId: id },
      }),
    ]);
    let specific: Record<string, number>;
    if (kind === "campus") {
      const values = await Promise.all([
        client.block.count({ where: { campusId: id } }),
        client.floor.count({ where: { block: { campusId: id } } }),
        client.room.count({ where: { floor: { block: { campusId: id } } } }),
        client.area.count({ where: { floor: { block: { campusId: id } } } }),
        client.department.count({ where: { campusId: id } }),
        client.issue.count({ where: { campusId: id } }),
        client.feedbackTarget.count({ where: { campusId: id } }),
        client.issueAssignmentRule.count({
          where: { collegeId: user.collegeId, campusId: id },
        }),
      ]);
      specific = {
        blocks: values[0],
        floors: values[1],
        rooms: values[2],
        areas: values[3],
        departments: values[4],
        issues: values[5],
        feedbackQrTargets: values[6],
        routingRules: values[7],
      };
    } else if (kind === "block") {
      const values = await Promise.all([
        client.floor.count({ where: { blockId: id } }),
        client.room.count({ where: { floor: { blockId: id } } }),
        client.area.count({ where: { floor: { blockId: id } } }),
        client.issue.count({ where: { blockId: id } }),
        client.feedbackTarget.count({ where: { blockId: id } }),
        client.issueAssignmentRule.count({
          where: { collegeId: user.collegeId, blockId: id },
        }),
      ]);
      specific = {
        floors: values[0],
        rooms: values[1],
        areas: values[2],
        issues: values[3],
        feedbackQrTargets: values[4],
        routingRules: values[5],
      };
    } else if (kind === "floor") {
      const values = await Promise.all([
        client.room.count({ where: { floorId: id } }),
        client.area.count({ where: { floorId: id } }),
        client.issue.count({ where: { floorId: id } }),
        client.feedbackTarget.count({ where: { floorId: id } }),
        client.issueAssignmentRule.count({
          where: { collegeId: user.collegeId, floorId: id },
        }),
      ]);
      specific = {
        rooms: values[0],
        areas: values[1],
        issues: values[2],
        feedbackQrTargets: values[3],
        routingRules: values[4],
      };
    } else {
      const values = await Promise.all([
        client.section.count({ where: { assignedRoomId: id } }),
        client.attendanceSession.count({
          where: { section: { assignedRoomId: id } },
        }),
        client.asset.count({ where: { roomId: id } }),
        client.issue.count({ where: { roomId: id } }),
        client.roomResponsiblePerson.count({ where: { roomId: id } }),
        client.feedbackTarget.count({ where: { roomId: id } }),
        client.issueAssignmentRule.count({
          where: { collegeId: user.collegeId, roomId: id },
        }),
      ]);
      specific = {
        sections: values[0],
        attendanceSessions: values[1],
        assets: values[2],
        issues: values[3],
        responsibleStaff: values[4],
        feedbackQrTargets: values[5],
        routingRules: values[6],
      };
    }
    const counts = {
      ...specific,
      assignedUsers: common[0],
      announcements: common[1],
      qrCodes: common[2],
      messengerGroups: common[3],
    };
    const totalDependencies = Object.values(counts).reduce(
      (sum, count) => sum + count,
      0,
    );
    return {
      kind,
      id,
      canDelete: totalDependencies === 0,
      totalDependencies,
      counts,
      dependencies: counts,
      message:
        totalDependencies === 0
          ? "No dependencies were found. Permanent deletion is available to Main Admin."
          : "This location cannot be permanently deleted because it is in use. Move or archive the related records first.",
    };
  }

  async archive(
    user: AuthPrincipal,
    kind: LocationKind,
    id: string,
    input: ArchiveLocationDto,
    requestId: string,
  ) {
    const existing = await this.requireLocation(user, kind, id);
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      let updated: unknown;
      if (kind === "campus")
        updated = await tx.campus.update({
          where: { id },
          data: { archivedAt: now, isActive: false },
        });
      else if (kind === "block")
        updated = await tx.block.update({
          where: { id },
          data: { archivedAt: now, isActive: false },
        });
      else if (kind === "floor")
        updated = await tx.floor.update({
          where: { id },
          data: { archivedAt: now, isActive: false },
        });
      else
        updated = await tx.room.update({
          where: { id },
          data: { archivedAt: now, isActive: false },
        });
      await tx.archivedRecord.create({
        data: {
          collegeId: user.collegeId,
          entityType: this.entityName(kind),
          entityId: id,
          reason: input.reason.trim(),
          archivedById: user.id,
          metadata: { code: existing.code, name: existing.name },
        },
      });
      await this.audit.record(
        {
          actorId: user.id,
          action: `location.${kind}_archived`,
          entityType: this.entityName(kind),
          entityId: id,
          beforeValue: existing,
          afterValue: updated,
          reason: input.reason,
          requestId,
        },
        tx,
      );
      return updated;
    });
  }

  async restore(
    user: AuthPrincipal,
    kind: LocationKind,
    id: string,
    requestId: string,
  ) {
    const existing = await this.requireLocation(user, kind, id);
    if (!existing.archivedAt)
      throw new BadRequestException("This location is not archived.");
    await this.requireActiveParent(user, kind, existing);
    return this.prisma.$transaction(async (tx) => {
      let updated: unknown;
      if (kind === "campus")
        updated = await tx.campus.update({
          where: { id },
          data: { archivedAt: null, isActive: true },
        });
      else if (kind === "block")
        updated = await tx.block.update({
          where: { id },
          data: { archivedAt: null, isActive: true },
        });
      else if (kind === "floor")
        updated = await tx.floor.update({
          where: { id },
          data: { archivedAt: null, isActive: true },
        });
      else
        updated = await tx.room.update({
          where: { id },
          data: { archivedAt: null, isActive: true },
        });
      await tx.archivedRecord.updateMany({
        where: {
          entityType: this.entityName(kind),
          entityId: id,
          restoredAt: null,
        },
        data: { restoredAt: new Date() },
      });
      await this.audit.record(
        {
          actorId: user.id,
          action: `location.${kind}_restored`,
          entityType: this.entityName(kind),
          entityId: id,
          beforeValue: existing,
          afterValue: updated,
          requestId,
        },
        tx,
      );
      return updated;
    });
  }

  async removePermanently(
    user: AuthPrincipal,
    kind: LocationKind,
    id: string,
    reason: string,
    confirmationPhrase: string,
    requestId: string,
  ) {
    if (
      !user.roles.some((role) => ["SUPER_ADMIN", "MAIN_ADMIN"].includes(role))
    ) {
      throw new ForbiddenException(
        "Only Main Admin can permanently delete a location.",
      );
    }
    if (confirmationPhrase !== "PERMANENTLY DELETE LOCATION")
      throw new BadRequestException("The confirmation phrase is incorrect.");
    const outcome = await this.locationMutation(() =>
      this.prisma.$transaction(
        async (tx) => {
          await this.lockLocationImage(tx, user, kind, id);
          const existing = await this.requireLocation(user, kind, id, tx);
          if (!existing.archivedAt && !existing.isTestData) {
            throw new BadRequestException(
              "Archive this location first, or mark verified test data before permanent deletion.",
            );
          }
          const report = await this.dependencyReport(user, kind, id, tx);
          if (!report.canDelete)
            throw new BadRequestException({
              message: report.message,
              dependencyReport: report,
            });
          await this.audit.record(
            {
              actorId: user.id,
              action: `location.${kind}_deleted`,
              entityType: this.entityName(kind),
              entityId: id,
              beforeValue: existing,
              afterValue: { deleted: true, dependencyReport: report },
              reason,
              requestId,
            },
            tx,
          );
          if (existing.imageStorageKey) {
            await this.enqueueManagedImageCleanup(
              tx,
              user,
              kind,
              id,
              existing.imageStorageKey,
              "PERMANENT_DELETE",
            );
          }
          if (kind === "campus") await tx.campus.delete({ where: { id } });
          else if (kind === "block") await tx.block.delete({ where: { id } });
          else if (kind === "floor") await tx.floor.delete({ where: { id } });
          else await tx.room.delete({ where: { id } });
          return { existing, report };
        },
        { isolationLevel: "Serializable" },
      ),
    );
    const storageCleanup = outcome.existing.imageStorageKey
      ? await this.deleteImageIfUnreferenced(
          user,
          kind,
          id,
          outcome.existing.imageStorageKey,
        )
      : { deleted: 0, failed: 0 };
    return {
      id,
      kind,
      deleted: true,
      dependencyReport: outcome.report,
      storageCleanup,
    };
  }

  async bulkArchive(
    user: AuthPrincipal,
    kind: LocationKind,
    ids: string[],
    reason: string,
    requestId: string,
  ) {
    const results = [];
    for (const id of [...new Set(ids)])
      results.push(await this.archive(user, kind, id, { reason }, requestId));
    return { archived: results.length, results };
  }

  async bulkRestore(
    user: AuthPrincipal,
    kind: LocationKind,
    ids: string[],
    requestId: string,
  ) {
    const results = [];
    for (const id of [...new Set(ids)])
      results.push(await this.restore(user, kind, id, requestId));
    return { restored: results.length, results };
  }

  private async requireLocation(
    user: AuthPrincipal,
    kind: LocationKind,
    id: string,
    client: LocationClient = this.prisma,
  ) {
    let record: Record<string, unknown> | null;
    if (kind === "campus")
      record = await client.campus.findFirst({
        where: { id, collegeId: user.collegeId },
      });
    else if (kind === "block")
      record = await client.block.findFirst({
        where: { id, campus: { collegeId: user.collegeId } },
      });
    else if (kind === "floor")
      record = await client.floor.findFirst({
        where: { id, block: { campus: { collegeId: user.collegeId } } },
      });
    else
      record = await client.room.findFirst({
        where: {
          id,
          floor: { block: { campus: { collegeId: user.collegeId } } },
        },
      });
    if (!record)
      throw new NotFoundException(`${this.entityName(kind)} not found.`);
    return record as LocationSnapshot;
  }

  private async requireActiveParent(
    user: AuthPrincipal,
    kind: LocationKind,
    record: { campusId?: string; blockId?: string; floorId?: string },
  ) {
    if (kind === "block" && record.campusId) {
      await this.requireActiveCampus(user, record.campusId);
    } else if (kind === "floor" && record.blockId) {
      await this.requireActiveBlock(user, record.blockId);
    } else if (kind === "room" && record.floorId) {
      await this.requireActiveFloor(user, record.floorId);
    }
  }

  private async validateRoomParents(
    user: AuthPrincipal,
    floorId: string,
    departmentId?: string | null,
    client: LocationClient = this.prisma,
  ) {
    await this.requireActiveFloor(user, floorId, client);
    if (departmentId) {
      const department = await client.department.findFirst({
        where: {
          id: departmentId,
          collegeId: user.collegeId,
          isActive: true,
          archivedAt: null,
        },
      });
      if (!department)
        throw new BadRequestException("The selected department is not active.");
    }
  }

  private validatedCustomRoomTypeLabel(
    roomType: RoomType,
    value: unknown,
  ): string | null {
    if (roomType !== RoomType.OTHER) return null;
    const normalized = typeof value === "string" ? value.trim() : "";
    if (normalized.length < 2 || normalized.length > 80) {
      throw new BadRequestException(
        "Custom room type label must be between 2 and 80 characters when room type is OTHER.",
      );
    }
    return normalized;
  }

  private statusWhere(status?: string) {
    if (status === "ARCHIVED") return { archivedAt: { not: null } };
    if (status === "ACTIVE") return { archivedAt: null, isActive: true };
    if (status === "INACTIVE") return { archivedAt: null, isActive: false };
    if (status === "TEST_DATA") return { archivedAt: null, isTestData: true };
    return {};
  }

  private async locationListResult<T>(
    filters: LocationFilters,
    load: (pagination: { skip?: number; take?: number }) => Promise<T[]>,
    count: () => Promise<number>,
  ): Promise<
    | T[]
    | {
        data: T[];
        meta: {
          page: number;
          pageSize: number;
          total: number;
          pageCount: number;
        };
      }
  > {
    const paginationRequested =
      filters.page !== undefined || filters.pageSize !== undefined;
    if (!paginationRequested) return load({});
    const page = filters.page ?? 1;
    const pageSize = filters.pageSize ?? 25;
    const [data, total] = await Promise.all([
      load({ skip: (page - 1) * pageSize, take: pageSize }),
      count(),
    ]);
    return {
      data,
      meta: {
        page,
        pageSize,
        total,
        pageCount: Math.ceil(total / pageSize),
      },
    };
  }

  private async locationMutation<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? String((error as { code?: unknown }).code ?? "")
          : "";
      if (code === "P2002") {
        throw new ConflictException(
          "A location with this code already exists under the selected parent.",
        );
      }
      if (["P2003", "P2014"].includes(code)) {
        throw new ConflictException(
          "This location is still linked to other records. Review its dependencies and try again.",
        );
      }
      if (code === "P2025") throw new NotFoundException("Location not found.");
      if (code === "P2034") {
        throw new ConflictException(
          "The location changed while dependencies were checked. Review it and try again.",
        );
      }
      throw error;
    }
  }

  private imageFolder(kind: LocationKind): ManagedImageFolder {
    return kind === "campus" ? "campuses" : (`${kind}s` as ManagedImageFolder);
  }

  private async lockLocationImage(
    tx: Prisma.TransactionClient,
    user: AuthPrincipal,
    kind: LocationKind,
    id: string,
  ): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`location-image:${user.collegeId}:${kind}:${id}`}))`;
  }

  private requireNotArchived(location: LocationSnapshot): void {
    if (location.archivedAt)
      throw new BadRequestException(
        "Restore this location before changing its image.",
      );
  }

  private updateImageStorageKey(
    tx: Prisma.TransactionClient,
    kind: LocationKind,
    id: string,
    imageStorageKey: string | null,
  ) {
    if (kind === "campus")
      return tx.campus.update({ where: { id }, data: { imageStorageKey } });
    if (kind === "block")
      return tx.block.update({ where: { id }, data: { imageStorageKey } });
    if (kind === "floor")
      return tx.floor.update({ where: { id }, data: { imageStorageKey } });
    return tx.room.update({ where: { id }, data: { imageStorageKey } });
  }

  private enqueueManagedImageCleanup(
    client: LocationClient,
    user: AuthPrincipal,
    kind: LocationKind,
    entityId: string,
    storageKey: string,
    reason: "REPLACED" | "REMOVED" | "PERMANENT_DELETE" | "COMPENSATION",
  ) {
    const idempotencyKey = `location-image-delete:${createHash("sha256")
      .update(storageKey)
      .digest("hex")}`;
    return client.outboxEvent.upsert({
      where: { idempotencyKey },
      create: {
        aggregateType: "LocationImage",
        aggregateId: entityId,
        eventType: "storage.managed_image.delete",
        payload: {
          collegeId: user.collegeId,
          folder: this.imageFolder(kind),
          entityId,
          storageKey,
          reason,
        },
        idempotencyKey,
      },
      update: {
        availableAt: new Date(),
        processedAt: null,
        lastError: null,
      },
    });
  }

  private async qrRoom(user: AuthPrincipal, where: { id: string }) {
    const room = await this.prisma.room.findFirst({
      where: {
        ...where,
        isActive: true,
        archivedAt: null,
        floor: { block: { campus: { collegeId: user.collegeId } } },
      },
      select: {
        id: true,
        code: true,
        name: true,
        roomNumber: true,
        roomType: true,
        customRoomTypeLabel: true,
        qrToken: true,
        floor: {
          select: {
            name: true,
            block: {
              select: { name: true, campus: { select: { name: true } } },
            },
          },
        },
      },
    });
    if (!room) throw new NotFoundException("Active room not found.");
    return room;
  }

  private async qrPayload(room: {
    id: string;
    code: string;
    name: string;
    roomNumber: string | null;
    roomType: string;
    customRoomTypeLabel: string | null;
    qrToken: string;
    floor: { name: string; block: { name: string; campus: { name: string } } };
  }) {
    const webUrl = (
      this.config.get<string>("PUBLIC_APP_URL") ??
      this.config.get<string>("WEB_URL", "http://localhost:3000")
    ).replace(/\/$/, "");
    const reportUrl = `${webUrl}/report-issue?roomToken=${room.qrToken}`;
    const dataUrl = await QRCode.toDataURL(reportUrl, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 512,
    });
    return { ...room, reportUrl, dataUrl };
  }

  private entityName(kind: LocationKind) {
    return kind.charAt(0).toUpperCase() + kind.slice(1);
  }

  confirmationHash(value: string) {
    return createHash("sha256").update(value).digest("hex");
  }
}
