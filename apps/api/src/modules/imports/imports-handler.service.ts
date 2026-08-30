import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as argon2 from "argon2";
import { randomInt } from "node:crypto";
import { PrismaService } from "../../database/prisma.service";
import { Prisma } from "../../generated/prisma/client";
import {
  AcademicMembershipStatus,
  AccountStatus,
  AttendanceCode,
  IssuePriority,
  RoomType,
  ScopeType,
  StudentAcademicStatus,
} from "../../generated/prisma/enums";
import { SectionPlacementService } from "../academic/section-placement.service";
import { attendanceParts } from "../attendance/attendance-value";
import { AuditService } from "../audit/audit.service";
import { encryptImportCredential } from "./import-credential.crypto";
import { isRetryableImportInfrastructureError } from "./import-infrastructure-error";
import {
  importRowNumber,
  type CredentialExportRow,
  type ImportEntityType,
  type ImportMode,
  type ImportedRecord,
  type ImportRow,
  type ImportRowError,
} from "./import.types";

interface ImportCreateOptions {
  resetExistingPasswords?: boolean;
  officialEmailDomains?: readonly string[];
}

interface PeopleBatchRow {
  row: ImportRow;
  rowNumber: number;
}

interface PreparedPeopleBatchRow extends PeopleBatchRow {
  passwordHash: string;
}

interface StudentAcademicSelection {
  departmentId: string;
  programmeId: string;
  sectionId: string;
  academicYearId: string;
  academicYearStartsOn: Date;
  semesterId: string;
  sectionCode: string;
  capacity: number;
}

