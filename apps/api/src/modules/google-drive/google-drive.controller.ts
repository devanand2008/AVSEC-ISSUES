import {
  Body,
  Controller,
  Delete,
  Get,
  Post,
  Query,
  UseFilters,
} from "@nestjs/common";
import { ApiProperty, ApiTags } from "@nestjs/swagger";
import { IsString, Length } from "class-validator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Permissions } from "../../common/decorators/permissions.decorator";
import type { AuthPrincipal } from "../../common/http/request-context";
import { GoogleDriveExceptionFilter } from "./google-drive-exception.filter";
import { GoogleDriveOAuthService } from "./google-drive-oauth.service";
import { GoogleDriveStorageService } from "./google-drive-storage.service";
import { GoogleDriveHierarchyService } from "./google-drive-hierarchy.service";

class GoogleDriveCallbackQuery {
  @ApiProperty()
  @IsString()
  @Length(1, 4096)
  code!: string;

  @ApiProperty()
  @IsString()
  @Length(32, 256)
  state!: string;
}

class CreateGoogleDriveFolderDto {
  @ApiProperty()
  @IsString()
  @Length(1, 255)
  name!: string;

  @ApiProperty({ required: false, default: "root" })
  @IsString()
  @Length(1, 256)
  parentId = "root";
}

@ApiTags("Google Drive storage")
@Controller("admin/storage/google-drive")
@UseFilters(GoogleDriveExceptionFilter)
export class GoogleDriveController {
  constructor(
    private readonly oauth: GoogleDriveOAuthService,
    private readonly storage: GoogleDriveStorageService,
    private readonly hierarchy: GoogleDriveHierarchyService,
  ) {}

  @Permissions("settings.read")
  @Get("status")
  async status(@CurrentUser() user: AuthPrincipal) {
    const connection = await this.oauth.status(user.id);
    if (!connection.connected) return connection;
    return { ...connection, ...(await this.hierarchy.status(user.id)) };
  }

  @Permissions("integrations.manage")
  @Post("authorize")
  authorize(@CurrentUser() user: AuthPrincipal) {
    return this.oauth.authorizationUrl(user.id, user.email);
  }

  @Permissions("integrations.manage")
  @Get("callback")
  async callback(
    @CurrentUser() user: AuthPrincipal,
    @Query() query: GoogleDriveCallbackQuery,
  ) {
    const connection = await this.oauth.completeAuthorization(user.id, query);
    return { ...connection, ...(await this.hierarchy.ensure(user.id)) };
  }

  @Permissions("integrations.manage")
  @Delete()
  revoke(@CurrentUser() user: AuthPrincipal) {
    return this.oauth.revoke(user.id);
  }

  @Permissions("integrations.manage")
  @Post("folders")
  folder(
    @CurrentUser() user: AuthPrincipal,
    @Body() input: CreateGoogleDriveFolderDto,
  ) {
    return this.storage.ensureFolder({
      ownerId: user.id,
      name: input.name,
      parentId: input.parentId,
    });
  }

  @Permissions("integrations.manage")
  @Post("folders/ensure")
  ensureFolders(@CurrentUser() user: AuthPrincipal) {
    return this.hierarchy.ensure(user.id);
  }
}
