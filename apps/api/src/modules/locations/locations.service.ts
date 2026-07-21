import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import QRCode from "qrcode";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../../database/prisma.service";
import type { AuthPrincipal } from "../../common/http/request-context";
import type { CreateBlockDto, CreateFloorDto, CreateRoomDto } from "./dto/location.dto";

@Injectable()
export class LocationsService {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}

  campuses(user: AuthPrincipal) {
    return this.prisma.campus.findMany({
      where: { collegeId: user.collegeId, isActive: true },
      select: { id: true, code: true, name: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
  }

  blocks(user: AuthPrincipal, campusId: string) {
    return this.prisma.block.findMany({
      where: { campusId, campus: { collegeId: user.collegeId }, isActive: true },
      select: { id: true, code: true, name: true, campusId: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
  }

  floors(user: AuthPrincipal, blockId: string) {
    return this.prisma.floor.findMany({
      where: { blockId, block: { campus: { collegeId: user.collegeId } }, isActive: true },
      select: { id: true, code: true, name: true, level: true, blockId: true },
      orderBy: [{ sortOrder: "asc" }, { level: "asc" }],
    });
  }

  rooms(user: AuthPrincipal, floorId: string) {
    return this.prisma.room.findMany({
      where: { floorId, floor: { block: { campus: { collegeId: user.collegeId } } }, isActive: true },
      select: { id: true, code: true, name: true, roomNumber: true, roomType: true, floorId: true, departmentId: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
  }

  assets(user: AuthPrincipal, roomId: string) {
    return this.prisma.asset.findMany({
      where: { roomId, room: { floor: { block: { campus: { collegeId: user.collegeId } } } }, isActive: true },
      select: { id: true, code: true, name: true, category: { select: { name: true } } },
      orderBy: { name: "asc" },
    });
  }

  async roomByQr(user: AuthPrincipal, token: string) {
    const room = await this.prisma.room.findFirst({
      where: { qrToken: token, isActive: true, floor: { block: { campus: { collegeId: user.collegeId } } } },
      select: {
        id: true, code: true, name: true, roomType: true,
        floor: { select: { id: true, name: true, block: { select: { id: true, name: true, campus: { select: { id: true, name: true } } } } } },
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
    const floor = await this.prisma.floor.findFirst({ where: { id: floorId, block: { campus: { collegeId: user.collegeId } } }, select: { id: true, name: true, block: { select: { name: true, campus: { select: { name: true } } } } } });
    if (!floor) throw new NotFoundException("Floor not found.");
    const rooms = await this.prisma.room.findMany({ where: { floorId, isActive: true }, select: { id: true, code: true, name: true, roomNumber: true, roomType: true, qrToken: true, floor: { select: { name: true, block: { select: { name: true, campus: { select: { name: true } } } } } } }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], take: 100 });
    return { floor, rooms: await Promise.all(rooms.map((room) => this.qrPayload(room))) };
  }

  async rotateQr(user: AuthPrincipal, id: string) {
    await this.qrRoom(user, { id });
    const room = await this.prisma.room.update({ where: { id }, data: { qrToken: randomUUID() }, select: { id: true, code: true, name: true, roomNumber: true, roomType: true, qrToken: true, floor: { select: { name: true, block: { select: { name: true, campus: { select: { name: true } } } } } } } });
    return this.qrPayload(room);
  }

  async createBlock(user: AuthPrincipal, input: CreateBlockDto) {
    const campus = await this.prisma.campus.findFirst({ where: { id: input.campusId, collegeId: user.collegeId, isActive: true } });
    if (!campus) throw new BadRequestException("The selected campus is not active.");
    return this.prisma.block.create({ data: { ...input, code: input.code.trim().toUpperCase(), name: input.name.trim() } });
  }

  async createFloor(user: AuthPrincipal, input: CreateFloorDto) {
    const block = await this.prisma.block.findFirst({ where: { id: input.blockId, campus: { collegeId: user.collegeId }, isActive: true } });
    if (!block) throw new BadRequestException("The selected block is not active.");
    return this.prisma.floor.create({ data: { ...input, code: input.code.trim().toUpperCase(), name: input.name.trim() } });
  }

  async createRoom(user: AuthPrincipal, input: CreateRoomDto) {
    const floor = await this.prisma.floor.findFirst({ where: { id: input.floorId, block: { campus: { collegeId: user.collegeId } }, isActive: true } });
    if (!floor) throw new BadRequestException("The selected floor is not active.");
    if (input.departmentId) {
      const department = await this.prisma.department.findFirst({ where: { id: input.departmentId, collegeId: user.collegeId, isActive: true } });
      if (!department) throw new BadRequestException("The selected department is not active.");
    }
    return this.prisma.room.create({ data: { ...input, code: input.code.trim().toUpperCase(), name: input.name.trim() } });
  }

  private async qrRoom(user: AuthPrincipal, where: { id: string }) {
    const room = await this.prisma.room.findFirst({ where: { ...where, isActive: true, floor: { block: { campus: { collegeId: user.collegeId } } } }, select: { id: true, code: true, name: true, roomNumber: true, roomType: true, qrToken: true, floor: { select: { name: true, block: { select: { name: true, campus: { select: { name: true } } } } } } } });
    if (!room) throw new NotFoundException("Active room not found.");
    return room;
  }

  private async qrPayload(room: { id: string; code: string; name: string; roomNumber: string | null; roomType: string; qrToken: string; floor: { name: string; block: { name: string; campus: { name: string } } } }) {
    const webUrl = this.config.get<string>("WEB_URL", "http://localhost:3000").replace(/\/$/, "");
    const reportUrl = `${webUrl}/report-issue?roomToken=${room.qrToken}`;
    const dataUrl = await QRCode.toDataURL(reportUrl, { errorCorrectionLevel: "M", margin: 1, width: 512 });
    return { ...room, reportUrl, dataUrl };
  }
}