@Injectable()
export class ImportsHandlerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly sectionPlacement: SectionPlacementService,
    private readonly audit?: AuditService,
  ) {}

  async create(
    entityType: ImportEntityType,
    collegeId: string,
    row: ImportRow,
    rowNumber: number,
    importJobId: string,
    requestedById: string,
    importMode: ImportMode = "CREATE_ONLY",
    options: ImportCreateOptions = {},
    processingAttemptToken?: string,
  ): Promise<ImportedRecord> {
    return this.sectionPlacement.transaction(async (tx) => {
      if (processingAttemptToken) {
        await this.assertProcessingAttempt(
          tx,
          importJobId,
          processingAttemptToken,
        );
      }
      return this.createInTransaction(
        tx,
        entityType,
        collegeId,
        row,
        rowNumber,
        importJobId,
        requestedById,
        importMode,
        options,
      );
    });
  }

  async createPeopleBatch(
    collegeId: string,
    rows: PeopleBatchRow[],
    importJobId: string,
    requestedById: string,
    importMode: ImportMode = "CREATE_ONLY",
    options: ImportCreateOptions = {},
    processingAttemptToken?: string,
  ): Promise<ImportedRecord[]> {
    if (!rows.length || rows.length > 10) {
      throw new BadRequestException(
        "A People transaction batch must contain between 1 and 10 rows.",
      );
    }
    const preparedRows: PreparedPeopleBatchRow[] = [];
    // Argon2 is deliberately completed before opening the interactive
    // Serializable transaction. Keep preparation sequential and bounded so a
    // large import cannot create an unbounded CPU/memory spike.
    for (const item of rows) {
      const row = { ...item.row };
      this.assertPeopleCoreFields(row, options.officialEmailDomains);
      preparedRows.push({
        row,
        rowNumber: item.rowNumber,
        passwordHash: await this.hashTemporaryPassword(
          row.temporary_password ?? "",
        ),
      });
    }
    return this.sectionPlacement.transaction(async (tx) => {
      if (processingAttemptToken) {
        await this.assertProcessingAttempt(
          tx,
          importJobId,
          processingAttemptToken,
        );
      }
      const records: ImportedRecord[] = [];
      for (const item of preparedRows) {
        records.push(
          await this.createInTransaction(
            tx,
            "PEOPLE",
            collegeId,
            item.row,
            item.rowNumber,
            importJobId,
            requestedById,
            importMode,
            options,
            item.passwordHash,
          ),
        );
      }
      return records;
    });
  }

  /** Hold a shared row lock through each import write transaction. A stalled
   * worker's token takeover needs an UPDATE lock, so it must serialize after a
   * committing batch; the recovery attempt then observes that batch's ledger.
   */
  private async assertProcessingAttempt(
    tx: Prisma.TransactionClient,
    importJobId: string,
    processingAttemptToken: string,
  ): Promise<void> {
    const owned = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id
      FROM import_jobs
      WHERE id = ${importJobId}::uuid
        AND status = 'PROCESSING'::"JobStatus"
        AND processing_attempt_token = ${processingAttemptToken}
      FOR SHARE
    `);
    if (owned.length !== 1) {
      throw new ConflictException(
        "This import worker no longer owns the processing attempt.",
      );
    }
  }

  private async createInTransaction(
    tx: Prisma.TransactionClient,
    entityType: ImportEntityType,
    collegeId: string,
    row: ImportRow,
    rowNumber: number,
    importJobId: string,
    requestedById: string,
    importMode: ImportMode,
    options: ImportCreateOptions,
    preparedPeoplePasswordHash?: string,
  ): Promise<ImportedRecord> {
    let record: ImportedRecord;
    switch (entityType) {
      case "PEOPLE":
        record = await this.createUser(
          tx,
          collegeId,
          row,
          rowNumber,
          "PEOPLE",
          importMode,
          importJobId,
          options,
          preparedPeoplePasswordHash,
        );
        break;
      case "USERS":
        record = await this.createUser(
          tx,
          collegeId,
          row,
          rowNumber,
          "USER",
          importMode,
          importJobId,
          options,
        );
        break;
      case "STUDENTS":
        record = await this.createUser(
          tx,
          collegeId,
          row,
          rowNumber,
          "STUDENT",
          importMode,
          importJobId,
          options,
        );
        break;
      case "STAFF":
        record = await this.createUser(
          tx,
          collegeId,
          row,
          rowNumber,
          "STAFF",
          importMode,
          importJobId,
          options,
        );
        break;
      case "DEPARTMENTS":
        record = await this.createDepartment(tx, collegeId, row, rowNumber);
        break;
      case "PROGRAMMES":
        record = await this.createProgramme(tx, collegeId, row, rowNumber);
        break;
      case "CLASSES":
        record = await this.createClass(tx, collegeId, row, rowNumber);
        break;
      case "ATTENDANCE":
        record = await this.createAttendance(
          tx,
          collegeId,
          row,
          rowNumber,
          importJobId,
          requestedById,
        );
        break;
      case "BLOCKS":
        record = await this.createBlock(tx, collegeId, row, rowNumber);
        break;
      case "FLOORS":
        record = await this.createFloor(tx, collegeId, row, rowNumber);
        break;
      case "ROOMS":
        record = await this.createRoom(tx, collegeId, row, rowNumber);
        break;
      case "ASSETS":
        record = await this.createAsset(tx, collegeId, row, rowNumber);
        break;
      case "RESPONSIBLE_PERSONS":
        record = await this.createResponsiblePerson(
          tx,
          collegeId,
          row,
          rowNumber,
        );
        break;
      case "ASSIGNMENT_RULES":
        record = await this.createAssignmentRule(tx, collegeId, row, rowNumber);
        break;
    }
    await tx.importJobRecord.create({
      data: {
        importJobId,
        rowNumber: record.rowNumber,
        model: record.model,
        recordId: record.id,
        label: record.label,
        credentialCiphertext: record.credential
          ? encryptImportCredential(
              this.config.getOrThrow<string>("PASSWORD_PEPPER"),
              importJobId,
              record.credential,
            )
          : undefined,
      },
    });
    if (entityType === "PEOPLE") {
      await this.audit?.record(
        {
          collegeId,
          actorId: requestedById,
          action: "person.imported",
          entityType: "User",
          entityId: record.id,
          afterValue: {
            importJobId,
            rowNumber,
            collegeIdentityId: row.college_identity_id,
            department: row.department_code,
            studyYear: row.year,
            classroom: row.class_room_number,
          },
          requestId: `import-job:${importJobId}:row:${rowNumber}`,
        },
        tx,
      );
    }
    return record;
  }

  async validate(
    entityType: ImportEntityType,
    collegeId: string,
    rows: ImportRow[],
    importMode: ImportMode,
    preInvalidRows: ReadonlySet<number> = new Set<number>(),
    officialEmailDomains?: readonly string[],
  ): Promise<ImportRowError[]> {
    if (entityType === "PEOPLE") {
      return this.validatePeopleBatch(
        collegeId,
        rows,
        importMode,
        preInvalidRows,
        officialEmailDomains,
      );
    }
    if (!["USERS", "STUDENTS", "STAFF", "PROGRAMMES"].includes(entityType))
      return [];
    const errors: ImportRowError[] = [];
    const invalidRows = new Set(preInvalidRows);
    for (const [index, row] of rows.entries()) {
      const rowNumber = importRowNumber(entityType, row, index + 2);
      if (invalidRows.has(rowNumber)) continue;
      try {
        if (entityType === "PROGRAMMES") {
          await this.validateProgrammeRow(collegeId, row);
        } else {
          await this.validateUserRow(entityType, collegeId, row, importMode);
        }
      } catch (error) {
        if (isRetryableImportInfrastructureError(error)) throw error;
        errors.push(
          this.importRowError(
            entityType,
            row,
            rowNumber,
            this.errorMessage(error, row),
          ),
        );
        invalidRows.add(rowNumber);
      }
    }
    if (entityType === "STUDENTS") {
      errors.push(
        ...(await this.validateStudentBatchCapacity(
          collegeId,
          rows,
          importMode,
          invalidRows,
          entityType,
        )),
      );
    }
    return errors;
  }

  private async validatePeopleBatch(
    collegeId: string,
    rows: ImportRow[],
    importMode: ImportMode,
    preInvalidRows: ReadonlySet<number>,
    officialEmailDomains?: readonly string[],
  ): Promise<ImportRowError[]> {
    if (!["CREATE_ONLY", "VALIDATE_ONLY"].includes(importMode)) {
      throw new BadRequestException(
        "People imports support validate-only or create-only mode.",
      );
    }
    const errors: ImportRowError[] = [];
    const invalidRows = new Set(preInvalidRows);
    const candidates = rows
      .map((row, index) => ({
        row,
        rowNumber: importRowNumber("PEOPLE", row, index + 2),
      }))
      .filter((item) => !invalidRows.has(item.rowNumber));
    const reject = (item: PeopleBatchRow, message: string, field?: string) => {
      errors.push({
        ...this.importRowError("PEOPLE", item.row, item.rowNumber, message),
        ...(field ? { field } : {}),
      });
      invalidRows.add(item.rowNumber);
    };

    for (const item of candidates) {
      try {
        this.assertPeopleCoreFields(item.row, officialEmailDomains);
        if (!item.row.department_code?.trim()) {
          throw new BadRequestException("Department is required.");
        }
        if (!this.importStudyYear(item.row.year)) {
          throw new BadRequestException("Year is required.");
        }
      } catch (error) {
        if (isRetryableImportInfrastructureError(error)) throw error;
        reject(item, this.errorMessage(error, item.row));
      }
    }

    const coreValid = candidates.filter(
      (item) => !invalidRows.has(item.rowNumber),
    );
    if (!coreValid.length) return errors;
    const identities = [
      ...new Set(coreValid.map((item) => item.row.college_identity_id.trim())),
    ];
    const emails = [
      ...new Set(coreValid.map((item) => item.row.email.trim().toLowerCase())),
    ];
    const [roles, existingUsers, existingProfiles] = await Promise.all([
      this.prisma.role.findMany({
        where: {
          code: "STUDENT",
          isActive: true,
          OR: [{ collegeId }, { collegeId: null }],
        },
        select: { id: true },
        take: 2,
      }),
      this.prisma.user.findMany({
        where: {
          collegeId,
          OR: [
            { collegeIdentityId: { in: identities, mode: "insensitive" } },
            { normalizedEmail: { in: emails } },
          ],
        },
        select: {
          id: true,
          collegeIdentityId: true,
          normalizedEmail: true,
        },
      }),
      this.prisma.studentProfile.findMany({
        where: {
          collegeId,
          studentId: { in: identities, mode: "insensitive" },
        },
        select: { userId: true, studentId: true },
      }),
    ]);
    if (roles.length !== 1) {
      for (const item of coreValid) {
        reject(
          item,
          "The Student role does not exist or is inactive for this college.",
        );
      }
      return errors;
    }
    const existingIdentities = new Set([
      ...existingUsers.map((user) =>
        user.collegeIdentityId.toLocaleLowerCase("en-US"),
      ),
      ...existingProfiles.map((profile) =>
        profile.studentId.toLocaleLowerCase("en-US"),
      ),
    ]);
    const existingEmails = new Set(
      existingUsers
        .map((user) => user.normalizedEmail?.toLocaleLowerCase("en-US"))
        .filter((email): email is string => Boolean(email)),
    );
    for (const item of coreValid) {
      if (
        existingIdentities.has(
          item.row.college_identity_id.toLocaleLowerCase("en-US"),
        )
      ) {
        reject(
          item,
          "A user with this User ID already exists.",
          "college_identity_id",
        );
      } else if (
        existingEmails.has(item.row.email.toLocaleLowerCase("en-US"))
      ) {
        reject(item, "A user with this email already exists.", "email");
      }
    }

    const identityValid = coreValid.filter(
      (item) => !invalidRows.has(item.rowNumber),
    );
    if (!identityValid.length) return errors;
    const departmentValues = [
      ...new Set(identityValid.map((item) => item.row.department_code.trim())),
    ];
    const departments = await this.prisma.department.findMany({
      where: {
        collegeId,
        isActive: true,
        archivedAt: null,
        OR: [
          { code: { in: departmentValues, mode: "insensitive" } },
          { name: { in: departmentValues, mode: "insensitive" } },
          { shortName: { in: departmentValues, mode: "insensitive" } },
        ],
      },
      select: { id: true, code: true, name: true, shortName: true },
    });
    const departmentByRow = new Map<number, (typeof departments)[number]>();
    for (const item of identityValid) {
      const requested = item.row.department_code
        .trim()
        .toLocaleLowerCase("en-US");
      const matches = departments.filter((department) =>
        [department.code, department.name, department.shortName]
          .filter((value): value is string => Boolean(value))
          .some(
            (value) => value.trim().toLocaleLowerCase("en-US") === requested,
          ),
      );
      if (!matches.length) {
        reject(
          item,
          `Department ${item.row.department_code} does not exist. Create or correct the department before importing this row.`,
          "department_code",
        );
      } else if (matches.length > 1) {
        reject(
          item,
          `Department ${item.row.department_code} is ambiguous. Use the unique department code.`,
          "department_code",
        );
      } else {
        departmentByRow.set(item.rowNumber, matches[0]!);
      }
    }

    const departmentValid = identityValid.filter(
      (item) =>
        !invalidRows.has(item.rowNumber) &&
        Boolean(item.row.class_room_number?.trim()),
    );
    if (!departmentValid.length) return errors;
    const classroomValues = [
      ...new Set(
        departmentValid.map((item) => item.row.class_room_number.trim()),
      ),
    ];
    const rooms = await this.prisma.room.findMany({
      where: {
        isActive: true,
        archivedAt: null,
        OR: [
          { code: { in: classroomValues, mode: "insensitive" } },
          { roomNumber: { in: classroomValues, mode: "insensitive" } },
        ],
        floor: {
          isActive: true,
          archivedAt: null,
          block: {
            isActive: true,
            archivedAt: null,
            campus: {
              collegeId,
              isActive: true,
              archivedAt: null,
            },
          },
        },
      },
      select: {
        id: true,
        code: true,
        roomNumber: true,
        departmentId: true,
      },
    });
    const roomByRow = new Map<number, (typeof rooms)[number]>();
    for (const item of departmentValid) {
      const department = departmentByRow.get(item.rowNumber)!;
      const requested = item.row.class_room_number
        .trim()
        .toLocaleLowerCase("en-US");
      const identityMatches = rooms.filter((room) =>
        [room.code, room.roomNumber]
          .filter((value): value is string => Boolean(value))
          .some(
            (value) => value.trim().toLocaleLowerCase("en-US") === requested,
          ),
      );
      const matches = identityMatches.filter(
        (room) => !room.departmentId || room.departmentId === department.id,
      );
      if (!matches.length) {
        reject(
          item,
          identityMatches.some((room) => Boolean(room.departmentId))
            ? `Classroom ${item.row.class_room_number} is not assigned to Department ${department.code}.`
            : `Classroom ${item.row.class_room_number} does not exist in an active campus location.`,
          "class_room_number",
        );
      } else if (matches.length > 1) {
        reject(
          item,
          `Classroom ${item.row.class_room_number} is ambiguous across active campus locations. Use a unique room code.`,
          "class_room_number",
        );
      } else {
        roomByRow.set(item.rowNumber, matches[0]!);
      }
    }

    const roomValid = departmentValid.filter(
      (item) => !invalidRows.has(item.rowNumber),
    );
    if (!roomValid.length) return errors;
    const roomIds = [
      ...new Set(roomValid.map((item) => roomByRow.get(item.rowNumber)!.id)),
    ];
    const departmentIds = [
      ...new Set(
        roomValid.map((item) => departmentByRow.get(item.rowNumber)!.id),
      ),
    ];
    const semesterNumbers = [
      ...new Set(
        roomValid.flatMap((item) => {
          const studyYear = this.importStudyYear(item.row.year)!;
          return [studyYear * 2 - 1, studyYear * 2];
        }),
      ),
    ];
    const sections = await this.prisma.section.findMany({
      where: {
        assignedRoomId: { in: roomIds },
        isActive: true,
        archivedAt: null,
        semester: {
          isActive: true,
          number: { in: semesterNumbers },
          academicYear: {
            collegeId,
            isCurrent: true,
            isActive: true,
            archivedAt: null,
          },
          programme: {
            collegeId,
            departmentId: { in: departmentIds },
            isActive: true,
            archivedAt: null,
            department: { isActive: true, archivedAt: null },
            degreeTypeMaster: { isActive: true, archivedAt: null },
          },
        },
      },
      select: {
        id: true,
        code: true,
        capacity: true,
        studyYear: true,
        assignedRoomId: true,
        semester: {
          select: {
            number: true,
            academicYearId: true,
            programmeId: true,
            programme: { select: { departmentId: true } },
          },
        },
      },
    });
    const sectionByRow = new Map<number, (typeof sections)[number]>();
    for (const item of roomValid) {
      const room = roomByRow.get(item.rowNumber)!;
      const department = departmentByRow.get(item.rowNumber)!;
      const studyYear = this.importStudyYear(item.row.year)!;
      const matches = sections.filter(
        (section) =>
          section.assignedRoomId === room.id &&
          (section.studyYear == null || section.studyYear === studyYear) &&
          [studyYear * 2 - 1, studyYear * 2].includes(
            section.semester.number,
          ) &&
          section.semester.programme.departmentId === department.id,
      );
      if (!matches.length) {
        reject(
          item,
          `Classroom ${item.row.class_room_number} has no current active Section for Department ${department.code} and Year ${studyYear}.`,
          "class_room_number",
        );
      } else if (matches.length > 1) {
        reject(
          item,
          `Classroom ${item.row.class_room_number} is ambiguous because multiple current active Sections match Department ${department.code} and Year ${studyYear}.`,
          "class_room_number",
        );
      } else {
        sectionByRow.set(item.rowNumber, matches[0]!);
      }
    }

    const sectionValid = roomValid.filter(
      (item) => !invalidRows.has(item.rowNumber),
    );
    if (!sectionValid.length) return errors;
    const sectionIds = [
      ...new Set(
        sectionValid.map((item) => sectionByRow.get(item.rowNumber)!.id),
      ),
    ];
    const membershipCounts = await this.prisma.sectionMembership.groupBy({
      by: ["sectionId"],
      where: {
        sectionId: { in: sectionIds },
        isActive: true,
        status: AcademicMembershipStatus.ACTIVE,
      },
      _count: { _all: true },
    });
    const currentBySection = new Map(
      membershipCounts.map((entry) => [entry.sectionId, entry._count._all]),
    );
    const reservedBySection = new Map<string, number>();
    for (const item of sectionValid) {
      const section = sectionByRow.get(item.rowNumber)!;
      const current = currentBySection.get(section.id) ?? 0;
      const reserved = reservedBySection.get(section.id) ?? 0;
      if (current + reserved >= section.capacity) {
        reject(
          item,
          `Section ${section.code} is full. Current capacity: ${current + reserved} / ${section.capacity}. Please select another Section.`,
          "class_room_number",
        );
      } else {
        reservedBySection.set(section.id, reserved + 1);
      }
    }
    return errors;
  }

  private async validateProgrammeRow(
    collegeId: string,
    row: ImportRow,
  ): Promise<void> {
    const department = await this.resolveDepartmentByCodeOrName(
      this.prisma,
      collegeId,
      row.department_code,
    );
    if (!department)
      throw new BadRequestException("department_code was not found.");
    await this.resolveDegreeTypeByCode(
      this.prisma,
      collegeId,
      row.degree_type_code,
    );
    const durationYears = this.integer(
      row.duration_years,
      "duration_years",
      1,
      4,
    );
    const totalSemesters =
      this.optionalInteger(row.total_semesters, "total_semesters", 1, 8) ??
      durationYears * 2;
    if (totalSemesters < durationYears) {
      throw new BadRequestException(
        "total_semesters cannot be lower than duration_years.",
      );
    }
  }

  private async validateStudentBatchCapacity(
    collegeId: string,
    rows: ImportRow[],
    importMode: ImportMode,
    invalidRows: Set<number>,
    entityType: "PEOPLE" | "STUDENTS" = "STUDENTS",
  ): Promise<ImportRowError[]> {
    const errors: ImportRowError[] = [];
    const reservedBySection = new Map<string, number>();
    const currentBySection = new Map<string, number>();
    for (const [index, row] of rows.entries()) {
      const rowNumber = importRowNumber(entityType, row, index + 2);
      if (
        invalidRows.has(rowNumber) ||
        (entityType !== "PEOPLE" && !this.hasStudentProfileData(row))
      )
        continue;
      try {
        const selection = await this.resolveStudentAcademicData(
          this.prisma,
          collegeId,
          row,
        );
        const existing = await this.findExistingUserForValidation(
          collegeId,
          row,
          true,
          false,
          entityType === "PEOPLE",
        );
        const existingUser = existing
          ? await this.prisma.user.findUnique({
              where: { id: existing.id },
              select: {
                status: true,
                archivedAt: true,
                studentProfile: {
                  select: { sectionId: true, academicStatus: true },
                },
                sectionMemberships: {
                  where: {
                    isActive: true,
                    endsOn: null,
                    status: AcademicMembershipStatus.ACTIVE,
                  },
                  select: { sectionId: true },
                  take: 2,
                },
              },
            })
          : null;
        const resultingStatus = row.account_status
          ? this.accountStatus(row.account_status)
          : (existingUser?.status ?? AccountStatus.ACTIVE);
        if (resultingStatus !== AccountStatus.ACTIVE) continue;
        const alreadyOccupiesTarget =
          existingUser?.status === AccountStatus.ACTIVE &&
          !existingUser.archivedAt &&
          existingUser.studentProfile?.academicStatus ===
            StudentAcademicStatus.ACTIVE &&
          existingUser.sectionMemberships.length === 1 &&
          existingUser.sectionMemberships[0]?.sectionId === selection.sectionId;
        if (alreadyOccupiesTarget) continue;
        if (importMode === "UPDATE_ONLY" && !existing) continue;

        let current = currentBySection.get(selection.sectionId);
        if (current === undefined) {
          current = await this.prisma.sectionMembership.count({
            where: {
              sectionId: selection.sectionId,
              isActive: true,
              status: "ACTIVE",
            },
          });
          currentBySection.set(selection.sectionId, current);
        }
        const reserved = reservedBySection.get(selection.sectionId) ?? 0;
        if (current + reserved >= selection.capacity) {
          errors.push({
            rowNumber,
            field:
              entityType === "PEOPLE" ? "class_room_number" : "section_code",
            message: `Section ${selection.sectionCode} is full. Current capacity: ${selection.capacity} / ${selection.capacity}. Please select another Section.`,
            ...(entityType === "PEOPLE" && row.college_identity_id
              ? { userId: row.college_identity_id.slice(0, 60) }
              : {}),
            ...(entityType === "PEOPLE" && row.full_name
              ? { userName: row.full_name.slice(0, 180) }
              : {}),
          });
          invalidRows.add(rowNumber);
          continue;
        }
        reservedBySection.set(selection.sectionId, reserved + 1);
      } catch (error) {
        if (isRetryableImportInfrastructureError(error)) throw error;
        errors.push(
          this.importRowError(
            entityType,
            row,
            rowNumber,
            this.errorMessage(error, row),
          ),
        );
        invalidRows.add(rowNumber);
      }
    }
    return errors;
  }

  async rollback(
    collegeId: string,
    records: ImportedRecord[],
    context?: {
      entityType: ImportEntityType;
      importJobId: string;
      unchangedBefore: Date;
    },
    transaction?: Prisma.TransactionClient,
  ): Promise<void> {
    if (context?.entityType === "PEOPLE") {
      await this.rollbackPeople(collegeId, records, context, transaction);
      return;
    }
    const rollbackRecords = async (tx: Prisma.TransactionClient) => {
      for (const record of [...records].reverse()) {
        let removed = 0;
        switch (record.model) {
          case "User":
            await tx.classCoordinatorAssignment.deleteMany({
              where: { coordinatorId: record.id },
            });
            await tx.classRepresentativeAssignment.deleteMany({
              where: { representativeId: record.id },
            });
            await tx.facultySubjectAssignment.deleteMany({
              where: { facultyId: record.id },
            });
            await tx.sectionMembership.deleteMany({
              where: { studentUserId: record.id },
            });
            await tx.userScope.deleteMany({ where: { userId: record.id } });
            await tx.studentProfile.deleteMany({
              where: { userId: record.id, collegeId },
            });
            await tx.staffProfile.deleteMany({
              where: { userId: record.id, collegeId },
            });
            removed = (
              await tx.user.deleteMany({ where: { id: record.id, collegeId } })
            ).count;
            break;
          case "UserRole":
            removed = (
              await tx.userRole.deleteMany({
                where: { id: record.id, user: { collegeId } },
              })
            ).count;
            break;
          case "ClassRepresentativeAssignment":
            removed = (
              await tx.classRepresentativeAssignment.deleteMany({
                where: { id: record.id, representative: { collegeId } },
              })
            ).count;
            break;
          case "FacultySubjectAssignment":
            removed = (
              await tx.facultySubjectAssignment.deleteMany({
                where: { id: record.id, faculty: { collegeId } },
              })
            ).count;
            break;
          case "Department":
            removed = (
              await tx.department.deleteMany({
                where: { id: record.id, collegeId },
              })
            ).count;
            break;
          case "Programme":
            removed = (
              await tx.programme.deleteMany({
                where: { id: record.id, collegeId },
              })
            ).count;
            break;
          case "Section":
            removed = (
              await tx.section.deleteMany({
                where: {
                  id: record.id,
                  semester: { programme: { collegeId } },
                },
              })
            ).count;
            break;
          case "AttendanceRecord":
            removed = (
              await tx.attendanceRecord.deleteMany({
                where: {
                  id: record.id,
                  session: {
                    section: { semester: { programme: { collegeId } } },
                  },
                },
              })
            ).count;
            break;
          case "AttendanceSession":
            removed = (
              await tx.attendanceSession.deleteMany({
                where: {
                  id: record.id,
                  status: "LOCKED",
                  records: { none: {} },
                  section: { semester: { programme: { collegeId } } },
                },
              })
            ).count;
            break;
          case "Block":
            removed = (
              await tx.block.deleteMany({
                where: { id: record.id, campus: { collegeId } },
              })
            ).count;
            break;
          case "Floor":
            removed = (
              await tx.floor.deleteMany({
                where: { id: record.id, block: { campus: { collegeId } } },
              })
            ).count;
            break;
          case "Room":
            removed = (
              await tx.room.deleteMany({
                where: {
                  id: record.id,
                  floor: { block: { campus: { collegeId } } },
                },
              })
            ).count;
            break;
          case "Asset":
            removed = (
              await tx.asset.deleteMany({
                where: {
                  id: record.id,
                  room: { floor: { block: { campus: { collegeId } } } },
                },
              })
            ).count;
            break;
          case "ResponsibleTeamMember":
            removed = (
              await tx.responsibleTeamMember.deleteMany({
                where: { id: record.id, team: { collegeId } },
              })
            ).count;
            break;
          case "IssueAssignmentRule":
            removed = (
              await tx.issueAssignmentRule.deleteMany({
                where: { id: record.id, collegeId },
              })
            ).count;
            break;
          default:
            throw new BadRequestException(
              `Rollback does not support ${record.model}.`,
            );
        }
        if (removed !== 1)
          throw new BadRequestException(
            `Imported ${record.model} ${record.id} is missing, outside this college, or no longer safe to remove.`,
          );
      }
    };
    if (transaction) {
      await rollbackRecords(transaction);
    } else {
      await this.prisma.$transaction(rollbackRecords);
    }
  }

  /**
   * People rollback is intentionally stricter than the legacy generic import
   * rollback. A newly imported student may be removed only while its complete
   * account graph is still in the exact, unused state created by that job.
   *
   * The checks and set-based deletes share one Serializable transaction. The
   * user row locks prevent a concurrent login/profile/relationship write from
   * landing between the dependency checks and the delete, while the number of
   * SQL statements stays bounded for a 1,000-row workbook.
   */
  private async rollbackPeople(
    collegeId: string,
    records: ImportedRecord[],
    context: {
      entityType: ImportEntityType;
      importJobId: string;
      unchangedBefore: Date;
    },
    transaction?: Prisma.TransactionClient,
  ): Promise<void> {
    if (records.some((record) => record.model !== "User")) {
      throw new BadRequestException(
        "People rollback contains an unsupported imported record type.",
      );
    }
    const userIds = [...new Set(records.map((record) => record.id))];
    if (!userIds.length || userIds.length !== records.length) {
      throw new BadRequestException(
        "People rollback requires one unique imported account per ledger row.",
      );
    }
    const unchangedBefore = context.unchangedBefore.getTime();
    if (!Number.isFinite(unchangedBefore)) {
      throw new BadRequestException("People rollback cutoff is invalid.");
    }

    const rollbackAccounts = async (tx: Prisma.TransactionClient) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`
            SELECT id
            FROM users
            WHERE college_id = ${collegeId}::uuid
              AND import_batch_id = ${context.importJobId}::uuid
              AND id IN (${Prisma.join(userIds)})
            ORDER BY id
            FOR UPDATE
          `,
      );
      if (locked.length !== userIds.length) {
        throw new BadRequestException(
          "One or more People accounts are missing, outside this college, or were not created by this import.",
        );
      }

      const users = await tx.user.findMany({
        where: {
          id: { in: userIds },
          collegeId,
          importBatchId: context.importJobId,
        },
        select: {
          id: true,
          createdAt: true,
          updatedAt: true,
          version: true,
          status: true,
          archivedAt: true,
          mustChangePassword: true,
          firstLoginCompletedAt: true,
          lastLoginAt: true,
          profileCompletionStatus: true,
          profileCompletionPercentage: true,
          credential: {
            select: {
              passwordChangedAt: true,
              failedAttemptCount: true,
              lockedUntil: true,
            },
          },
          roles: {
            select: {
              createdAt: true,
              role: { select: { code: true } },
            },
          },
          scopes: {
            select: {
              createdAt: true,
              scopeType: true,
              scopeId: true,
              issueCategoryId: true,
            },
          },
          studentProfile: {
            select: {
              sectionId: true,
              createdAt: true,
              updatedAt: true,
            },
          },
          staffProfile: { select: { id: true } },
          sectionMemberships: {
            select: {
              sectionId: true,
              createdAt: true,
              updatedAt: true,
              changedById: true,
              status: true,
              isActive: true,
              endsOn: true,
            },
          },
        },
      });
      if (users.length !== userIds.length) {
        throw new BadRequestException(
          "One or more People accounts are no longer available for rollback.",
        );
      }

      for (const user of users) {
        const profile = user.studentProfile;
        const membership = user.sectionMemberships[0];
        const role = user.roles[0];
        const scope = user.scopes[0];
        const touchedAfterImport = [
          user.createdAt,
          user.updatedAt,
          profile?.createdAt,
          profile?.updatedAt,
          membership?.createdAt,
          membership?.updatedAt,
          role?.createdAt,
          scope?.createdAt,
        ].some(
          (value) => value !== undefined && value.getTime() > unchangedBefore,
        );
        const unchangedAccountState =
          !touchedAfterImport &&
          user.version === 1 &&
          user.status === AccountStatus.ACTIVE &&
          user.archivedAt === null &&
          user.mustChangePassword &&
          user.firstLoginCompletedAt === null &&
          user.lastLoginAt === null &&
          user.profileCompletionStatus === "NOT_STARTED" &&
          user.profileCompletionPercentage === 0 &&
          user.credential?.passwordChangedAt === null &&
          user.credential.failedAttemptCount === 0 &&
          user.credential.lockedUntil === null &&
          user.roles.length === 1 &&
          role?.role.code === "STUDENT" &&
          user.scopes.length === 1 &&
          scope?.issueCategoryId === null &&
          user.staffProfile === null;
        const unchangedPlacedState =
          profile !== null &&
          scope?.scopeType === ScopeType.SECTION &&
          scope.scopeId !== null &&
          user.sectionMemberships.length === 1 &&
          membership?.sectionId === profile.sectionId &&
          membership.status === AcademicMembershipStatus.ACTIVE &&
          membership.isActive &&
          membership.endsOn === null &&
          membership.changedById === null &&
          scope.scopeId === profile.sectionId;
        const unchangedStagedState =
          profile === null &&
          scope?.scopeType === ScopeType.DEPARTMENT &&
          scope.scopeId !== null &&
          user.sectionMemberships.length === 0;
        if (
          !unchangedAccountState ||
          (!unchangedPlacedState && !unchangedStagedState)
        ) {
          throw new BadRequestException(
            `Imported People account ${user.id} has been used or changed and cannot be rolled back safely.`,
          );
        }
      }

      await this.assertNoCascadingPeopleDependencies(tx, userIds);

      const expectedProfiles = users.filter(
        (user) => user.studentProfile !== null,
      ).length;
      const expectedMemberships = users.reduce(
        (count, user) => count + user.sectionMemberships.length,
        0,
      );

      const memberships = await tx.sectionMembership.deleteMany({
        where: { studentUserId: { in: userIds } },
      });
      const profiles = await tx.studentProfile.deleteMany({
        where: { userId: { in: userIds }, collegeId },
      });
      const removed = await tx.user.deleteMany({
        where: {
          id: { in: userIds },
          collegeId,
          importBatchId: context.importJobId,
        },
      });
      if (
        memberships.count !== expectedMemberships ||
        profiles.count !== expectedProfiles ||
        removed.count !== userIds.length
      ) {
        throw new BadRequestException(
          "One or more People accounts changed while rollback was running.",
        );
      }
    };
    if (transaction) {
      await rollbackAccounts(transaction);
    } else {
      await this.prisma.$transaction(rollbackAccounts, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5_000,
        timeout: 30_000,
      });
    }
  }

  /**
   * PostgreSQL can silently CASCADE or SET NULL on account deletion. Discover
   * those inbound foreign keys from the catalog and require them to be empty,
   * except for the three baseline account tables whose exact state is checked
   * above. This keeps the safety check complete as the schema evolves.
   */
  private async assertNoCascadingPeopleDependencies(
    tx: Prisma.TransactionClient,
    userIds: string[],
  ): Promise<void> {
    const references = await tx.$queryRaw<
      Array<{
        schemaName: string;
        tableName: string;
        columnName: string;
      }>
    >(Prisma.sql`
      SELECT
        source_namespace.nspname AS "schemaName",
        source_table.relname AS "tableName",
        source_column.attname AS "columnName"
      FROM pg_constraint constraint_row
      JOIN pg_class source_table
        ON source_table.oid = constraint_row.conrelid
      JOIN pg_namespace source_namespace
        ON source_namespace.oid = source_table.relnamespace
      JOIN pg_class target_table
        ON target_table.oid = constraint_row.confrelid
      JOIN pg_namespace target_namespace
        ON target_namespace.oid = target_table.relnamespace
      JOIN LATERAL unnest(constraint_row.conkey) WITH ORDINALITY
        AS source_key(attnum, position) ON TRUE
      JOIN LATERAL unnest(constraint_row.confkey) WITH ORDINALITY
        AS target_key(attnum, position)
        ON target_key.position = source_key.position
      JOIN pg_attribute source_column
        ON source_column.attrelid = source_table.oid
       AND source_column.attnum = source_key.attnum
      JOIN pg_attribute target_column
        ON target_column.attrelid = target_table.oid
       AND target_column.attnum = target_key.attnum
      WHERE constraint_row.contype = 'f'
        AND target_namespace.nspname = current_schema()
        AND target_table.relname = 'users'
        AND target_column.attname = 'id'
        AND constraint_row.confdeltype IN ('c', 'n', 'd')
    `);
    const baselineReferences = new Set([
      "user_credentials.user_id",
      "user_roles.user_id",
      "user_scopes.user_id",
    ]);
    for (const reference of references) {
      if (
        !this.safeSqlIdentifier(reference.schemaName) ||
        !this.safeSqlIdentifier(reference.tableName) ||
        !this.safeSqlIdentifier(reference.columnName)
      ) {
        throw new BadRequestException(
          "An unsafe database dependency identifier blocked People rollback.",
        );
      }
      if (
        baselineReferences.has(`${reference.tableName}.${reference.columnName}`)
      ) {
        continue;
      }
      const table = Prisma.raw(
        `"${reference.schemaName}"."${reference.tableName}"`,
      );
      const column = Prisma.raw(`"${reference.columnName}"`);
      const counts = await tx.$queryRaw<Array<{ count: string }>>(
        Prisma.sql`
          SELECT COUNT(*)::text AS count
          FROM ${table}
          WHERE ${column} IN (${Prisma.join(userIds)})
        `,
      );
      if (Number(counts[0]?.count ?? 0) > 0) {
        throw new BadRequestException(
          `A ${reference.tableName} dependency prevents safe People rollback.`,
        );
      }
    }

    const unmanaged = await tx.$queryRaw<Array<{ count: string }>>(
      Prisma.sql`
        SELECT (
          (SELECT COUNT(*) FROM user_presence
            WHERE user_id IN (${Prisma.join(userIds)}))
          +
          (SELECT COUNT(*) FROM role_assignment_history
            WHERE user_id IN (${Prisma.join(userIds)})
               OR changed_by_id IN (${Prisma.join(userIds)}))
        )::text AS count
      `,
    );
    if (Number(unmanaged[0]?.count ?? 0) > 0) {
      throw new BadRequestException(
        "A presence or role-history dependency prevents safe People rollback.",
      );
    }
  }

  private safeSqlIdentifier(value: string): boolean {
    return /^[A-Za-z_][A-Za-z0-9_$]*$/.test(value);
  }

  private async validateUserRow(
    entityType: ImportEntityType,
    collegeId: string,
    row: ImportRow,
    importMode: ImportMode,
  ): Promise<void> {
    if (importMode === "VALIDATE_ONLY") importMode = "CREATE_ONLY";
    const kind =
      entityType === "PEOPLE"
        ? "PEOPLE"
        : entityType === "STUDENTS"
          ? "STUDENT"
          : entityType === "STAFF"
            ? "STAFF"
            : "USER";
    if (kind === "PEOPLE") this.assertPeopleCoreFields(row);
    const roleCodes = ["PEOPLE", "STUDENT"].includes(kind)
      ? ["STUDENT"]
      : this.list(row.role_codes);
    if (!roleCodes.length)
      throw new BadRequestException("At least one role code is required.");
    const roles = await this.prisma.role.findMany({
      where: {
        code: { in: roleCodes },
        isActive: true,
        OR: [{ collegeId }, { collegeId: null }],
      },
      select: { id: true, code: true },
    });
    if (roles.length !== new Set(roleCodes).size)
      throw new BadRequestException(
        "One or more role codes do not exist or are inactive.",
      );

    this.ensureAccountIdentity(row);
    const createsStudentProfile =
      kind === "STUDENT" ||
      (kind === "PEOPLE" && Boolean(row.class_room_number?.trim())) ||
      this.hasStudentProfileData(row);
    const createsStaffProfile = this.hasStaffProfileData(row);
    const existing = await this.findExistingUserForValidation(
      collegeId,
      row,
      createsStudentProfile,
      createsStaffProfile,
      kind === "PEOPLE",
    );
    const normalizedEmail = row.email?.toLowerCase() || undefined;
    const duplicate = await this.prisma.user.findFirst({
      where: {
        collegeId,
        OR: [
          kind === "PEOPLE"
            ? {
                collegeIdentityId: {
                  equals: row.college_identity_id,
                  mode: "insensitive",
                },
              }
            : { collegeIdentityId: row.college_identity_id },
          ...(normalizedEmail ? [{ normalizedEmail }] : []),
        ],
      },
      select: { id: true },
    });
    if (duplicate && duplicate.id !== existing?.id)
      throw new BadRequestException(
        "A user with this college ID or email already exists.",
      );
    if (existing && importMode === "CREATE_ONLY")
      throw new BadRequestException(
        "A user with this stable ID already exists.",
      );
    if (!existing && importMode === "UPDATE_ONLY")
      throw new BadRequestException(
        "No existing user matched the stable ID for update.",
      );

    const accountStatus = this.accountStatus(row.account_status);
    if (
      row.department_code &&
      !(await this.resolveDepartmentByCodeOrName(
        this.prisma,
        collegeId,
        row.department_code,
      ))
    )
      throw new BadRequestException(
        `Department not found. Select an existing department or create it before importing.`,
      );
    if (createsStudentProfile)
      await this.validateStudentReferences(collegeId, row);
    if (createsStaffProfile)
      await this.validateStaffReferences(
        collegeId,
        row,
        roleCodes,
        accountStatus,
        existing?.id,
      );
  }

  private async findExistingUserForValidation(
    collegeId: string,
    row: ImportRow,
    createsStudentProfile: boolean,
    createsStaffProfile: boolean,
    caseInsensitiveIdentity = false,
  ): Promise<{ id: string } | null> {
    if (createsStudentProfile && row.student_id) {
      const profile = await this.prisma.studentProfile.findFirst({
        where: {
          collegeId,
          studentId: caseInsensitiveIdentity
            ? { equals: row.student_id.trim(), mode: "insensitive" }
            : row.student_id.trim(),
        },
        select: { userId: true },
      });
      if (profile) return { id: profile.userId };
    }
    if (createsStudentProfile && row.register_number) {
      const profile = await this.prisma.studentProfile.findFirst({
        where: { collegeId, registerNumber: row.register_number.trim() },
        select: { userId: true },
      });
      if (profile) return { id: profile.userId };
    }
    if (createsStaffProfile && row.employee_id) {
      const profile = await this.prisma.staffProfile.findFirst({
        where: { collegeId, employeeId: row.employee_id.trim() },
        select: { userId: true },
      });
      if (profile) return { id: profile.userId };
    }
    if (row.college_identity_id)
      return this.prisma.user.findFirst({
        where: {
          collegeId,
          collegeIdentityId: caseInsensitiveIdentity
            ? { equals: row.college_identity_id.trim(), mode: "insensitive" }
            : row.college_identity_id.trim(),
        },
        select: { id: true },
      });
    if (row.email)
      return this.prisma.user.findFirst({
        where: { collegeId, normalizedEmail: row.email.trim().toLowerCase() },
        select: { id: true },
      });
    return null;
  }

  private async validateStudentReferences(
    collegeId: string,
    row: ImportRow,
  ): Promise<void> {
    await this.resolveStudentAcademicData(this.prisma, collegeId, row);
  }

  private async validateStaffReferences(
    collegeId: string,
    row: ImportRow,
    roleCodes: string[],
    accountStatus: AccountStatus,
    existingUserId?: string,
  ): Promise<void> {
    let departmentId: string | undefined;
    if (row.department_code) {
      const department = await this.resolveDepartmentByCodeOrName(
        this.prisma,
        collegeId,
        row.department_code,
      );
      if (!department)
        throw new BadRequestException(
          `Department code ${row.department_code} was not found.`,
        );
      departmentId = department.id;
    }
    if (
      accountStatus === AccountStatus.ACTIVE &&
      roleCodes.includes("PRINCIPAL")
    ) {
      const existingPrincipal = await this.prisma.user.count({
        where: {
          ...(existingUserId ? { id: { not: existingUserId } } : {}),
          collegeId,
          status: AccountStatus.ACTIVE,
          roles: { some: { role: { code: "PRINCIPAL", isActive: true } } },
        },
      });
      if (existingPrincipal > 0)
        throw new BadRequestException(
          "An active Principal account already exists for this college.",
        );
    }
    if (
      departmentId &&
      accountStatus === AccountStatus.ACTIVE &&
      roleCodes.includes("HOD")
    ) {
      const existingHod = await this.prisma.user.count({
        where: {
          ...(existingUserId ? { id: { not: existingUserId } } : {}),
          collegeId,
          status: AccountStatus.ACTIVE,
          roles: { some: { role: { code: "HOD", isActive: true } } },
          staffProfile: { departmentId },
        },
      });
      if (existingHod > 0)
        throw new BadRequestException(
          "An active HOD already exists for this department.",
        );
    }
  }

  private async createUser(
    tx: Prisma.TransactionClient,
    collegeId: string,
    row: ImportRow,
    rowNumber: number,
    kind: "PEOPLE" | "USER" | "STUDENT" | "STAFF",
    importMode: ImportMode,
    importJobId: string,
    options: ImportCreateOptions,
    preparedPeoplePasswordHash?: string,
  ): Promise<ImportedRecord> {
    if (importMode === "VALIDATE_ONLY")
      throw new BadRequestException(
        "Validate-only jobs cannot create or update users.",
      );
    if (kind === "PEOPLE") {
      this.assertPeopleCoreFields(row, options.officialEmailDomains);
      row.role_codes = "STUDENT";
      row.student_id = row.college_identity_id;
      row.account_status = "ACTIVE";
    }
    const roleCodes = ["PEOPLE", "STUDENT"].includes(kind)
      ? ["STUDENT"]
      : this.list(row.role_codes);
    if (!roleCodes.length)
      throw new BadRequestException("At least one role code is required.");
    if (
      kind !== "STUDENT" &&
      roleCodes.includes("CLASS_REPRESENTATIVE") &&
      row.student_id
    ) {
      return this.assignExistingClassRepresentative(
        tx,
        collegeId,
        row,
        rowNumber,
      );
    }
    const roles = await tx.role.findMany({
      where: {
        code: { in: roleCodes },
        isActive: true,
        OR: [{ collegeId }, { collegeId: null }],
      },
      select: { id: true, code: true },
    });
    if (roles.length !== new Set(roleCodes).size)
      throw new BadRequestException(
        "One or more role codes do not exist or are inactive.",
      );
    const normalizedEmail = row.email?.toLowerCase() || undefined;
    const createsStudentProfile =
      kind === "STUDENT" ||
      (kind === "PEOPLE" && Boolean(row.class_room_number?.trim())) ||
      this.hasStudentProfileData(row);
    const createsStaffProfile = this.hasStaffProfileData(row);
    const existing = await this.findExistingUser(
      tx,
      collegeId,
      row,
      createsStudentProfile,
      createsStaffProfile,
      kind === "PEOPLE",
    );
    const duplicate = await tx.user.findFirst({
      where: {
        collegeId,
        OR: [
          kind === "PEOPLE"
            ? {
                collegeIdentityId: {
                  equals: row.college_identity_id,
                  mode: "insensitive",
                },
              }
            : { collegeIdentityId: row.college_identity_id },
          ...(normalizedEmail ? [{ normalizedEmail }] : []),
        ],
      },
      select: { id: true },
    });
    if (duplicate && duplicate.id !== existing?.id)
      throw new BadRequestException(
        "A user with this college ID or email already exists.",
      );
    if (existing) {
      if (importMode === "CREATE_ONLY")
        throw new BadRequestException(
          "A user with this stable ID already exists.",
        );
      return this.updateUser(
        tx,
        collegeId,
        row,
        rowNumber,
        existing.id,
        roleCodes,
        roles,
        createsStudentProfile,
        createsStaffProfile,
        importJobId,
        options,
      );
    }
    if (importMode === "UPDATE_ONLY")
      throw new BadRequestException(
        "No existing user matched the stable ID for update.",
      );
    const accountStatus = this.accountStatus(row.account_status);
    if (
      accountStatus === AccountStatus.ACTIVE &&
      roleCodes.includes("PRINCIPAL")
    ) {
      const existingPrincipal = await tx.user.count({
        where: {
          collegeId,
          status: AccountStatus.ACTIVE,
          roles: { some: { role: { code: "PRINCIPAL", isActive: true } } },
        },
      });
      if (existingPrincipal > 0)
        throw new BadRequestException(
          "An active Principal account already exists for this college.",
        );
    }
    if (kind === "PEOPLE" && !row.temporary_password?.trim()) {
      throw new BadRequestException("User Password is required.");
    }
    const generatedTemporaryPassword =
      kind !== "PEOPLE" && !row.temporary_password?.trim();
    const temporaryPassword = generatedTemporaryPassword
      ? this.generateTemporaryPassword()
      : kind === "PEOPLE"
        ? row.temporary_password
        : row.temporary_password.trim();
    // Always enforce the policy again inside the transaction, even when a
    // batch supplied a hash prepared immediately beforehand.
    this.assertTemporaryPassword(temporaryPassword, kind === "PEOPLE");
    const passwordHash =
      kind === "PEOPLE" && preparedPeoplePasswordHash
        ? preparedPeoplePasswordHash
        : await this.hashTemporaryPassword(temporaryPassword);

    const scopes: Array<{
      scopeType: ScopeType;
      scopeId?: string;
      issueCategoryId?: string;
    }> = [];
    let studentData: StudentAcademicSelection | undefined;
    let staffDepartmentId: string | undefined;
    const basicDepartment = row.department_code
      ? await this.resolveDepartmentByCodeOrName(
          tx,
          collegeId,
          row.department_code,
        )
      : null;
    if (createsStudentProfile) {
      if (!row.student_id)
        throw new BadRequestException(
          "student_id is required for student accounts.",
        );
      studentData = await this.resolveStudentAcademicData(tx, collegeId, row);
    } else if (createsStaffProfile) {
      if (!row.employee_id)
        throw new BadRequestException(
          "employee_id is required for staff accounts.",
        );
      if (row.department_code) {
        const department = basicDepartment;
        if (!department)
          throw new BadRequestException("department_code was not found.");
        staffDepartmentId = department.id;
        scopes.push({
          scopeType: ScopeType.DEPARTMENT,
          scopeId: department.id,
        });
        if (
          accountStatus === AccountStatus.ACTIVE &&
          roleCodes.includes("HOD")
        ) {
          const existingHod = await tx.user.count({
            where: {
              collegeId,
              status: AccountStatus.ACTIVE,
              roles: { some: { role: { code: "HOD", isActive: true } } },
              staffProfile: { departmentId: department.id },
            },
          });
          if (existingHod > 0)
            throw new BadRequestException(
              "An active HOD already exists for this department.",
            );
        }
      } else if (
        roleCodes.some((code) =>
          ["SUPER_ADMIN", "MAIN_ADMIN", "PRINCIPAL", "VICE_PRINCIPAL"].includes(
            code,
          ),
        )
      ) {
        scopes.push({ scopeType: ScopeType.COLLEGE });
      } else {
        scopes.push({ scopeType: ScopeType.ASSIGNED_ISSUES });
      }
      const issueCategory = await this.resolveIssueCategory(
        tx,
        collegeId,
        row.assigned_issue_category,
      );
      if (issueCategory)
        scopes.push({
          scopeType: ScopeType.ISSUE_CATEGORY,
          issueCategoryId: issueCategory.id,
        });
      const locationScope = await this.resolveLocationScope(tx, collegeId, row);
      if (locationScope) scopes.push(locationScope);
    } else if (basicDepartment) {
      scopes.push({
        scopeType: ScopeType.DEPARTMENT,
        scopeId: basicDepartment.id,
      });
    } else {
      const resolved = await this.resolveScope(
        tx,
        collegeId,
        row.scope_type,
        row.scope_code,
        roleCodes,
      );
      scopes.push({ scopeType: resolved.scopeType, scopeId: resolved.scopeId });
    }

    const user = await tx.user.create({
      data: {
        collegeId,
        collegeIdentityId: row.college_identity_id,
        fullName: row.full_name,
        email: row.email || undefined,
        normalizedEmail,
        mobile: row.mobile || undefined,
        whatsappNumber: row.whatsapp_number || undefined,
        onboardingStudyYear: this.importStudyYear(row.year),
        importBatchId: importJobId,
        status: accountStatus,
        mustChangePassword: true,
        profileCompletionStatus:
          kind === "PEOPLE"
            ? "NOT_STARTED"
            : createsStudentProfile || createsStaffProfile
              ? "SUBMITTED"
              : "NOT_STARTED",
        profileCompletionPercentage:
          kind === "PEOPLE"
            ? 0
            : createsStudentProfile || createsStaffProfile
              ? 100
              : 0,
        ...(kind !== "PEOPLE" && (createsStudentProfile || createsStaffProfile)
          ? { profileSubmittedAt: new Date() }
          : {}),
        credential: { create: { passwordHash, passwordChangedAt: null } },
        roles: { create: roles.map((role) => ({ roleId: role.id })) },
        scopes: { create: scopes },
        ...(createsStaffProfile
          ? {
              staffProfile: {
                create: {
                  collegeId,
                  departmentId: staffDepartmentId,
                  employeeId: row.employee_id,
                  designation: row.designation || undefined,
                  joinedOn: this.date(row.joined_on),
                },
              },
            }
          : {}),
      },
    });
    if (studentData) {
      await this.placeImportedStudent(
        tx,
        collegeId,
        user.id,
        accountStatus,
        studentData,
        row,
        kind === "PEOPLE",
      );
    }
    if (
      createsStaffProfile &&
      roleCodes.includes("CLASS_COORDINATOR") &&
      row.section_code
    ) {
      const section = await this.resolveAcademicSection(tx, collegeId, row);
      const existing = await tx.classCoordinatorAssignment.findFirst({
        where: { sectionId: section.id, isActive: true, validUntil: null },
      });
      if (existing)
        throw new BadRequestException(
          "An active class coordinator already exists for this section.",
        );
      await tx.classCoordinatorAssignment.create({
        data: {
          coordinatorId: user.id,
          sectionId: section.id,
          validFrom: this.today(),
        },
      });
    }
    if (
      createsStaffProfile &&
      roleCodes.includes("FACULTY") &&
      row.subject_code &&
      row.section_code
    ) {
      await this.assignFacultySubject(tx, collegeId, user.id, row, rowNumber);
    }
    const credential: CredentialExportRow | undefined =
      generatedTemporaryPassword
        ? {
            rowNumber,
            userId: user.publicId,
            fullName: user.fullName,
            role: roleCodes.join(";"),
            loginId: user.collegeIdentityId,
            temporaryPassword,
            firstLoginRequired: true,
          }
        : undefined;
    return {
      rowNumber,
      model: "User",
      id: user.id,
      label: `${user.collegeIdentityId} - ${user.fullName}`,
      credential,
    };
  }

  private async findExistingUser(
    tx: Prisma.TransactionClient,
    collegeId: string,
    row: ImportRow,
    createsStudentProfile: boolean,
    createsStaffProfile: boolean,
    caseInsensitiveIdentity = false,
  ): Promise<{ id: string } | null> {
    if (createsStudentProfile && row.student_id) {
      const profile = await tx.studentProfile.findFirst({
        where: {
          collegeId,
          studentId: caseInsensitiveIdentity
            ? { equals: row.student_id.trim(), mode: "insensitive" }
            : row.student_id.trim(),
        },
        select: { userId: true },
      });
      if (profile) return { id: profile.userId };
    }
    if (createsStudentProfile && row.register_number) {
      const profile = await tx.studentProfile.findFirst({
        where: { collegeId, registerNumber: row.register_number.trim() },
        select: { userId: true },
      });
      if (profile) return { id: profile.userId };
    }
    if (createsStaffProfile && row.employee_id) {
      const profile = await tx.staffProfile.findFirst({
        where: { collegeId, employeeId: row.employee_id.trim() },
        select: { userId: true },
      });
      if (profile) return { id: profile.userId };
    }
    if (row.college_identity_id) {
      return tx.user.findFirst({
        where: {
          collegeId,
          collegeIdentityId: caseInsensitiveIdentity
            ? { equals: row.college_identity_id.trim(), mode: "insensitive" }
            : row.college_identity_id.trim(),
        },
        select: { id: true },
      });
    }
    if (row.email) {
      return tx.user.findFirst({
        where: { collegeId, normalizedEmail: row.email.trim().toLowerCase() },
        select: { id: true },
      });
    }
    return null;
  }

  private async updateUser(
    tx: Prisma.TransactionClient,
    collegeId: string,
    row: ImportRow,
    rowNumber: number,
    userId: string,
    roleCodes: string[],
    roles: Array<{ id: string; code: string }>,
    createsStudentProfile: boolean,
    createsStaffProfile: boolean,
    importJobId: string,
    options: ImportCreateOptions,
  ): Promise<ImportedRecord> {
    const accountStatus = this.accountStatus(row.account_status);
    const normalizedEmail = row.email?.toLowerCase() || undefined;
    const data: Prisma.UserUpdateInput = { version: { increment: 1 } };
    if (row.college_identity_id)
      data.collegeIdentityId = row.college_identity_id.trim();
    if (row.full_name) data.fullName = row.full_name.trim();
    if ("email" in row) {
      data.email = row.email || null;
      data.normalizedEmail = normalizedEmail ?? null;
    }
    if ("mobile" in row) data.mobile = row.mobile || null;
    if ("whatsapp_number" in row)
      data.whatsappNumber = row.whatsapp_number || null;
    if (row.year) data.onboardingStudyYear = this.importStudyYear(row.year);
    data.importBatchId = importJobId;
    if (row.account_status) data.status = accountStatus;

    if (
      accountStatus === AccountStatus.ACTIVE &&
      roleCodes.includes("PRINCIPAL")
    ) {
      const existingPrincipal = await tx.user.count({
        where: {
          id: { not: userId },
          collegeId,
          status: AccountStatus.ACTIVE,
          roles: { some: { role: { code: "PRINCIPAL", isActive: true } } },
        },
      });
      if (existingPrincipal > 0)
        throw new BadRequestException(
          "An active Principal account already exists for this college.",
        );
    }

    const scopes: Array<{
      scopeType: ScopeType;
      scopeId?: string;
      issueCategoryId?: string;
    }> = [];
    let studentData: StudentAcademicSelection | undefined;
    let staffDepartmentId: string | undefined;

    if (createsStudentProfile) {
      studentData = await this.resolveStudentAcademicData(tx, collegeId, row);
    }

    if (createsStaffProfile) {
      if (row.department_code) {
        const department = await this.resolveDepartmentByCodeOrName(
          tx,
          collegeId,
          row.department_code,
        );
        if (!department)
          throw new BadRequestException("department_code was not found.");
        staffDepartmentId = department.id;
        scopes.push({
          scopeType: ScopeType.DEPARTMENT,
          scopeId: department.id,
        });
        if (
          accountStatus === AccountStatus.ACTIVE &&
          roleCodes.includes("HOD")
        ) {
          const existingHod = await tx.user.count({
            where: {
              id: { not: userId },
              collegeId,
              status: AccountStatus.ACTIVE,
              roles: { some: { role: { code: "HOD", isActive: true } } },
              staffProfile: { departmentId: department.id },
            },
          });
          if (existingHod > 0)
            throw new BadRequestException(
              "An active HOD already exists for this department.",
            );
        }
      } else if (
        roleCodes.some((code) =>
          ["SUPER_ADMIN", "MAIN_ADMIN", "PRINCIPAL", "VICE_PRINCIPAL"].includes(
            code,
          ),
        )
      ) {
        scopes.push({ scopeType: ScopeType.COLLEGE });
      } else if (
        roleCodes.some((code) =>
          [
            "MAINTENANCE_ADMIN",
            "MAINTENANCE_SUPERVISOR",
            "MAINTENANCE_STAFF",
            "ELECTRICIAN",
            "PLUMBER",
            "IT_SUPPORT",
            "LAB_TECHNICIAN",
            "HOUSEKEEPING",
            "SECURITY",
            "OTHER_RESPONSIBLE",
          ].includes(code),
        )
      ) {
        scopes.push({ scopeType: ScopeType.ASSIGNED_ISSUES });
      }
      const issueCategory = await this.resolveIssueCategory(
        tx,
        collegeId,
        row.assigned_issue_category,
      );
      if (issueCategory)
        scopes.push({
          scopeType: ScopeType.ISSUE_CATEGORY,
          issueCategoryId: issueCategory.id,
        });
      const locationScope = await this.resolveLocationScope(tx, collegeId, row);
      if (locationScope) scopes.push(locationScope);
    } else if (!createsStudentProfile && row.department_code) {
      const department = await this.resolveDepartmentByCodeOrName(
        tx,
        collegeId,
        row.department_code,
      );
      if (!department)
        throw new BadRequestException("department_code was not found.");
      scopes.push({ scopeType: ScopeType.DEPARTMENT, scopeId: department.id });
    }

    const now = new Date();
    const temporaryPassword = options.resetExistingPasswords
      ? row.temporary_password?.trim()
      : "";
    let credential: CredentialExportRow | undefined;
    if (temporaryPassword) {
      this.assertTemporaryPassword(temporaryPassword);
      const passwordHash = await argon2.hash(
        temporaryPassword + this.config.get<string>("PASSWORD_PEPPER", ""),
        { type: argon2.argon2id },
      );
      await tx.userCredential.upsert({
        where: { userId },
        create: {
          userId,
          passwordHash,
          passwordChangedAt: null,
          failedAttemptCount: 0,
          lockedUntil: null,
        },
        update: {
          passwordHash,
          passwordChangedAt: null,
          failedAttemptCount: 0,
          lockedUntil: null,
        },
      });
      data.mustChangePassword = true;
      data.firstLoginCompletedAt = null;
      const sessions = await tx.session.findMany({
        where: { userId },
        select: { id: true },
      });
      await tx.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: now, revokeReason: "IMPORT_PASSWORD_RESET" },
      });
      if (sessions.length) {
        await tx.refreshToken.updateMany({
          where: {
            sessionId: { in: sessions.map((session) => session.id) },
            revokedAt: null,
          },
          data: { revokedAt: now },
        });
      }
    }

    const user = await tx.user.update({ where: { id: userId }, data });
    for (const role of roles) {
      await tx.userRole.upsert({
        where: { userId_roleId: { userId, roleId: role.id } },
        create: { userId, roleId: role.id },
        update: {},
      });
    }
    for (const scope of scopes) {
      const existingScope = await tx.userScope.findFirst({
        where: {
          userId,
          scopeType: scope.scopeType,
          scopeId: scope.scopeId,
          issueCategoryId: scope.issueCategoryId,
        },
      });
      if (!existingScope)
        await tx.userScope.create({ data: { userId, ...scope } });
    }

    if (studentData) {
      await this.placeImportedStudent(
        tx,
        collegeId,
        userId,
        user.status,
        studentData,
        row,
      );
      await tx.user.update({
        where: { id: userId },
        data: {
          profileCompletionStatus: "SUBMITTED",
          profileCompletionPercentage: 100,
          profileSubmittedAt: now,
          profileRejectionReason: null,
        },
      });
    }
    if (createsStaffProfile && row.employee_id) {
      await tx.staffProfile.upsert({
        where: { userId },
        create: {
          collegeId,
          userId,
          departmentId: staffDepartmentId,
          employeeId: row.employee_id,
          designation: row.designation || undefined,
          joinedOn: this.date(row.joined_on),
        },
        update: {
          ...(row.department_code ? { departmentId: staffDepartmentId } : {}),
          employeeId: row.employee_id,
          designation: row.designation || undefined,
          joinedOn: this.date(row.joined_on),
        },
      });
      await tx.user.update({
        where: { id: userId },
        data: {
          profileCompletionStatus: "SUBMITTED",
          profileCompletionPercentage: 100,
          profileSubmittedAt: now,
          profileRejectionReason: null,
        },
      });
    }
    if (
      createsStaffProfile &&
      roleCodes.includes("CLASS_COORDINATOR") &&
      row.section_code
    ) {
      const section = await this.resolveAcademicSection(tx, collegeId, row);
      const existing = await tx.classCoordinatorAssignment.findFirst({
        where: {
          sectionId: section.id,
          isActive: true,
          validUntil: null,
          coordinatorId: { not: userId },
        },
      });
      if (existing)
        throw new BadRequestException(
          "An active class coordinator already exists for this section.",
        );
      const ownAssignment = await tx.classCoordinatorAssignment.findFirst({
        where: {
          sectionId: section.id,
          isActive: true,
          validUntil: null,
          coordinatorId: userId,
        },
      });
      if (!ownAssignment)
        await tx.classCoordinatorAssignment.create({
          data: {
            coordinatorId: userId,
            sectionId: section.id,
            validFrom: this.today(),
          },
        });
    }
    if (
      createsStaffProfile &&
      roleCodes.includes("FACULTY") &&
      row.subject_code &&
      row.section_code
    ) {
      const assignment = await this.assignFacultySubject(
        tx,
        collegeId,
        userId,
        row,
        rowNumber,
      );
      if (assignment) return assignment;
    }
    return {
      rowNumber,
      model: "UserUpdate",
      id: user.id,
      label: `${user.collegeIdentityId} - ${user.fullName} updated`,
      credential,
    };
  }

  private async assignFacultySubject(
    tx: Prisma.TransactionClient,
    collegeId: string,
    facultyId: string,
    row: ImportRow,
    rowNumber: number,
  ): Promise<ImportedRecord | undefined> {
    const section = await this.resolveAcademicSection(tx, collegeId, row);
    if (!section.semesterId)
      throw new BadRequestException(
        "section_code did not resolve to a valid semester.",
      );
    const subject = await tx.subject.findUnique({
      where: {
        semesterId_code: {
          semesterId: section.semesterId,
          code: this.code(row.subject_code),
        },
      },
      select: { id: true, code: true, isActive: true },
    });
    if (!subject?.isActive)
      throw new BadRequestException(
        "subject_code was not found for the selected class.",
      );
    const existing = await tx.facultySubjectAssignment.findFirst({
      where: {
        facultyId,
        subjectId: subject.id,
        sectionId: section.id,
        isActive: true,
        validUntil: null,
      },
      select: { id: true },
    });
    if (existing) return undefined;
    const assignment = await tx.facultySubjectAssignment.create({
      data: {
        facultyId,
        subjectId: subject.id,
        sectionId: section.id,
        validFrom: this.today(),
      },
    });
    return this.record(
      rowNumber,
      "FacultySubjectAssignment",
      assignment.id,
      `${row.employee_id || row.college_identity_id} - ${subject.code} assignment`,
    );
  }

  private async assignExistingClassRepresentative(
    tx: Prisma.TransactionClient,
    collegeId: string,
    row: ImportRow,
    rowNumber: number,
  ): Promise<ImportedRecord> {
    const student = await tx.studentProfile.findFirst({
      where: {
        collegeId,
        studentId: row.student_id,
        academicStatus: StudentAcademicStatus.ACTIVE,
        user: {
          status: AccountStatus.ACTIVE,
          archivedAt: null,
          sectionMemberships: {
            some: {
              isActive: true,
              endsOn: null,
              status: AcademicMembershipStatus.ACTIVE,
            },
          },
        },
      },
      include: {
        user: { select: { id: true, collegeIdentityId: true, fullName: true } },
      },
    });
    if (!student)
      throw new BadRequestException(
        "student_id did not identify an active existing student.",
      );
    if (
      row.department_code ||
      row.programme_code ||
      row.section_code ||
      row.academic_year ||
      row.semester_number
    ) {
      const requestedSection = await this.resolveAcademicSection(
        tx,
        collegeId,
        row,
      );
      if (requestedSection.id !== student.sectionId)
        throw new BadRequestException(
          "The representative row section does not match the existing student's section.",
        );
    }
    const role = await tx.role.findFirst({
      where: {
        code: "CLASS_REPRESENTATIVE",
        isActive: true,
        OR: [{ collegeId }, { collegeId: null }],
      },
    });
    if (!role)
      throw new BadRequestException(
        "CLASS_REPRESENTATIVE role is not configured.",
      );
    const assignedToOtherStudent =
      await tx.classRepresentativeAssignment.findFirst({
        where: {
          sectionId: student.sectionId,
          isActive: true,
          validUntil: null,
          representativeId: { not: student.userId },
        },
      });
    if (assignedToOtherStudent)
      throw new BadRequestException(
        "An active class representative already exists for this section.",
      );
    const existingUserRole = await tx.userRole.findUnique({
      where: { userId_roleId: { userId: student.userId, roleId: role.id } },
    });
    const userRole =
      existingUserRole ??
      (await tx.userRole.create({
        data: { userId: student.userId, roleId: role.id },
      }));
    const scope = await tx.userScope.findFirst({
      where: {
        userId: student.userId,
        scopeType: ScopeType.SECTION,
        scopeId: student.sectionId,
      },
    });
    if (!scope)
      await tx.userScope.create({
        data: {
          userId: student.userId,
          scopeType: ScopeType.SECTION,
          scopeId: student.sectionId,
        },
      });
    const existingAssignment = await tx.classRepresentativeAssignment.findFirst(
      {
        where: {
          representativeId: student.userId,
          sectionId: student.sectionId,
          isActive: true,
          validUntil: null,
        },
      },
    );
    if (existingAssignment && existingUserRole)
      throw new BadRequestException(
        "This student is already the active class representative for the section.",
      );
    if (existingAssignment)
      return this.record(
        rowNumber,
        "UserRole",
        userRole.id,
        `${student.user.collegeIdentityId} - class representative role`,
      );
    const assignment =
      existingAssignment ??
      (await tx.classRepresentativeAssignment.create({
        data: {
          representativeId: student.userId,
          sectionId: student.sectionId,
          validFrom: this.today(),
        },
      }));
    return this.record(
      rowNumber,
      "ClassRepresentativeAssignment",
      assignment.id,
      `${student.user.collegeIdentityId} - class representative`,
    );
  }

  private async createDepartment(
    tx: Prisma.TransactionClient,
    collegeId: string,
    row: ImportRow,
    rowNumber: number,
  ): Promise<ImportedRecord> {
    const campus = row.campus_code
      ? await tx.campus.findFirst({
          where: {
            collegeId,
            code: this.code(row.campus_code),
            isActive: true,
          },
        })
      : null;
    if (row.campus_code && !campus)
      throw new BadRequestException("campus_code was not found.");
    const item = await tx.department.create({
      data: {
        collegeId,
        campusId: campus?.id,
        code: this.code(row.code),
        name: row.name,
        sortOrder: this.integer(row.sort_order, "sort_order", 0, 10_000, 0),
      },
    });
    return this.record(
      rowNumber,
      "Department",
      item.id,
      `${item.code} - ${item.name}`,
    );
  }

  private async createProgramme(
    tx: Prisma.TransactionClient,
    collegeId: string,
    row: ImportRow,
    rowNumber: number,
  ): Promise<ImportedRecord> {
    const department = await this.resolveDepartmentByCodeOrName(
      tx,
      collegeId,
      row.department_code,
    );
    if (!department)
      throw new BadRequestException("department_code was not found.");
    const degreeType = await this.resolveDegreeTypeByCode(
      tx,
      collegeId,
      row.degree_type_code,
    );
    const durationYears = this.integer(
      row.duration_years,
      "duration_years",
      1,
      4,
    );
    const item = await tx.programme.create({
      data: {
        collegeId,
        departmentId: department.id,
        degreeTypeId: degreeType.id,
        degreeType: degreeType.name,
        code: this.code(row.code),
        name: row.name.trim(),
        durationYears,
        totalSemesters:
          this.optionalInteger(row.total_semesters, "total_semesters", 1, 8) ??
          durationYears * 2,
      },
    });
    return this.record(
      rowNumber,
      "Programme",
      item.id,
      `${item.code} - ${item.name}`,
    );
  }

  private async resolveDegreeTypeByCode(
    tx: Prisma.TransactionClient | PrismaService,
    collegeId: string,
    rawCode: string,
  ): Promise<{ id: string; name: string }> {
    const code = this.code(rawCode);
    const matches = await tx.degreeType.findMany({
      where: {
        collegeId,
        code: { equals: code, mode: "insensitive" },
        isActive: true,
        archivedAt: null,
      },
      take: 2,
      select: { id: true, name: true },
    });
    if (matches.length !== 1) {
      throw new BadRequestException(
        matches.length
          ? "degree_type_code is ambiguous in this college."
          : "degree_type_code was not found or is inactive in this college.",
      );
    }
    return matches[0]!;
  }

  private async createClass(
    tx: Prisma.TransactionClient,
    collegeId: string,
    row: ImportRow,
    rowNumber: number,
  ): Promise<ImportedRecord> {
    const programmes = await tx.programme.findMany({
      where: {
        collegeId,
        code: this.code(row.programme_code),
        isActive: true,
        archivedAt: null,
        department: { isActive: true, archivedAt: null },
        degreeTypeMaster: { isActive: true, archivedAt: null },
      },
      take: 2,
    });
    if (programmes.length !== 1)
      throw new BadRequestException(
        programmes.length
          ? "programme_code is ambiguous. Use a unique programme code."
          : "programme_code was not found.",
      );
    const academicYear = await tx.academicYear.findFirst({
      where: {
        collegeId,
        name: row.academic_year,
        isActive: true,
        archivedAt: null,
      },
    });
    if (!academicYear)
      throw new BadRequestException("academic_year was not found.");
    const programme = programmes[0];
    if (!programme)
      throw new BadRequestException("programme_code was not found.");
    const semester = await tx.semester.findUnique({
      where: {
        programmeId_academicYearId_number: {
          programmeId: programme.id,
          academicYearId: academicYear.id,
          number: this.integer(row.semester_number, "semester_number", 1, 8),
        },
      },
    });
    if (!semester?.isActive)
      throw new BadRequestException(
        "The requested semester was not found or is inactive.",
      );
    const item = await tx.section.create({
      data: {
        semesterId: semester.id,
        code: this.code(row.code),
        name: row.name,
        capacity: this.optionalInteger(row.capacity, "capacity", 1, 70) ?? 70,
      },
    });
    return this.record(
      rowNumber,
      "Section",
      item.id,
      `${item.code} - ${item.name}`,
    );
  }

  private async createAttendance(
    tx: Prisma.TransactionClient,
    collegeId: string,
    row: ImportRow,
    rowNumber: number,
    importJobId: string,
    requestedById: string,
  ): Promise<ImportedRecord> {
    const sessionDate = this.requiredDate(row.session_date, "session_date");
    const programmes = await tx.programme.findMany({
      where: {
        collegeId,
        code: this.code(row.programme_code),
        isActive: true,
        archivedAt: null,
        department: { isActive: true, archivedAt: null },
        degreeTypeMaster: { isActive: true, archivedAt: null },
      },
      take: 2,
    });
    if (programmes.length !== 1)
      throw new BadRequestException(
        programmes.length
          ? "programme_code is ambiguous."
          : "programme_code was not found.",
      );
    const programme = programmes[0]!;
    const academicYear = await tx.academicYear.findFirst({
      where: {
        collegeId,
        name: row.academic_year,
        isActive: true,
        archivedAt: null,
      },
    });
    if (!academicYear)
      throw new BadRequestException("academic_year was not found.");
    const semester = await tx.semester.findUnique({
      where: {
        programmeId_academicYearId_number: {
          programmeId: programme.id,
          academicYearId: academicYear.id,
          number: this.integer(row.semester_number, "semester_number", 1, 8),
        },
      },
    });
    if (!semester?.isActive)
      throw new BadRequestException(
        "semester_number was not found for the programme and academic year.",
      );
    const section = await tx.section.findUnique({
      where: {
        semesterId_code: {
          semesterId: semester.id,
          code: this.code(row.section_code),
        },
      },
    });
    if (!section?.isActive)
      throw new BadRequestException(
        "section_code was not found for the selected semester.",
      );
    const subject = await tx.subject.findUnique({
      where: {
        semesterId_code: {
          semesterId: semester.id,
          code: this.code(row.subject_code),
        },
      },
    });
    if (!subject?.isActive)
      throw new BadRequestException(
        "subject_code was not found for the selected semester.",
      );
    const faculty = await tx.user.findFirst({
      where: {
        collegeId,
        collegeIdentityId: row.faculty_identity,
        status: "ACTIVE",
        roles: {
          some: {
            role: {
              code: {
                in: [
                  "FACULTY",
                  "CLASS_COORDINATOR",
                  "HOD",
                  "PRINCIPAL",
                  "VICE_PRINCIPAL",
                  "MAIN_ADMIN",
                ],
              },
              isActive: true,
            },
          },
        },
      },
      select: { id: true, fullName: true },
    });
    if (!faculty)
      throw new BadRequestException(
        "faculty_identity did not identify an active teaching user.",
      );
    const assignment = await tx.facultySubjectAssignment.findFirst({
      where: {
        facultyId: faculty.id,
        subjectId: subject.id,
        sectionId: section.id,
        isActive: true,
        validFrom: { lte: sessionDate },
        OR: [{ validUntil: null }, { validUntil: { gte: sessionDate } }],
      },
    });
    if (!assignment)
      throw new BadRequestException(
        "The faculty was not assigned to this subject and section on session_date.",
      );

    const studentIdentifiers: Prisma.StudentProfileWhereInput[] = [
      { studentId: row.student_id },
    ];
    if (row.legacy_id) studentIdentifiers.push({ legacyId: row.legacy_id });
    const students = await tx.studentProfile.findMany({
      where: {
        collegeId,
        sectionId: section.id,
        academicStatus: StudentAcademicStatus.ACTIVE,
        OR: studentIdentifiers,
        user: {
          status: AccountStatus.ACTIVE,
          archivedAt: null,
          sectionMemberships: {
            some: {
              sectionId: section.id,
              isActive: true,
              endsOn: null,
              status: AcademicMembershipStatus.ACTIVE,
            },
          },
        },
      },
      take: 2,
      include: { user: { select: { id: true, fullName: true } } },
    });
    if (students.length !== 1)
      throw new BadRequestException(
        students.length
          ? "student_id and legacy_id identify different students."
          : "The student was not found in the selected section.",
      );
    const student = students[0]!;
    const periodNumber = this.integer(
      row.period_number,
      "period_number",
      1,
      20,
    );

    let session = await tx.attendanceSession.findUnique({
      where: {
        sectionId_subjectId_sessionDate_periodNumber: {
          sectionId: section.id,
          subjectId: subject.id,
          sessionDate,
          periodNumber,
        },
      },
    });
    if (session) {
      const createdByThisImport = await tx.importJobRecord.findUnique({
        where: {
          importJobId_model_recordId: {
            importJobId,
            model: "AttendanceSession",
            recordId: session.id,
          },
        },
      });
      if (!createdByThisImport)
        throw new BadRequestException(
          "An attendance session already exists for this class, subject, date and period outside this import.",
        );
      if (session.facultyId !== faculty.id)
        throw new BadRequestException(
          "Rows for the same imported session use different faculty identities.",
        );
    } else {
      session = await tx.attendanceSession.create({
        data: {
          academicYearId: academicYear.id,
          sectionId: section.id,
          subjectId: subject.id,
          facultyId: faculty.id,
          sessionDate,
          periodNumber,
          status: "LOCKED",
          submittedAt: new Date(),
          lockedAt: new Date(),
        },
      });
      await tx.importJobRecord.create({
        data: {
          importJobId,
          rowNumber,
          model: "AttendanceSession",
          recordId: session.id,
          label: `${row.session_date} P${periodNumber} ${subject.code} ${section.code}`,
        },
      });
    }

    const duplicate = await tx.attendanceRecord.findUnique({
      where: {
        sessionId_studentUserId: {
          sessionId: session.id,
          studentUserId: student.userId,
        },
      },
    });
    if (duplicate)
      throw new BadRequestException(
        "Attendance for this student and session already exists.",
      );
    const sourceNote = [
      row.note?.trim(),
      row.marked_by ? `Legacy marker: ${row.marked_by.trim()}` : "",
      `Imported by ${requestedById}`,
    ]
      .filter(Boolean)
      .join(" | ")
      .slice(0, 500);
    const status = this.attendanceCode(row.status);
    const item = await tx.attendanceRecord.create({
      data: {
        sessionId: session.id,
        studentUserId: student.userId,
        status,
        ...attendanceParts(status),
        note: sourceNote || undefined,
        markedAt: sessionDate,
      },
    });
    return this.record(
      rowNumber,
      "AttendanceRecord",
      item.id,
      `${row.session_date} ${subject.code} - ${student.user.fullName}`,
    );
  }

  private async createBlock(
    tx: Prisma.TransactionClient,
    collegeId: string,
    row: ImportRow,
    rowNumber: number,
  ): Promise<ImportedRecord> {
    const campus = await tx.campus.findFirst({
      where: { collegeId, code: this.code(row.campus_code), isActive: true },
    });
    if (!campus) throw new BadRequestException("campus_code was not found.");
    const item = await tx.block.create({
      data: {
        campusId: campus.id,
        code: this.code(row.code),
        name: row.name,
        sortOrder: this.integer(row.sort_order, "sort_order", 0, 10_000, 0),
      },
    });
    return this.record(
      rowNumber,
      "Block",
      item.id,
      `${item.code} - ${item.name}`,
    );
  }

  private async createFloor(
    tx: Prisma.TransactionClient,
    collegeId: string,
    row: ImportRow,
    rowNumber: number,
  ): Promise<ImportedRecord> {
    const block = await tx.block.findFirst({
      where: {
        code: this.code(row.block_code),
        campus: { collegeId, code: this.code(row.campus_code), isActive: true },
        isActive: true,
      },
    });
    if (!block)
      throw new BadRequestException(
        "campus_code and block_code did not identify an active block.",
      );
    const item = await tx.floor.create({
      data: {
        blockId: block.id,
        code: this.code(row.code),
        name: row.name,
        level: this.integer(row.level, "level", -10, 200),
        sortOrder: this.integer(row.sort_order, "sort_order", 0, 10_000, 0),
      },
    });
    return this.record(
      rowNumber,
      "Floor",
      item.id,
      `${item.code} - ${item.name}`,
    );
  }

  private async createRoom(
    tx: Prisma.TransactionClient,
    collegeId: string,
    row: ImportRow,
    rowNumber: number,
  ): Promise<ImportedRecord> {
    const floor = await tx.floor.findFirst({
      where: {
        code: this.code(row.floor_code),
        block: {
          code: this.code(row.block_code),
          campus: {
            collegeId,
            code: this.code(row.campus_code),
            isActive: true,
          },
          isActive: true,
        },
        isActive: true,
      },
    });
    if (!floor)
      throw new BadRequestException(
        "The campus, block and floor codes did not identify an active floor.",
      );
    const department = row.department_code
      ? await tx.department.findFirst({
          where: {
            collegeId,
            code: this.code(row.department_code),
            isActive: true,
          },
        })
      : null;
    if (row.department_code && !department)
      throw new BadRequestException("department_code was not found.");
    const roomType = this.roomType(row.room_type);
    const item = await tx.room.create({
      data: {
        floorId: floor.id,
        departmentId: department?.id,
        code: this.code(row.code),
        name: row.name,
        roomNumber: row.room_number || undefined,
        roomType,
        customRoomTypeLabel: roomType === RoomType.OTHER ? "Other" : null,
        capacity: this.optionalInteger(row.capacity, "capacity", 1, 100_000),
        sortOrder: this.integer(row.sort_order, "sort_order", 0, 10_000, 0),
      },
    });
    return this.record(
      rowNumber,
      "Room",
      item.id,
      `${item.code} - ${item.name}`,
    );
  }

  private async createAsset(
    tx: Prisma.TransactionClient,
    collegeId: string,
    row: ImportRow,
    rowNumber: number,
  ): Promise<ImportedRecord> {
    const rooms = await tx.room.findMany({
      where: {
        code: this.code(row.room_code),
        isActive: true,
        floor: { block: { campus: { collegeId } } },
      },
      take: 2,
    });
    if (rooms.length !== 1)
      throw new BadRequestException(
        rooms.length
          ? "room_code is ambiguous across floors."
          : "room_code was not found.",
      );
    const category = await tx.assetCategory.findFirst({
      where: {
        name: { equals: row.category_name, mode: "insensitive" },
        isActive: true,
      },
    });
    if (!category)
      throw new BadRequestException("category_name was not found.");
    const room = rooms[0];
    if (!room) throw new BadRequestException("room_code was not found.");
    const item = await tx.asset.create({
      data: {
        roomId: room.id,
        categoryId: category.id,
        code: this.code(row.code),
        name: row.name,
        serialNumber: row.serial_number || undefined,
        installedOn: this.date(row.installed_on),
      },
    });
    return this.record(
      rowNumber,
      "Asset",
      item.id,
      `${item.code} - ${item.name}`,
    );
  }

  private async createResponsiblePerson(
    tx: Prisma.TransactionClient,
    collegeId: string,
    row: ImportRow,
    rowNumber: number,
  ): Promise<ImportedRecord> {
    const team = await tx.responsibleTeam.findFirst({
      where: { collegeId, code: this.code(row.team_code), isActive: true },
    });
    if (!team) throw new BadRequestException("team_code was not found.");
    const user = await tx.user.findFirst({
      where: {
        collegeId,
        collegeIdentityId: row.college_identity_id,
        status: "ACTIVE",
      },
    });
    if (!user)
      throw new BadRequestException(
        "college_identity_id did not identify an active user.",
      );
    const existing = await tx.responsibleTeamMember.findUnique({
      where: { teamId_userId: { teamId: team.id, userId: user.id } },
    });
    if (existing)
      throw new BadRequestException(
        "This person is already a member of the team.",
      );
    const item = await tx.responsibleTeamMember.create({
      data: {
        teamId: team.id,
        userId: user.id,
        isPrimary: this.boolean(row.is_primary),
        maxOpenIssues: this.optionalInteger(
          row.max_open_issues,
          "max_open_issues",
          1,
          10_000,
        ),
      },
    });
    return this.record(
      rowNumber,
      "ResponsibleTeamMember",
      item.id,
      `${team.code} - ${user.fullName}`,
    );
  }

  private async createAssignmentRule(
    tx: Prisma.TransactionClient,
    collegeId: string,
    row: ImportRow,
    rowNumber: number,
  ): Promise<ImportedRecord> {
    const team = await tx.responsibleTeam.findFirst({
      where: { collegeId, code: this.code(row.team_code), isActive: true },
    });
    if (!team) throw new BadRequestException("team_code was not found.");
    const campus = row.campus_code
      ? await tx.campus.findFirst({
          where: {
            collegeId,
            code: this.code(row.campus_code),
            isActive: true,
          },
        })
      : null;
    if (row.campus_code && !campus)
      throw new BadRequestException("campus_code was not found.");
    const block = row.block_code
      ? await tx.block.findFirst({
          where: {
            code: this.code(row.block_code),
            isActive: true,
            campus: { collegeId, ...(campus ? { id: campus.id } : {}) },
          },
        })
      : null;
    if (row.block_code && !block)
      throw new BadRequestException(
        "block_code was not found in the selected campus.",
      );
    const floor = row.floor_code
      ? await tx.floor.findFirst({
          where: {
            code: this.code(row.floor_code),
            isActive: true,
            block: {
              campus: { collegeId },
              ...(block ? { id: block.id } : {}),
            },
          },
        })
      : null;
    if (row.floor_code && !floor)
      throw new BadRequestException(
        "floor_code was not found in the selected block.",
      );
    const room = row.room_code
      ? await tx.room.findFirst({
          where: {
            code: this.code(row.room_code),
            isActive: true,
            floor: { block: { campus: { collegeId } } },
            ...(floor ? { floorId: floor.id } : {}),
          },
        })
      : null;
    if (row.room_code && !room)
      throw new BadRequestException(
        "room_code was not found in the selected floor.",
      );
    const department = row.department_code
      ? await tx.department.findFirst({
          where: {
            collegeId,
            code: this.code(row.department_code),
            isActive: true,
          },
        })
      : null;
    if (row.department_code && !department)
      throw new BadRequestException("department_code was not found.");
    const category = row.category_code
      ? await tx.issueCategory.findFirst({
          where: {
            collegeId,
            code: this.code(row.category_code),
            isActive: true,
          },
        })
      : null;
    if (row.category_code && !category)
      throw new BadRequestException("category_code was not found.");
    const issueType = row.issue_type_code
      ? await tx.issueType.findFirst({
          where: {
            code: this.code(row.issue_type_code),
            isActive: true,
            category: { collegeId, ...(category ? { id: category.id } : {}) },
          },
        })
      : null;
    if (row.issue_type_code && !issueType)
      throw new BadRequestException(
        "issue_type_code was not found in the selected category.",
      );
    const asset = row.asset_code
      ? await tx.asset.findFirst({
          where: {
            code: this.code(row.asset_code),
            isActive: true,
            room: { floor: { block: { campus: { collegeId } } } },
          },
        })
      : null;
    if (row.asset_code && !asset)
      throw new BadRequestException("asset_code was not found.");
    const users = await this.ruleUsers(tx, collegeId, row);
    if (users.primaryUserId) {
      const member = await tx.responsibleTeamMember.findFirst({
        where: { teamId: team.id, userId: users.primaryUserId, isActive: true },
      });
      if (!member)
        throw new BadRequestException(
          "primary_user_identity must be an active member of the selected team.",
        );
    }
    const item = await tx.issueAssignmentRule.create({
      data: {
        collegeId,
        teamId: team.id,
        campusId: campus?.id,
        blockId: block?.id,
        floorId: floor?.id,
        roomId: room?.id,
        roomType: row.room_type ? this.roomType(row.room_type) : undefined,
        departmentId: department?.id,
        categoryId: category?.id,
        issueTypeId: issueType?.id,
        assetId: asset?.id,
        priorityFilter: row.priority
          ? (row.priority.toUpperCase() as IssuePriority)
          : undefined,
        ...users,
        rulePriority: this.integer(
          row.rule_priority,
          "rule_priority",
          0,
          10_000,
          0,
        ),
        workloadBalancing: this.boolean(row.workload_balancing),
      },
    });
    return this.record(
      rowNumber,
      "IssueAssignmentRule",
      item.id,
      `${team.code} rule ${item.rulePriority}`,
    );
  }

  private async resolveScope(
    tx: Prisma.TransactionClient,
    collegeId: string,
    typeValue: string,
    codeValue: string,
    roleCodes: string[],
  ): Promise<{ scopeType: ScopeType; scopeId?: string }> {
    const scopeType = (
      typeValue ||
      (roleCodes.some((code) =>
        ["SUPER_ADMIN", "MAIN_ADMIN", "PRINCIPAL", "VICE_PRINCIPAL"].includes(
          code,
        ),
      )
        ? "COLLEGE"
        : "")
    ).toUpperCase() as ScopeType;
    if (!Object.values(ScopeType).includes(scopeType))
      throw new BadRequestException(
        "scope_type is required and must be a supported scope.",
      );
    if (scopeType === ScopeType.COLLEGE) {
      if (
        !roleCodes.some((code) =>
          ["SUPER_ADMIN", "MAIN_ADMIN", "PRINCIPAL", "VICE_PRINCIPAL"].includes(
            code,
          ),
        )
      )
        throw new BadRequestException(
          "College scope is restricted to college-wide administrative roles.",
        );
      return { scopeType };
    }
    if (scopeType === ScopeType.ASSIGNED_ISSUES) return { scopeType };
    if (!codeValue)
      throw new BadRequestException(
        "scope_code is required for the selected scope_type.",
      );
    const code = this.code(codeValue);
    let result: { id: string } | null = null;
    if (scopeType === ScopeType.CAMPUS)
      result = await tx.campus.findFirst({
        where: { collegeId, code, isActive: true },
        select: { id: true },
      });
    if (scopeType === ScopeType.DEPARTMENT)
      result = await tx.department.findFirst({
        where: { collegeId, code, isActive: true },
        select: { id: true },
      });
    if (scopeType === ScopeType.PROGRAMME)
      result = await tx.programme.findFirst({
        where: { collegeId, code, isActive: true },
        select: { id: true },
      });
    if (scopeType === ScopeType.BLOCK)
      result = await tx.block.findFirst({
        where: { code, isActive: true, campus: { collegeId } },
        select: { id: true },
      });
    if (scopeType === ScopeType.FLOOR)
      result = await tx.floor.findFirst({
        where: { code, isActive: true, block: { campus: { collegeId } } },
        select: { id: true },
      });
    if (scopeType === ScopeType.ROOM)
      result = await tx.room.findFirst({
        where: {
          code,
          isActive: true,
          floor: { block: { campus: { collegeId } } },
        },
        select: { id: true },
      });
    if (!result)
      throw new BadRequestException(
        "scope_code was not found for the selected scope_type.",
      );
    return { scopeType, scopeId: result.id };
  }

  private async ruleUsers(
    tx: Prisma.TransactionClient,
    collegeId: string,
    row: ImportRow,
  ) {
    const find = async (identity: string, field: string) => {
      if (!identity) return undefined;
      const user = await tx.user.findFirst({
        where: { collegeId, collegeIdentityId: identity, status: "ACTIVE" },
        select: { id: true },
      });
      if (!user)
        throw new BadRequestException(
          `${field} did not identify an active user.`,
        );
      return user.id;
    };
    return {
      primaryUserId: await find(
        row.primary_user_identity,
        "primary_user_identity",
      ),
      backupUserId: await find(
        row.backup_user_identity,
        "backup_user_identity",
      ),
      escalationUserId: await find(
        row.escalation_user_identity,
        "escalation_user_identity",
      ),
    };
  }

  private async resolveStudentAcademicData(
    tx: Prisma.TransactionClient | PrismaService,
    collegeId: string,
    row: ImportRow,
  ): Promise<StudentAcademicSelection> {
    if (row.class_room_number?.trim()) {
      return this.resolvePeopleAcademicData(tx, collegeId, row);
    }
    const department = await this.resolveDepartmentByCodeOrName(
      tx,
      collegeId,
      row.department_code,
    );
    if (!department)
      throw new BadRequestException(
        `Department code ${row.department_code || "(blank)"} was not found.`,
      );

    const programmes = await tx.programme.findMany({
      where: {
        collegeId,
        departmentId: department.id,
        isActive: true,
        archivedAt: null,
        department: { isActive: true, archivedAt: null },
        degreeTypeMaster: { isActive: true, archivedAt: null },
        ...(row.programme_code ? { code: this.code(row.programme_code) } : {}),
      },
      take: 2,
      select: { id: true, code: true },
    });
    if (programmes.length !== 1) {
      if (!row.programme_code && programmes.length > 1) {
        throw new BadRequestException(
          "programme_code is required because the selected department has multiple active programmes.",
        );
      }
      throw new BadRequestException(
        programmes.length
          ? "programme_code is ambiguous in the selected department."
          : row.programme_code
            ? `Programme code ${row.programme_code} was not found in the selected department.`
            : "The selected department does not have one active programme.",
      );
    }
    const programme = programmes[0]!;

    const academicYears = row.academic_year
      ? await tx.academicYear.findMany({
          where: { collegeId, isActive: true, archivedAt: null },
          select: { id: true, name: true, startsOn: true },
        })
      : await tx.academicYear.findMany({
          where: {
            collegeId,
            isCurrent: true,
            isActive: true,
            archivedAt: null,
          },
          take: 2,
          select: { id: true, name: true, startsOn: true },
        });
    const matchingAcademicYears = row.academic_year
      ? academicYears.filter(
          (year) =>
            year.name.trim().toLowerCase() ===
              row.academic_year.trim().toLowerCase() ||
            this.academicYearKey(year.name) ===
              this.academicYearKey(row.academic_year),
        )
      : academicYears;
    if (matchingAcademicYears.length !== 1) {
      throw new BadRequestException(
        matchingAcademicYears.length
          ? "academic_year is ambiguous."
          : "academic_year was not found.",
      );
    }
    const academicYear = matchingAcademicYears[0]!;
    if (!row.section_code?.trim())
      throw new BadRequestException(
        "section is required for an academic student profile.",
      );

    if (row.semester_number?.trim()) {
      const semesterNumber = this.integer(
        row.semester_number,
        "semester_number",
        1,
        8,
      );
      const semester = await tx.semester.findUnique({
        where: {
          programmeId_academicYearId_number: {
            programmeId: programme.id,
            academicYearId: academicYear.id,
            number: semesterNumber,
          },
        },
        select: { id: true, isActive: true },
      });
      if (!semester?.isActive)
        throw new BadRequestException(
          "semester was not found for the selected programme and academic year.",
        );
      const section = await tx.section.findUnique({
        where: {
          semesterId_code: {
            semesterId: semester.id,
            code: this.code(row.section_code),
          },
        },
        select: {
          id: true,
          code: true,
          capacity: true,
          isActive: true,
          archivedAt: true,
        },
      });
      if (!section?.isActive || section.archivedAt) {
        throw new BadRequestException(
          "section was not found or is archived for the selected semester.",
        );
      }
      return {
        departmentId: department.id,
        programmeId: programme.id,
        sectionId: section.id,
        academicYearId: academicYear.id,
        academicYearStartsOn: academicYear.startsOn,
        semesterId: semester.id,
        sectionCode: section.code,
        capacity: section.capacity,
      };
    }

    const sections = await tx.section.findMany({
      where: {
        code: this.code(row.section_code),
        isActive: true,
        archivedAt: null,
        semester: {
          programmeId: programme.id,
          academicYearId: academicYear.id,
          isActive: true,
        },
      },
      take: 2,
      select: { id: true, code: true, capacity: true, semesterId: true },
    });
    if (sections.length !== 1) {
      throw new BadRequestException(
        sections.length
          ? "section is ambiguous across active semesters; provide semester."
          : "section was not found for the selected programme and academic year.",
      );
    }
    const section = sections[0]!;
    return {
      departmentId: department.id,
      programmeId: programme.id,
      sectionId: section.id,
      academicYearId: academicYear.id,
      academicYearStartsOn: academicYear.startsOn,
      semesterId: section.semesterId,
      sectionCode: section.code,
      capacity: section.capacity,
    };
  }

  private async resolvePeopleAcademicData(
    tx: Prisma.TransactionClient | PrismaService,
    collegeId: string,
    row: ImportRow,
  ): Promise<StudentAcademicSelection> {
    const department = await this.resolvePeopleDepartment(
      tx,
      collegeId,
      row.department_code,
    );
    if (!department) {
      throw new BadRequestException(
        `Department ${row.department_code || "(blank)"} does not exist. Create or correct the department before importing this row.`,
      );
    }
    const studyYear = this.importStudyYear(row.year);
    if (!studyYear) {
      throw new BadRequestException("Year must be an integer from 1 to 4.");
    }
    const classroom = row.class_room_number?.trim();
    if (!classroom) {
      throw new BadRequestException("Class Room Number is required.");
    }

    const rooms = await tx.room.findMany({
      where: {
        isActive: true,
        archivedAt: null,
        AND: [
          {
            OR: [
              { code: { equals: classroom, mode: "insensitive" } },
              { roomNumber: { equals: classroom, mode: "insensitive" } },
            ],
          },
          {
            OR: [{ departmentId: null }, { departmentId: department.id }],
          },
        ],
        floor: {
          isActive: true,
          archivedAt: null,
          block: {
            isActive: true,
            archivedAt: null,
            campus: {
              collegeId,
              isActive: true,
              archivedAt: null,
            },
          },
        },
      },
      take: 3,
      select: { id: true, code: true, roomNumber: true, departmentId: true },
    });
    if (!rooms.length) {
      const mismatchedRoom = await tx.room.findFirst({
        where: {
          isActive: true,
          archivedAt: null,
          OR: [
            { code: { equals: classroom, mode: "insensitive" } },
            { roomNumber: { equals: classroom, mode: "insensitive" } },
          ],
          floor: {
            isActive: true,
            archivedAt: null,
            block: {
              isActive: true,
              archivedAt: null,
              campus: {
                collegeId,
                isActive: true,
                archivedAt: null,
              },
            },
          },
        },
        select: { departmentId: true },
      });
      if (mismatchedRoom?.departmentId) {
        throw new BadRequestException(
          `Classroom ${classroom} is not assigned to Department ${department.code}.`,
        );
      }
      throw new BadRequestException(
        `Classroom ${classroom} does not exist in an active campus location.`,
      );
    }
    if (rooms.length !== 1) {
      throw new BadRequestException(
        `Classroom ${classroom} is ambiguous across active campus locations. Use a unique room code.`,
      );
    }
    const room = rooms[0]!;
    const sections = await tx.section.findMany({
      where: {
        assignedRoomId: room.id,
        isActive: true,
        archivedAt: null,
        OR: [{ studyYear }, { studyYear: null }],
        semester: {
          isActive: true,
          number: { in: [studyYear * 2 - 1, studyYear * 2] },
          academicYear: {
            collegeId,
            isCurrent: true,
            isActive: true,
            archivedAt: null,
          },
          programme: {
            collegeId,
            departmentId: department.id,
            isActive: true,
            archivedAt: null,
            department: { isActive: true, archivedAt: null },
            degreeTypeMaster: { isActive: true, archivedAt: null },
          },
        },
      },
      take: 3,
      select: {
        id: true,
        code: true,
        capacity: true,
        semesterId: true,
        semester: {
          select: {
            academicYearId: true,
            academicYear: { select: { startsOn: true } },
            programmeId: true,
          },
        },
      },
    });
    if (!sections.length) {
      throw new BadRequestException(
        `Classroom ${classroom} has no current active Section for Department ${department.code} and Year ${studyYear}.`,
      );
    }
    if (sections.length !== 1) {
      throw new BadRequestException(
        `Classroom ${classroom} is ambiguous because multiple current active Sections match Department ${department.code} and Year ${studyYear}.`,
      );
    }
    const section = sections[0]!;
    return {
      departmentId: department.id,
      programmeId: section.semester.programmeId,
      sectionId: section.id,
      academicYearId: section.semester.academicYearId,
      academicYearStartsOn: section.semester.academicYear.startsOn,
      semesterId: section.semesterId,
      sectionCode: section.code,
      capacity: section.capacity,
    };
  }

  private academicYearKey(value: string): string {
    const match = value.trim().match(/^(\d{4})\D+(\d{2}|\d{4})$/u);
    if (!match) return value.trim().toLowerCase();
    const start = Number(match[1]);
    const rawEnd = match[2]!;
    const end =
      rawEnd.length === 2
        ? Math.floor(start / 100) * 100 + Number(rawEnd)
        : Number(rawEnd);
    return `${start}-${end}`;
  }

  private async resolveAcademicSection(
    tx: Prisma.TransactionClient,
    collegeId: string,
    row: ImportRow,
  ): Promise<{ id: string; semesterId: string }> {
    const programmes = await tx.programme.findMany({
      where: {
        collegeId,
        code: this.code(row.programme_code),
        isActive: true,
        archivedAt: null,
        department: { isActive: true, archivedAt: null },
        degreeTypeMaster: { isActive: true, archivedAt: null },
      },
      take: 2,
    });
    if (programmes.length !== 1)
      throw new BadRequestException(
        programmes.length
          ? "programme_code is ambiguous."
          : "programme_code was not found.",
      );
    const programme = programmes[0]!;
    const academicYear = row.academic_year
      ? await tx.academicYear.findFirst({
          where: {
            collegeId,
            name: row.academic_year,
            isActive: true,
            archivedAt: null,
          },
        })
      : await tx.academicYear.findFirst({
          where: {
            collegeId,
            isCurrent: true,
            isActive: true,
            archivedAt: null,
          },
        });
    if (!academicYear)
      throw new BadRequestException("academic_year was not found.");
    const semesterNumber = this.integer(
      row.semester_number || row.assigned_semester,
      "semester_number",
      1,
      8,
    );
    const sectionCode = row.section_code || row.assigned_section;
    const semester = await tx.semester.findUnique({
      where: {
        programmeId_academicYearId_number: {
          programmeId: programme.id,
          academicYearId: academicYear.id,
          number: semesterNumber,
        },
      },
    });
    if (!semester?.isActive)
      throw new BadRequestException(
        "semester_number was not found for the programme and academic year.",
      );
    const section = await tx.section.findUnique({
      where: {
        semesterId_code: {
          semesterId: semester.id,
          code: this.code(sectionCode),
        },
      },
      select: { id: true, semesterId: true, isActive: true },
    });
    if (!section?.isActive)
      throw new BadRequestException(
        "section_code was not found for the selected semester.",
      );
    return section;
  }

  private async placeImportedStudent(
    tx: Prisma.TransactionClient,
    collegeId: string,
    userId: string,
    accountStatus: AccountStatus,
    selection: StudentAcademicSelection,
    row: ImportRow,
    deriveAdmissionYear = false,
  ): Promise<void> {
    const studyYear = this.importStudyYear(row.year);
    const explicitAdmissionYear = this.optionalInteger(
      row.admission_year,
      "admission_year",
      1990,
      2200,
    );
    const admissionYear =
      explicitAdmissionYear ??
      (deriveAdmissionYear && studyYear && selection.academicYearStartsOn
        ? selection.academicYearStartsOn.getUTCFullYear() - studyYear + 1
        : undefined);
    await this.sectionPlacement.placeStudent(tx, {
      collegeId,
      userId,
      sectionId: selection.sectionId,
      startsOn: this.today(),
      accountStatus,
      profile: {
        departmentId: selection.departmentId,
        programmeId: selection.programmeId,
        academicYearId: selection.academicYearId,
        semesterId: selection.semesterId,
        studentId: row.student_id || undefined,
        registerNumber: row.register_number || undefined,
        admissionYear,
        rollNumber: row.roll_number || undefined,
        admissionNumber: row.admission_number || undefined,
        studyYear,
        dateOfBirth: this.date(row.date_of_birth),
        gender: row.gender || undefined,
        bloodGroup: row.blood_group || undefined,
        address: row.address || undefined,
        parentName: row.parent_name || undefined,
        parentMobileNumber: row.parent_mobile_number || undefined,
      },
    });
    if (row.legacy_id) {
      await tx.studentProfile.update({
        where: { userId },
        data: { legacyId: row.legacy_id },
      });
    }
  }

  private async resolveIssueCategory(
    tx: Prisma.TransactionClient,
    collegeId: string,
    value?: string,
  ): Promise<{ id: string } | undefined> {
    if (!value) return undefined;
    const category = await tx.issueCategory.findFirst({
      where: {
        collegeId,
        isActive: true,
        OR: [
          { code: this.code(value) },
          { name: { equals: value.trim(), mode: "insensitive" } },
        ],
      },
      select: { id: true },
    });
    if (!category)
      throw new BadRequestException("assigned_issue_category was not found.");
    return category;
  }

  private async resolveLocationScope(
    tx: Prisma.TransactionClient,
    collegeId: string,
    row: ImportRow,
  ): Promise<{ scopeType: ScopeType; scopeId?: string } | undefined> {
    if (row.assigned_room) {
      const rooms = await tx.room.findMany({
        where: {
          code: this.code(row.assigned_room),
          isActive: true,
          floor: { block: { campus: { collegeId } } },
        },
        take: 2,
        select: { id: true },
      });
      if (rooms.length !== 1)
        throw new BadRequestException(
          rooms.length
            ? "assigned_room is ambiguous across the college."
            : "assigned_room was not found.",
        );
      return { scopeType: ScopeType.ROOM, scopeId: rooms[0]!.id };
    }
    if (row.assigned_floor) {
      const floors = await tx.floor.findMany({
        where: {
          code: this.code(row.assigned_floor),
          isActive: true,
          block: { campus: { collegeId } },
        },
        take: 2,
        select: { id: true },
      });
      if (floors.length !== 1)
        throw new BadRequestException(
          floors.length
            ? "assigned_floor is ambiguous across the college."
            : "assigned_floor was not found.",
        );
      return { scopeType: ScopeType.FLOOR, scopeId: floors[0]!.id };
    }
    if (row.assigned_block) {
      const blocks = await tx.block.findMany({
        where: {
          code: this.code(row.assigned_block),
          isActive: true,
          campus: { collegeId },
        },
        take: 2,
        select: { id: true },
      });
      if (blocks.length !== 1)
        throw new BadRequestException(
          blocks.length
            ? "assigned_block is ambiguous across campuses."
            : "assigned_block was not found.",
        );
      return { scopeType: ScopeType.BLOCK, scopeId: blocks[0]!.id };
    }
    return undefined;
  }

  private hasStudentProfileData(row: ImportRow): boolean {
    return Boolean(
      row.programme_code ||
        row.section_code ||
        row.academic_year ||
        row.semester_number ||
        row.register_number ||
        row.roll_number ||
        row.admission_year,
    );
  }

  private hasStaffProfileData(row: ImportRow): boolean {
    return Boolean(
      row.employee_id ||
        row.designation ||
        row.joined_on ||
        row.specialization ||
        row.shift ||
        row.assigned_block ||
        row.assigned_floor ||
        row.assigned_room ||
        row.assigned_issue_category,
    );
  }

  private async resolveDepartmentByCodeOrName(
    tx: Prisma.TransactionClient | PrismaService,
    collegeId: string,
    value?: string,
  ): Promise<{ id: string; code: string; name: string } | null> {
    const raw = (value || "").trim();
    if (!raw) return null;
    return tx.department.findFirst({
      where: {
        collegeId,
        isActive: true,
        archivedAt: null,
        OR: [
          { code: raw },
          { name: raw },
          { code: { equals: raw, mode: "insensitive" } },
          { name: { equals: raw, mode: "insensitive" } },
          { shortName: { equals: raw, mode: "insensitive" } },
        ],
      },
      select: { id: true, code: true, name: true },
    });
  }

  private async resolvePeopleDepartment(
    tx: Prisma.TransactionClient | PrismaService,
    collegeId: string,
    value?: string,
  ): Promise<{ id: string; code: string; name: string } | null> {
    const raw = (value || "").trim();
    if (!raw) return null;
    const departments = await tx.department.findMany({
      where: {
        collegeId,
        isActive: true,
        archivedAt: null,
        OR: [
          { code: { equals: raw, mode: "insensitive" } },
          { name: { equals: raw, mode: "insensitive" } },
          { shortName: { equals: raw, mode: "insensitive" } },
        ],
      },
      take: 2,
      select: { id: true, code: true, name: true },
    });
    if (departments.length > 1) {
      throw new BadRequestException(
        `Department ${raw} is ambiguous. Use the unique department code.`,
      );
    }
    return departments[0] ?? null;
  }

  private ensureAccountIdentity(row: ImportRow): void {
    if (!row.email?.trim() && !row.college_identity_id?.trim()) {
      throw new BadRequestException(
        "Email is required for basic account imports.",
      );
    }
    if (!row.college_identity_id?.trim() && row.email?.trim()) {
      row.college_identity_id = row.email.trim().toLowerCase().slice(0, 60);
    }
  }

  private record(
    rowNumber: number,
    model: string,
    id: string,
    label: string,
  ): ImportedRecord {
    return { rowNumber, model, id, label };
  }
  private code(value: string): string {
    return value.trim().toUpperCase();
  }
  private list(value: string): string[] {
    return [
      ...new Set(
        (value || "")
          .split(/[;,|]/)
          .map((item) => this.code(item))
          .filter(Boolean),
      ),
    ];
  }
  private accountStatus(value?: string): AccountStatus {
    const status = (value || "ACTIVE").trim().toUpperCase() as AccountStatus;
    if (!Object.values(AccountStatus).includes(status))
      throw new BadRequestException("account_status is not recognized.");
    return status;
  }
  private importStudyYear(value?: string): number | undefined {
    if (!value?.trim()) return undefined;
    const normalized = value
      .trim()
      .toUpperCase()
      .replace(/[\s-]+/g, "_");
    if (/^[1-4]$/.test(normalized)) return Number(normalized);
    const aliases: Record<string, number> = {
      "1ST": 1,
      "1ST_YEAR": 1,
      FIRST: 1,
      FIRST_YEAR: 1,
      "2ND": 2,
      "2RD": 2,
      "2ND_YEAR": 2,
      "2RD_YEAR": 2,
      SECOND: 2,
      SECOND_YEAR: 2,
      "3RD": 3,
      "3RD_YEAR": 3,
      THIRD: 3,
      THIRD_YEAR: 3,
      "4TH": 4,
      "4TH_YEAR": 4,
      FOURTH: 4,
      FOURTH_YEAR: 4,
    };
    const year = aliases[normalized];
    if (year === undefined)
      throw new BadRequestException(
        "study_year must be an integer from 1 to 4.",
      );
    return year;
  }
  private boolean(value?: string): boolean {
    return ["true", "yes", "1"].includes((value || "").toLowerCase());
  }
  private date(value?: string): Date | undefined {
    return value ? new Date(`${value}T00:00:00.000Z`) : undefined;
  }
  private today(): Date {
    return new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
  }
  private requiredDate(value: string, field: string): Date {
    const date = this.date(value);
    if (!date || Number.isNaN(date.getTime()))
      throw new BadRequestException(
        `${field} must be a valid date using YYYY-MM-DD.`,
      );
    return date;
  }
  private attendanceCode(value: string): AttendanceCode {
    const aliases: Record<string, AttendanceCode> = {
      P: AttendanceCode.PRESENT,
      A: AttendanceCode.ABSENT,
      L: AttendanceCode.LATE,
      OD: AttendanceCode.ON_DUTY,
      ML: AttendanceCode.MEDICAL_LEAVE,
      AL: AttendanceCode.AUTHORIZED_LEAVE,
    };
    const normalized = value.trim().toUpperCase();
    const status = aliases[normalized] ?? (normalized as AttendanceCode);
    if (!Object.values(AttendanceCode).includes(status))
      throw new BadRequestException(
        "status is not a supported attendance code.",
      );
    return status;
  }
  private roomType(value: string): RoomType {
    const normalized = value
      .trim()
      .toUpperCase()
      .replace(/[\s-]+/g, "_") as RoomType;
    if (!Object.values(RoomType).includes(normalized))
      throw new BadRequestException("room_type is not a supported room type.");
    return normalized;
  }
  private importRowError(
    entityType: ImportEntityType,
    row: ImportRow,
    rowNumber: number,
    message: string,
  ): ImportRowError {
    return {
      rowNumber,
      message,
      ...(entityType === "PEOPLE" && row.college_identity_id
        ? { userId: row.college_identity_id.slice(0, 60) }
        : {}),
      ...(entityType === "PEOPLE" && row.full_name
        ? { userName: row.full_name.slice(0, 180) }
        : {}),
      ...(entityType === "PEOPLE" && row.email
        ? { email: row.email.slice(0, 254) }
        : {}),
      ...(entityType === "PEOPLE" && row.department_code
        ? { department: row.department_code.slice(0, 180) }
        : {}),
      ...(entityType === "PEOPLE" && row.year
        ? { year: row.year.slice(0, 20) }
        : {}),
    };
  }
  private errorMessage(error: unknown, row?: ImportRow): string {
    let message: string;
    if (error instanceof HttpException) {
      const response = error.getResponse();
      message =
        typeof response === "string"
          ? response
          : ((
              response as { message?: string | string[] }
            ).message?.toString() ?? "Row validation failed.");
    } else {
      message =
        error instanceof Error ? error.message : "Row validation failed.";
    }
    const password = row?.temporary_password;
    return password && message.includes(password)
      ? message.split(password).join("[REDACTED]")
      : message;
  }
  private optionalInteger(
    value: string | undefined,
    field: string,
    min: number,
    max: number,
  ): number | undefined {
    return value ? this.integer(value, field, min, max) : undefined;
  }
  private integer(
    value: string | undefined,
    field: string,
    min: number,
    max: number,
    fallback?: number,
  ): number {
    if (!value && fallback !== undefined) return fallback;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < min || parsed > max)
      throw new BadRequestException(
        `${field} must be a whole number from ${min} to ${max}.`,
      );
    return parsed;
  }
  private generateTemporaryPassword(): string {
    const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
    const lower = "abcdefghijkmnopqrstuvwxyz";
    const digits = "23456789";
    const special = "!@#$%^&*";
    const all = `${upper}${lower}${digits}${special}`;
    const pick = (chars: string) =>
      chars[randomInt(chars.length)] ?? chars[0] ?? "A";
    const chars = [
      pick(upper),
      pick(lower),
      pick(digits),
      pick(special),
      ...Array.from({ length: 8 }, () => pick(all)),
    ];
    for (let index = chars.length - 1; index > 0; index -= 1) {
      const swapIndex = randomInt(index + 1);
      const current = chars[index] ?? "A";
      chars[index] = chars[swapIndex] ?? current;
      chars[swapIndex] = current;
    }
    return chars.join("");
  }
  private assertTemporaryPassword(value: string, peoplePolicy = false): void {
    const exact = value;
    const minimum = this.config.get<number>(
      "IMPORT_TEMP_PASSWORD_MIN_LENGTH",
      6,
    );
    const maximum = this.config.get<number>(
      "IMPORT_TEMP_PASSWORD_MAX_LENGTH",
      200,
    );
    if (
      peoplePolicy &&
      !(
        exact.length >= minimum &&
        exact.length <= maximum &&
        (/^\d+$/.test(exact) ||
          (exact.length >= 12 &&
            /[a-z]/.test(exact) &&
            /[A-Z]/.test(exact) &&
            /\d/.test(exact) &&
            /[^A-Za-z0-9\s]/.test(exact)))
      )
    ) {
      throw new BadRequestException(
        `User Password must be ${minimum} to ${maximum} exact characters. Numeric-only college temporary passwords are allowed; other passwords must contain uppercase, lowercase, number, and special characters.`,
      );
    }
    if (!peoplePolicy && exact.trim().length < 6) {
      throw new BadRequestException(
        "temporary_password must be at least 6 characters.",
      );
    }
  }
  private assertPeopleCoreFields(
    row: ImportRow,
    configuredOfficialDomains?: readonly string[],
  ): void {
    const fullName = row.full_name?.trim() ?? "";
    if (!fullName) throw new BadRequestException("User Name is required.");
    if (fullName.length > 180) {
      throw new BadRequestException(
        "User Name must contain at most 180 characters.",
      );
    }
    const userId = row.college_identity_id ?? "";
    if (!userId.trim()) throw new BadRequestException("User ID is required.");
    if (userId !== userId.trim()) {
      throw new BadRequestException(
        "User ID must not begin or end with whitespace.",
      );
    }
    if (userId.length > 60) {
      throw new BadRequestException(
        "User ID must contain at most 60 characters.",
      );
    }
    const email = row.email?.trim().toLowerCase() ?? "";
    if (!email) {
      throw new BadRequestException("Official College Email is required.");
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new BadRequestException("Official College Email is not valid.");
    }
    const officialDomains = new Set(
      (
        configuredOfficialDomains ??
        this.config.get<string>("OFFICIAL_EMAIL_DOMAINS", "").split(",")
      )
        .map((domain) => domain.trim().toLowerCase().replace(/^@/, ""))
        .filter(Boolean),
    );
    const emailDomain = email.slice(email.lastIndexOf("@") + 1);
    if (officialDomains.size && !officialDomains.has(emailDomain)) {
      throw new BadRequestException(
        "Official College Email must use an approved college domain.",
      );
    }
    const password = row.temporary_password ?? "";
    if (!password) throw new BadRequestException("User Password is required.");
    if (password !== password.trim()) {
      throw new BadRequestException(
        "User Password must not begin or end with whitespace.",
      );
    }
    this.assertTemporaryPassword(password, true);
    if (row.mobile && !/^\d{7,15}$/.test(row.mobile)) {
      throw new BadRequestException(
        "Mobile Number must contain only 7 to 15 digits.",
      );
    }
  }

  private hashTemporaryPassword(password: string): Promise<string> {
    return argon2.hash(
      password + this.config.get<string>("PASSWORD_PEPPER", ""),
      { type: argon2.argon2id },
    );
  }
}
