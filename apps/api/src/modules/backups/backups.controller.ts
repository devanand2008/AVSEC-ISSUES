import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  StreamableFile,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { IsIn, IsString, MaxLength, MinLength } from "class-validator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Permissions } from "../../common/decorators/permissions.decorator";
import { CurrentRequestId } from "../../common/decorators/request-id.decorator";
import type { AuthPrincipal } from "../../common/http/request-context";
import { BackupsService } from "./backups.service";

class CreateBackupDto {
  @IsIn(["MANUAL"])
  type!: "MANUAL";

  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason!: string;
}

class DeleteBackupDto {
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason!: string;
}

@ApiTags("database-backups")
@Controller(["admin/backups", "admin/storage/backups"])
export class BackupsController {
  constructor(private readonly backups: BackupsService) {}

  @Permissions("backups.manage")
  @Get()
  list(@CurrentUser() user: AuthPrincipal) {
    return this.backups.list(user);
  }

  @Permissions("backups.manage")
  @Post()
  createManual(
    @CurrentUser() user: AuthPrincipal,
    @Body() input: CreateBackupDto,
    @CurrentRequestId() requestId: string,
  ) {
    return this.backups.createManual(user, requestId, input.reason);
  }

  @Permissions("backups.manage")
  @Get(":id")
  get(@CurrentUser() user: AuthPrincipal, @Param("id") id: string) {
    return this.backups.get(user, id);
  }

  @Permissions("backups.manage")
  @Get(":id/manifest")
  manifest(@CurrentUser() user: AuthPrincipal, @Param("id") id: string) {
    return this.backups.manifest(user, id);
  }

  @Permissions("backups.manage")
  @Get(":id/schema")
  async schema(
    @CurrentUser() user: AuthPrincipal,
    @Param("id") id: string,
  ) {
    const file = await this.backups.downloadSchema(user, id);
    return new StreamableFile(file.content, {
      type: file.mimeType,
      disposition: `attachment; filename="${file.fileName}"`,
    });
  }

  @Permissions("backups.manage")
  @Post(":id/verify")
  verify(
    @CurrentUser() user: AuthPrincipal,
    @Param("id") id: string,
    @CurrentRequestId() requestId: string,
  ) {
    return this.backups.verify(user, id, requestId);
  }

  @Permissions("backups.manage")
  @Post(":id/restore-test")
  restoreTest(
    @CurrentUser() user: AuthPrincipal,
    @Param("id") id: string,
    @CurrentRequestId() requestId: string,
  ) {
    return this.backups.restoreTest(user, id, requestId);
  }

  @Permissions("backups.manage")
  @Delete(":id")
  delete(
    @CurrentUser() user: AuthPrincipal,
    @Param("id") id: string,
    @Body() input: DeleteBackupDto,
    @CurrentRequestId() requestId: string,
  ) {
    return this.backups.deleteEligible(user, id, input.reason, requestId);
  }
}
