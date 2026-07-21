import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Permissions } from "../../common/decorators/permissions.decorator";
import type { AuthPrincipal } from "../../common/http/request-context";
import { CreateBlockDto, CreateFloorDto, CreateRoomDto } from "./dto/location.dto";
import { LocationsService } from "./locations.service";

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
  @Post("blocks") createBlock(@CurrentUser() user: AuthPrincipal, @Body() input: CreateBlockDto) { return this.locations.createBlock(user, input); }
  @Permissions("locations.manage")
  @Post("floors") createFloor(@CurrentUser() user: AuthPrincipal, @Body() input: CreateFloorDto) { return this.locations.createFloor(user, input); }
  @Permissions("locations.manage")
  @Post("rooms") createRoom(@CurrentUser() user: AuthPrincipal, @Body() input: CreateRoomDto) { return this.locations.createRoom(user, input); }
}
