import { BadRequestException, Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Permissions } from "../../common/decorators/permissions.decorator";
import { CurrentRequestId } from "../../common/decorators/request-id.decorator";
import type { AuthPrincipal } from "../../common/http/request-context";
import { ArchiveLocationDto, BulkLocationDto, CreateBlockDto, CreateCampusDto, CreateFloorDto, CreateRoomDto, DeleteLocationDto, UpdateBlockDto, UpdateCampusDto, UpdateFloorDto, UpdateRoomDto } from "./dto/location.dto";
import { LocationsService, type LocationKind } from "./locations.service";

@ApiTags("locations")
@Controller("locations")
export class LocationsController {
  constructor(private readonly locations: LocationsService) {}

  @Get("campuses") campuses(@CurrentUser() user: AuthPrincipal) { return this.locations.campuses(user); }
  @Get("blocks") blocks(@CurrentUser() user: AuthPrincipal, @Query("campusId", ParseUUIDPipe) campusId: string) { return this.locations.blocks(user, campusId); }
  @Get("floors") floors(@CurrentUser() user: AuthPrincipal, @Query("blockId", ParseUUIDPipe) blockId: string) { return this.locations.floors(user, blockId); }
  @Get("rooms") rooms(@CurrentUser() user: AuthPrincipal, @Query("floorId", ParseUUIDPipe) floorId: string) { return this.locations.rooms(user, floorId); }
  @Get("rooms/qr/:token") roomByQr(@CurrentUser() user: AuthPrincipal, @Param("token", ParseUUIDPipe) token: string) { return this.locations.roomByQr(user, token); }
  @Permissions("locations.qr") @Get("rooms/:id/qr-code") roomQr(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string) { return this.locations.roomQr(user, id); }
  @Permissions("locations.qr") @Get("qr-sheet") qrSheet(@CurrentUser() user: AuthPrincipal, @Query("floorId", ParseUUIDPipe) floorId: string) { return this.locations.qrSheet(user, floorId); }
  @Permissions("locations.qr") @Post("rooms/:id/qr-code/rotate") rotateQr(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string) { return this.locations.rotateQr(user, id); }
  @Get("assets") assets(@CurrentUser() user: AuthPrincipal, @Query("roomId", ParseUUIDPipe) roomId: string) { return this.locations.assets(user, roomId); }

  @Permissions("locations.manage")
  @Post("blocks") createBlock(@CurrentUser() user: AuthPrincipal, @Body() input: CreateBlockDto, @CurrentRequestId() requestId: string) { return this.locations.createBlock(user, input, requestId); }
  @Permissions("locations.manage")
  @Post("floors") createFloor(@CurrentUser() user: AuthPrincipal, @Body() input: CreateFloorDto, @CurrentRequestId() requestId: string) { return this.locations.createFloor(user, input, requestId); }
  @Permissions("locations.manage")
  @Post("rooms") createRoom(@CurrentUser() user: AuthPrincipal, @Body() input: CreateRoomDto, @CurrentRequestId() requestId: string) { return this.locations.createRoom(user, input, requestId); }
}

@ApiTags("admin locations")
@Permissions("locations.manage")
@Controller("admin")
export class AdminLocationsController {
  constructor(private readonly locations: LocationsService) {}

  @Get("campuses") campuses(@CurrentUser() user: AuthPrincipal, @Query("search") search?: string, @Query("status") status?: string) {
    return this.locations.adminList(user, "campus", { search, status });
  }
  @Post("campuses") createCampus(@CurrentUser() user: AuthPrincipal, @Body() input: CreateCampusDto, @CurrentRequestId() requestId: string) {
    return this.locations.createCampus(user, input, requestId);
  }
  @Patch("campuses/:id") updateCampus(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string, @Body() input: UpdateCampusDto, @CurrentRequestId() requestId: string) {
    return this.locations.updateCampus(user, id, input, requestId);
  }

  @Get("blocks") blocks(@CurrentUser() user: AuthPrincipal, @Query("campusId") campusId?: string, @Query("search") search?: string, @Query("status") status?: string) {
    return this.locations.adminList(user, "block", { parentId: campusId, search, status });
  }
  @Post("blocks") createBlock(@CurrentUser() user: AuthPrincipal, @Body() input: CreateBlockDto, @CurrentRequestId() requestId: string) {
    return this.locations.createBlock(user, input, requestId);
  }
  @Patch("blocks/:id") updateBlock(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string, @Body() input: UpdateBlockDto, @CurrentRequestId() requestId: string) {
    return this.locations.updateBlock(user, id, input, requestId);
  }

