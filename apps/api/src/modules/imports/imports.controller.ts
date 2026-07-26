import { Body, Controller, Get, Param, ParseUUIDPipe, Post, StreamableFile, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiConsumes, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { CurrentRequestId } from "../../common/decorators/request-id.decorator";
import type { AuthPrincipal } from "../../common/http/request-context";
import { ImportsService } from "./imports.service";

@ApiTags("imports")
@Controller("imports")
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  @Get("templates/:entityType")
  async template(@CurrentUser() user: AuthPrincipal, @Param("entityType") entityType: string) {
    const template = await this.imports.template(user, entityType);
    return new StreamableFile(template.content, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", disposition: `attachment; filename="${template.fileName}"` });
  }

  @ApiConsumes("multipart/form-data")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: Number(process.env.MAX_EXCEL_FILE_SIZE_MB || 10) * 1024 * 1024, files: 1 } }))
  @Post("preview")
  preview(
    @CurrentUser() user: AuthPrincipal,
    @Body("entityType") entityType: string,
    @Body("sheetName") sheetName: string | undefined,
    @Body("importMode") importMode: string | undefined,
    @Body("columnMapping") columnMapping: string | undefined,
    @Body("selectedRoleCode") selectedRoleCode: string | undefined,
    @Body("resetExistingPasswords") resetExistingPasswords: string | undefined,
    @Body("departmentMappings") departmentMappings: string | undefined,
    @Body("detectedStudyYear") detectedStudyYear: string | undefined,
    @Body("duplicateResolution") duplicateResolution: string | undefined,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentRequestId() requestId: string,
  ) {
    return this.imports.preview(user, entityType, file, requestId, {
      sheetName,
      importMode,
      columnMapping,
      selectedRoleCode,
      resetExistingPasswords,
      departmentMappings,
      detectedStudyYear,
      duplicateResolution,
    });
  }

  @Get()
  list(@CurrentUser() user: AuthPrincipal) { return this.imports.list(user); }

  @Get(":id")
  get(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string) { return this.imports.get(user, id); }

  @Get(":id/credentials")
  async credentials(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string, @CurrentRequestId() requestId: string) {
    const exportFile = await this.imports.credentials(user, id, requestId);
    return new StreamableFile(exportFile.content, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", disposition: `attachment; filename="${exportFile.fileName}"` });
  }

  @Post(":id/confirm")
  confirm(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string, @CurrentRequestId() requestId: string) { return this.imports.confirm(user, id, requestId); }

  @Post(":id/rollback")
  rollback(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string, @CurrentRequestId() requestId: string) { return this.imports.rollback(user, id, requestId); }
}
