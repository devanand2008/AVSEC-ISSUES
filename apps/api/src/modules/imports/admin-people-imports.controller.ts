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
import { stringify } from "csv-stringify/sync";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Permissions } from "../../common/decorators/permissions.decorator";
import { CurrentRequestId } from "../../common/decorators/request-id.decorator";
import type { AuthPrincipal } from "../../common/http/request-context";
import { ImportsService } from "./imports.service";

interface PeopleImportOptions {
  sheetName?: string;
  importMode?: string;
  departmentMappings?: string;
  duplicateResolution?: string;
  batchId?: string;
}

const peopleFileInterceptor = FileInterceptor("file", {
  limits: {
    fileSize:
      Number(process.env.MAX_EXCEL_FILE_SIZE_MB || 10) * 1024 * 1024,
    files: 1,
  },
});

const PEOPLE_ERROR_REPORT_COLUMNS = [
  "Row Number",
  "User ID",
  "User Name",
  "Error",
] as const;

function safeCsvCell(value: string | undefined): string {
  const cleaned = (value ?? "").replace(/\0/g, "");
  return /^\s*[=+\-@]/.test(cleaned) ? `'${cleaned}` : cleaned;
}

@ApiTags("admin-people-imports")
@Permissions("users.import")
@Controller("admin/people/import")
export class AdminPeopleImportsController {
  constructor(private readonly imports: ImportsService) {}

  @Get("template")
  async template(@CurrentUser() user: AuthPrincipal) {
    const template = await this.imports.template(user, "PEOPLE");
    return new StreamableFile(template.content, {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      disposition: `attachment; filename="${template.fileName}"`,
    });
  }

  @ApiConsumes("multipart/form-data")
  @UseInterceptors(peopleFileInterceptor)
  @Post(["upload", "preview"])
  preview(
    @CurrentUser() user: AuthPrincipal,
    @Body() body: PeopleImportOptions,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentRequestId() requestId: string,
  ) {
    return this.imports.preview(user, "PEOPLE", file, requestId, {
      sheetName: body.sheetName,
      importMode: body.importMode,
      selectedRoleCode: "STUDENT",
      departmentMappings: body.departmentMappings,
      duplicateResolution: body.duplicateResolution,
    });
  }

  @ApiConsumes("multipart/form-data")
  @UseInterceptors(peopleFileInterceptor)
  @Post("validate")
  validate(
    @CurrentUser() user: AuthPrincipal,
    @Body() body: PeopleImportOptions,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentRequestId() requestId: string,
  ) {
    return this.imports.preview(user, "PEOPLE", file, requestId, {
      sheetName: body.sheetName,
      importMode: "VALIDATE_ONLY",
      selectedRoleCode: "STUDENT",
      departmentMappings: body.departmentMappings,
      duplicateResolution: body.duplicateResolution,
    });
  }

  @Post("confirm")
  confirm(
    @CurrentUser() user: AuthPrincipal,
    @Body() body: PeopleImportOptions,
    @CurrentRequestId() requestId: string,
  ) {
    if (!body.batchId) throw new BadRequestException("batchId is required.");
    return this.imports.confirm(user, body.batchId, requestId, "PEOPLE");
  }

  @Post(":batchId/confirm")
  confirmByPath(
    @CurrentUser() user: AuthPrincipal,
    @Param("batchId", ParseUUIDPipe) batchId: string,
    @CurrentRequestId() requestId: string,
  ) {
    return this.imports.confirm(user, batchId, requestId, "PEOPLE");
  }

  @Post(":batchId/cancel")
  cancel(
    @CurrentUser() user: AuthPrincipal,
    @Param("batchId", ParseUUIDPipe) batchId: string,
    @CurrentRequestId() requestId: string,
  ) {
    return this.imports.cancel(user, batchId, requestId, "PEOPLE");
  }

  @Get("history")
  history(@CurrentUser() user: AuthPrincipal) {
    return this.imports.list(user, "PEOPLE");
  }

  @Get(":batchId")
  get(
    @CurrentUser() user: AuthPrincipal,
    @Param("batchId", ParseUUIDPipe) batchId: string,
  ) {
    return this.imports.get(user, batchId, "PEOPLE");
  }

  @Get(":batchId/errors")
  async errors(
    @CurrentUser() user: AuthPrincipal,
    @Param("batchId", ParseUUIDPipe) batchId: string,
  ) {
    const detail = await this.imports.get(user, batchId, "PEOPLE");
    return {
      batchId,
      errors:
        "result" in detail && detail.result ? detail.result.errors : [],
    };
  }

  @Get(":batchId/error-report")
  async errorReport(
    @CurrentUser() user: AuthPrincipal,
    @Param("batchId", ParseUUIDPipe) batchId: string,
  ) {
    const detail = await this.imports.get(user, batchId, "PEOPLE");
    const errors =
      "result" in detail && detail.result ? detail.result.errors : [];
    const csv = stringify(
      errors.map((error) => ({
        "Row Number": error.rowNumber,
        "User ID": safeCsvCell(error.userId),
        "User Name": safeCsvCell(error.userName),
        Error: safeCsvCell(error.message),
      })),
      { columns: [...PEOPLE_ERROR_REPORT_COLUMNS], header: true },
    );

    return new StreamableFile(Buffer.from(`\uFEFF${csv}`, "utf8"), {
      type: "text/csv; charset=utf-8",
      disposition: `attachment; filename="people-import-${batchId}-errors.csv"`,
    });
  }
}
