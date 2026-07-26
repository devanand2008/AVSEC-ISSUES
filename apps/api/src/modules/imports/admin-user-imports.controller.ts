import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiConsumes, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { CurrentRequestId } from "../../common/decorators/request-id.decorator";
import type { AuthPrincipal } from "../../common/http/request-context";
import { ImportsService } from "./imports.service";

interface AdminImportOptions {
  entityType?: string;
  sheetName?: string;
  importMode?: string;
  columnMapping?: string;
  selectedRoleCode?: string;
  resetExistingPasswords?: string;
  departmentMappings?: string;
  detectedStudyYear?: string;
  duplicateResolution?: string;
  batchId?: string;
}

@ApiTags("admin-user-imports")
@Controller(["admin/users/import", "admin/student-import"])
export class AdminUserImportsController {
  constructor(private readonly imports: ImportsService) {}

  @Get("template")
  async template(@CurrentUser() user: AuthPrincipal) {
    const template = await this.imports.template(user, "USERS");
    return new StreamableFile(template.content, {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      disposition: `attachment; filename="${template.fileName}"`,
    });
  }

  @ApiConsumes("multipart/form-data")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: {
        fileSize: Number(process.env.MAX_EXCEL_FILE_SIZE_MB || 10) * 1024 * 1024,
        files: 1,
      },
    }),
  )
  @Post("upload")
  upload(
    @CurrentUser() user: AuthPrincipal,
    @Body() body: AdminImportOptions,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentRequestId() requestId: string,
  ) {
    return this.preview(user, body, file, requestId);
  }

  @ApiConsumes("multipart/form-data")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: {
        fileSize: Number(process.env.MAX_EXCEL_FILE_SIZE_MB || 10) * 1024 * 1024,
        files: 1,
      },
    }),
  )
  @Post("preview")
  preview(
    @CurrentUser() user: AuthPrincipal,
    @Body() body: AdminImportOptions,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentRequestId() requestId: string,
  ) {
    return this.imports.preview(
      user,
      body.entityType || "USERS",
      file,
      requestId,
      {
        sheetName: body.sheetName,
        importMode: body.importMode,
        columnMapping: body.columnMapping,
        selectedRoleCode: body.selectedRoleCode,
        resetExistingPasswords: body.resetExistingPasswords,
        departmentMappings: body.departmentMappings,
        detectedStudyYear: body.detectedStudyYear,
        duplicateResolution: body.duplicateResolution,
      },
    );
  }

  @ApiConsumes("multipart/form-data")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: {
        fileSize: Number(process.env.MAX_EXCEL_FILE_SIZE_MB || 10) * 1024 * 1024,
        files: 1,
      },
    }),
  )
  @Post("validate")
  validate(
    @CurrentUser() user: AuthPrincipal,
    @Body() body: AdminImportOptions,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentRequestId() requestId: string,
  ) {
    return this.imports.preview(
      user,
      body.entityType || "USERS",
      file,
      requestId,
      { ...body, importMode: "VALIDATE_ONLY" },
    );
  }

  @Post("confirm")
  confirm(
    @CurrentUser() user: AuthPrincipal,
    @Body() body: AdminImportOptions,
    @CurrentRequestId() requestId: string,
  ) {
    if (!body.batchId) throw new BadRequestException("batchId is required.");
    return this.imports.confirm(user, body.batchId, requestId);
  }

  @Post(":batchId/confirm")
  confirmByPath(
    @CurrentUser() user: AuthPrincipal,
    @Param("batchId", ParseUUIDPipe) batchId: string,
    @CurrentRequestId() requestId: string,
  ) {
    return this.imports.confirm(user, batchId, requestId);
  }

  @Get("history")
  history(@CurrentUser() user: AuthPrincipal) {
    return this.imports.list(user);
  }

  @Get(":batchId")
  get(
    @CurrentUser() user: AuthPrincipal,
    @Param("batchId", ParseUUIDPipe) batchId: string,
  ) {
    return this.imports.get(user, batchId);
  }

  @Get([":batchId/errors", ":batchId/error-report"])
  async errors(
    @CurrentUser() user: AuthPrincipal,
    @Param("batchId", ParseUUIDPipe) batchId: string,
  ) {
    const detail = await this.imports.get(user, batchId);
    return {
      batchId,
      errors:
        "result" in detail && detail.result
          ? detail.result.errors
          : [],
    };
  }
}