  @Get("floors") floors(@CurrentUser() user: AuthPrincipal, @Query("blockId") blockId?: string, @Query("search") search?: string, @Query("status") status?: string) {
    return this.locations.adminList(user, "floor", { parentId: blockId, search, status });
  }
  @Post("floors") createFloor(@CurrentUser() user: AuthPrincipal, @Body() input: CreateFloorDto, @CurrentRequestId() requestId: string) {
    return this.locations.createFloor(user, input, requestId);
  }
  @Patch("floors/:id") updateFloor(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string, @Body() input: UpdateFloorDto, @CurrentRequestId() requestId: string) {
    return this.locations.updateFloor(user, id, input, requestId);
  }

  @Get("rooms") rooms(@CurrentUser() user: AuthPrincipal, @Query("floorId") floorId?: string, @Query("search") search?: string, @Query("status") status?: string) {
    return this.locations.adminList(user, "room", { parentId: floorId, search, status });
  }
  @Post("rooms") createRoom(@CurrentUser() user: AuthPrincipal, @Body() input: CreateRoomDto, @CurrentRequestId() requestId: string) {
    return this.locations.createRoom(user, input, requestId);
  }
  @Patch("rooms/:id") updateRoom(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string, @Body() input: UpdateRoomDto, @CurrentRequestId() requestId: string) {
    return this.locations.updateRoom(user, id, input, requestId);
  }

  @Get("locations/archived")
  archived(@CurrentUser() user: AuthPrincipal, @Query("type") type?: string, @Query("search") search?: string) {
    const kind = type ? this.kind(type) : undefined;
    return kind
      ? this.locations.adminList(user, kind, { status: "ARCHIVED", search })
      : Promise.all((["campus", "block", "floor", "room"] as const).map(async (item) => ({ type: item, records: await this.locations.adminList(user, item, { status: "ARCHIVED", search }) })));
  }

  @Get(":type/:id/dependencies")
  dependencies(@CurrentUser() user: AuthPrincipal, @Param("type") type: string, @Param("id", ParseUUIDPipe) id: string) {
    return this.locations.dependencyReport(user, this.kind(type), id);
  }
  @Post(":type/:id/archive")
  archive(@CurrentUser() user: AuthPrincipal, @Param("type") type: string, @Param("id", ParseUUIDPipe) id: string, @Body() input: ArchiveLocationDto, @CurrentRequestId() requestId: string) {
    return this.locations.archive(user, this.kind(type), id, input, requestId);
  }
  @Post(":type/:id/restore")
  restore(@CurrentUser() user: AuthPrincipal, @Param("type") type: string, @Param("id", ParseUUIDPipe) id: string, @CurrentRequestId() requestId: string) {
    return this.locations.restore(user, this.kind(type), id, requestId);
  }
  @Delete(":type/:id")
  remove(@CurrentUser() user: AuthPrincipal, @Param("type") type: string, @Param("id", ParseUUIDPipe) id: string, @Body() input: DeleteLocationDto, @CurrentRequestId() requestId: string) {
    return this.locations.removePermanently(user, this.kind(type), id, input.reason, input.confirmationPhrase, requestId);
  }
  @Post("locations/:type/bulk-archive")
  bulkArchive(@CurrentUser() user: AuthPrincipal, @Param("type") type: string, @Body() input: BulkLocationDto, @CurrentRequestId() requestId: string) {
    return this.locations.bulkArchive(user, this.kind(type), input.ids, input.reason, requestId);
  }
  @Post("locations/:type/bulk-restore")
  bulkRestore(@CurrentUser() user: AuthPrincipal, @Param("type") type: string, @Body() input: BulkLocationDto, @CurrentRequestId() requestId: string) {
    return this.locations.bulkRestore(user, this.kind(type), input.ids, requestId);
  }

  private kind(value: string): LocationKind {
    const normalized = value.toLowerCase().replace(/s$/, "");
    if (!["campus", "block", "floor", "room"].includes(normalized)) throw new BadRequestException("Location type must be campus, block, floor or room.");
    return normalized as LocationKind;
  }
}
