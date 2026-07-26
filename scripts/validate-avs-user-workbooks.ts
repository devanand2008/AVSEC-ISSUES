import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { ConfigService } from "@nestjs/config";
import { ImportsFileService } from "../apps/api/src/modules/imports/imports-file.service";

async function main() {
  const workbookPaths =
    process.argv.slice(2).length > 0
      ? process.argv.slice(2)
      : [
          "user_data/private/AVSEC USER NAME AND PASSWORD FOR 2RD YEAR.xlsx",
          "user_data/private/AVSEC USER NAME AND PASSWORD FOR 3RD YEAR.xlsx",
        ];

  const service = new ImportsFileService(
    new ConfigService({
      S3_BUCKET: "validation-only",
      S3_ENDPOINT: "http://127.0.0.1:9000",
      S3_REGION: "us-east-1",
      S3_ACCESS_KEY: "validation",
      S3_SECRET_KEY: "validation-only",
      S3_FORCE_PATH_STYLE: true,
      OFFICIAL_EMAIL_DOMAINS: "avsenggcollege.ac.in",
    }),
  );

  for (const workbookPath of workbookPaths) {
    const absolutePath = resolve(workbookPath);
    const buffer = await readFile(absolutePath);
    const parsed = await service.parse(
      {
        buffer,
        originalname: basename(absolutePath),
        size: buffer.length,
      } as Express.Multer.File,
      "STUDENTS",
    );
    const invalidRows = new Set(parsed.errors.map((error) => error.rowNumber));
    const errorsByField = Object.fromEntries(
      [...new Set(parsed.errors.map((error) => error.field ?? "row"))].map(
        (field) => [
          field,
          parsed.errors.filter(
            (error) => (error.field ?? "row") === field,
          ).length,
        ],
      ),
    );
    const errorsByMessage = Object.fromEntries(
      [
        ...new Set(
          parsed.errors.map((error) =>
            error.message.replace(/\s+\([^)]*, row \d+\)\.?$/, ""),
          ),
        ),
      ].map((message) => [
        message,
        parsed.errors.filter(
          (error) =>
            error.message.replace(/\s+\([^)]*, row \d+\)\.?$/, "") ===
            message,
        ).length,
      ]),
    );
    console.log(
      JSON.stringify(
        {
          fileName: basename(absolutePath),
          studyYear: parsed.detectedStudyYear ?? null,
          sheets: parsed.sheetInspections.map((sheet) => ({
            name: sheet.sheetName,
            headerRow: sheet.headerRowNumber ?? null,
            rows: sheet.rowCount,
            status: sheet.status,
          })),
          rows: parsed.rows.length,
          validRows: parsed.rows.length - invalidRows.size,
          invalidRows: invalidRows.size,
          duplicateGroups: parsed.duplicateGroups.map((group) => ({
            locations: group.locations.map((location) => ({
              sheet: location.sheetName ?? null,
              row: location.sourceRowNumber ?? location.rowNumber,
            })),
          })),
          numericPasswordWarnings: parsed.passwordWarnings,
          errorsByField,
          errorsByMessage,
        },
        null,
        2,
      ),
    );
  }
}

void main();
