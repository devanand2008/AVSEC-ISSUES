import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { AuthPrincipal } from "../../common/http/request-context";
import { PrismaService } from "../../database/prisma.service";
import { Prisma } from "../../generated/prisma/client";
import { AuditService } from "../audit/audit.service";
import type {
  CreateClassCoordinatorAssignmentDto,
  CreateClassRepresentativeAssignmentDto,
  CreateDepartmentDto,
  CreateFacultySubjectAssignmentDto,
  UpdateDepartmentDto,
  CreateProgrammeDto,
  UpdateProgrammeDto,
  CreateAcademicYearDto,
  CreateSemesterDto,
  CreateSectionDto,
  CreateSubjectDto,
  DeactivateAcademicAssignmentDto,
  UpdateEntityStatusDto,
  UpdateSectionDto,
} from "./dto/academic.dto";
import { OfficialGroupsService } from "../conversations/official-groups.service";

@Injectable()
export class AcademicService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly officialGroups: OfficialGroupsService,
  ) {}

  /* ─── READ (existing, preserved) ─── */

  departments(user: AuthPrincipal) {
    return this.prisma.department.findMany({
      where: { collegeId: user.collegeId, isActive: true, archivedAt: null },
      select: { id: true, code: true, name: true, campusId: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
  }

  programmes(user: AuthPrincipal, departmentId?: string) {
    return this.prisma.programme.findMany({
      where: { collegeId: user.collegeId, isActive: true, ...(departmentId ? { departmentId } : {}) },
      select: { id: true, code: true, name: true, departmentId: true, durationYears: true },
      orderBy: { name: "asc" },
    });
  }

  years(user: AuthPrincipal) {
    return this.prisma.academicYear.findMany({
      where: { collegeId: user.collegeId, isActive: true },
      select: { id: true, name: true, startsOn: true, endsOn: true, isCurrent: true },
      orderBy: { startsOn: "desc" },
    });
  }

  semesters(user: AuthPrincipal, programmeId?: string, academicYearId?: string) {
    return this.prisma.semester.findMany({
      where: {
        programme: { collegeId: user.collegeId },
        isActive: true,
        ...(programmeId ? { programmeId } : {}),
        ...(academicYearId ? { academicYearId } : {}),
      },
      select: { id: true, number: true, name: true, programmeId: true, academicYearId: true },
      orderBy: { number: "asc" },
    });
  }

  sections(user: AuthPrincipal, semesterId?: string) {
    return this.prisma.section.findMany({
      where: {
        semester: { programme: { collegeId: user.collegeId } },
        isActive: true,
        ...(semesterId ? { semesterId } : {}),
      },
      select: { id: true, code: true, name: true, semesterId: true, capacity: true },
      orderBy: { code: "asc" },
    });
  }

  subjects(user: AuthPrincipal, semesterId?: string) {
    return this.prisma.subject.findMany({
      where: {
        semester: { programme: { collegeId: user.collegeId } },
        isActive: true,
        ...(semesterId ? { semesterId } : {}),
        ...(
          user.permissions.includes("attendance.session.create") &&
          !user.permissions.includes("attendance.read_college")
            ? { facultyAssignments: { some: { facultyId: user.id, isActive: true } } }
            : {}
        ),
      },
      select: { id: true, code: true, name: true, semesterId: true },
      orderBy: { code: "asc" },
    });
  }

  /* ─── ADMIN READ (include inactive, full details) ─── */

  async allDepartments(user: AuthPrincipal, filters: { search?: string; status?: string; hod?: string } = {}) {
    const departments = await this.prisma.department.findMany({
      where: {
        collegeId: user.collegeId,
        ...(filters.search ? { OR: [{ name: { contains: filters.search, mode: "insensitive" } }, { code: { contains: filters.search, mode: "insensitive" } }, { shortName: { contains: filters.search, mode: "insensitive" } }] } : {}),
        ...(filters.status === "ACTIVE" ? { isActive: true, archivedAt: null } : {}),
        ...(filters.status === "INACTIVE" ? { isActive: false, archivedAt: null } : {}),
        ...(filters.status === "ARCHIVED" ? { archivedAt: { not: null } } : {}),
        ...(filters.hod === "ASSIGNED" ? { hodId: { not: null } } : {}),
        ...(filters.hod === "UNASSIGNED" ? { hodId: null } : {}),
      },
      include: {
        campus: { select: { id: true, name: true } },
        _count: { select: { programmes: true, studentProfiles: true, staffProfiles: true, rooms: true, issues: { where: { status: { notIn: ["VERIFIED", "CLOSED", "REJECTED", "CANCELLED"] } } } } },
      },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
    const hodIds = [...new Set(departments.flatMap((department) => department.hodId ? [department.hodId] : []))];
    const [hods, sectionCounts] = await Promise.all([
      hodIds.length ? this.prisma.user.findMany({ where: { id: { in: hodIds }, collegeId: user.collegeId }, select: { id: true, publicId: true, fullName: true, status: true } }) : Promise.resolve([]),
      this.prisma.section.groupBy({
        by: ["semesterId"],
        _count: true,
        where: { semester: { programme: { departmentId: { in: departments.map((d) => d.id) } } } },
      }),
    ]);
    const programmes = await this.prisma.programme.findMany({
      where: { departmentId: { in: departments.map((d) => d.id) } },
      select: { departmentId: true, semesters: { select: { id: true } } },
    });
    const semesterToCount = new Map(sectionCounts.map((sc) => [sc.semesterId, sc._count]));
    const departmentClassCounts = new Map<string, number>();
    for (const prog of programmes) {
      let count = departmentClassCounts.get(prog.departmentId) ?? 0;
      for (const sem of prog.semesters) {
        count += semesterToCount.get(sem.id) ?? 0;
      }
      departmentClassCounts.set(prog.departmentId, count);
    }
    const byId = new Map(hods.map((hod) => [hod.id, hod]));
    return departments.map((department) => ({
      ...department,
      hod: department.hodId ? byId.get(department.hodId) ?? null : null,
      _count: {
        ...department._count,
        classes: departmentClassCounts.get(department.id) ?? 0,
      },
    }));
  }

  async department(user: AuthPrincipal, id: string) {
    const department = await this.prisma.department.findFirst({
      where: { id, collegeId: user.collegeId },
      include: {
        campus: { select: { id: true, name: true } },
        programmes: { include: { semesters: { include: { academicYear: true, sections: { include: { _count: { select: { studentProfiles: true } } } } } } } },
        staffProfiles: { include: { user: { select: { publicId: true, fullName: true, status: true } } } },
        studentProfiles: { take: 100, include: { user: { select: { publicId: true, fullName: true, status: true } }, section: { select: { code: true, name: true } } } },
        _count: { select: { programmes: true, studentProfiles: true, staffProfiles: true, rooms: true, issues: { where: { status: { notIn: ["VERIFIED", "CLOSED", "REJECTED", "CANCELLED"] } } } } },
      },
    });
    if (!department) throw new NotFoundException("Department not found.");
    const hod = department.hodId ? await this.prisma.user.findFirst({ where: { id: department.hodId, collegeId: user.collegeId }, select: { publicId: true, fullName: true, status: true } }) : null;
    return { ...department, hod };
  }

  allProgrammes(user: AuthPrincipal, departmentId?: string) {
    return this.prisma.programme.findMany({
      where: { collegeId: user.collegeId, ...(departmentId ? { departmentId } : {}) },
      include: {
        department: { select: { id: true, name: true } },
        _count: { select: { semesters: true, studentProfiles: true } },
      },
      orderBy: { name: "asc" },
    });
  }

  allYears(user: AuthPrincipal) {
    return this.prisma.academicYear.findMany({
      where: { collegeId: user.collegeId },
      include: { _count: { select: { semesters: true, attendanceSessions: true } } },
      orderBy: { startsOn: "desc" },
    });
  }

  allSemesters(user: AuthPrincipal, programmeId?: string, academicYearId?: string) {
    return this.prisma.semester.findMany({
      where: {
        programme: { collegeId: user.collegeId },
        ...(programmeId ? { programmeId } : {}),
        ...(academicYearId ? { academicYearId } : {}),
      },
      include: {
        programme: { select: { id: true, name: true } },
        academicYear: { select: { id: true, name: true } },
        _count: { select: { sections: true, subjects: true } },
      },
      orderBy: [{ programme: { name: "asc" } }, { number: "asc" }],
    });
  }

  async allSections(user: AuthPrincipal, semesterId?: string) {
    const sections = await this.prisma.section.findMany({
      where: { semester: { programme: { collegeId: user.collegeId } }, ...(semesterId ? { semesterId } : {}) },
      include: {
        semester: {
          select: { id: true, name: true, programme: { select: { id: true, name: true } }, academicYear: { select: { id: true, name: true } } },
        },
        coordinatorAssignments: { where: { isActive: true }, take: 1, orderBy: { validFrom: "desc" }, include: { coordinator: { select: { publicId: true, fullName: true } } } },
        representativeAssignments: { where: { isActive: true }, take: 1, orderBy: { validFrom: "desc" }, include: { representative: { select: { publicId: true, fullName: true } } } },
        _count: { select: { studentProfiles: true, attendanceSessions: true } },
      },
      orderBy: { code: "asc" },
    });
    const roomIds = [...new Set(sections.flatMap((section) => section.assignedRoomId ? [section.assignedRoomId] : []))];
    const rooms = roomIds.length ? await this.prisma.room.findMany({ where: { id: { in: roomIds } }, select: { id: true, code: true, name: true, floor: { select: { name: true, block: { select: { name: true } } } } } }) : [];
    const byId = new Map(rooms.map((room) => [room.id, room]));
    return sections.map((section) => ({ ...section, assignedRoom: section.assignedRoomId ? byId.get(section.assignedRoomId) ?? null : null }));
  }

  async section(user: AuthPrincipal, id: string) {
    const section = await this.prisma.section.findFirst({
      where: { id, semester: { programme: { collegeId: user.collegeId } } },
      include: {
        semester: {
          select: { id: true, name: true, programme: { select: { id: true, name: true } }, academicYear: { select: { id: true, name: true } } },
        },
        coordinatorAssignments: { where: { isActive: true }, take: 1, orderBy: { validFrom: "desc" }, include: { coordinator: { select: { publicId: true, fullName: true } } } },
        representativeAssignments: { where: { isActive: true }, take: 1, orderBy: { validFrom: "desc" }, include: { representative: { select: { publicId: true, fullName: true } } } },
        _count: { select: { studentProfiles: true, attendanceSessions: true } },
      },
    });
    if (!section) throw new NotFoundException("Section not found.");
    return section;
  }

  allSubjects(user: AuthPrincipal, semesterId?: string) {
    return this.prisma.subject.findMany({
      where: { semester: { programme: { collegeId: user.collegeId } }, ...(semesterId ? { semesterId } : {}) },
      include: {
        semester: {
          select: { id: true, name: true, programme: { select: { id: true, name: true } } },
        },
        _count: { select: { facultyAssignments: true, attendanceSessions: true } },
      },
      orderBy: { code: "asc" },
    });
  }

  async assignments(user: AuthPrincipal) {
    const sectionCollege = { semester: { programme: { collegeId: user.collegeId } } };
    const [faculty, coordinators, representatives] = await Promise.all([
      this.prisma.facultySubjectAssignment.findMany({
        where: { section: sectionCollege },
        select: {
          id: true, validFrom: true, validUntil: true, isActive: true,
          faculty: { select: { publicId: true, collegeIdentityId: true, fullName: true } },
          subject: { select: { id: true, code: true, name: true, semesterId: true } },
          section: { select: { id: true, code: true, name: true, semesterId: true, semester: { select: { name: true, programme: { select: { name: true } } } } } },
        },
        orderBy: [{ isActive: "desc" }, { validFrom: "desc" }],
      }),
      this.prisma.classCoordinatorAssignment.findMany({
        where: { section: sectionCollege },
        select: {
          id: true, validFrom: true, validUntil: true, isActive: true,
          coordinator: { select: { publicId: true, collegeIdentityId: true, fullName: true } },
          section: { select: { id: true, code: true, name: true, semesterId: true, semester: { select: { name: true, programme: { select: { name: true } } } } } },
        },
        orderBy: [{ isActive: "desc" }, { validFrom: "desc" }],
      }),
      this.prisma.classRepresentativeAssignment.findMany({
        where: { section: sectionCollege },
        select: {
          id: true, validFrom: true, validUntil: true, isActive: true,
          representative: { select: { publicId: true, collegeIdentityId: true, fullName: true } },
          section: { select: { id: true, code: true, name: true, semesterId: true, semester: { select: { name: true, programme: { select: { name: true } } } } } },
        },
        orderBy: [{ isActive: "desc" }, { validFrom: "desc" }],
      }),
    ]);
    return { faculty, coordinators, representatives };
  }

  async assignmentOptions(user: AuthPrincipal) {
    const now = new Date();
    const roleCodes = ["HOD", "FACULTY", "CLASS_COORDINATOR", "CLASS_REPRESENTATIVE"];
    const activeRole = {
      validFrom: { lte: now },
      OR: [{ validUntil: null }, { validUntil: { gte: now } }],
      role: { code: { in: roleCodes }, isActive: true, OR: [{ collegeId: null }, { collegeId: user.collegeId }] },
    };
    const activeSemester = {
      isActive: true,
      programme: { collegeId: user.collegeId, isActive: true },
      academicYear: { collegeId: user.collegeId, isActive: true },
    };
    const [users, sections, subjects] = await Promise.all([
      this.prisma.user.findMany({
        where: {
          collegeId: user.collegeId,
          status: "ACTIVE",
          archivedAt: null,
          OR: [
            { roles: { some: activeRole } },
            { staffProfile: { isNot: null } },
          ],
        },
        select: {
          publicId: true, collegeIdentityId: true, fullName: true,
          roles: { where: activeRole, select: { role: { select: { code: true, name: true } } } },
        },
        orderBy: { fullName: "asc" },
      }),
      this.prisma.section.findMany({
        where: { isActive: true, semester: activeSemester },
        select: { id: true, code: true, name: true, semesterId: true, semester: { select: { name: true, programme: { select: { name: true } }, academicYear: { select: { name: true, startsOn: true, endsOn: true } } } } },
        orderBy: [{ semester: { programme: { name: "asc" } } }, { code: "asc" }],
      }),
      this.prisma.subject.findMany({
        where: { isActive: true, semester: activeSemester },
        select: { id: true, code: true, name: true, semesterId: true, semester: { select: { name: true, programme: { select: { name: true } } } } },
        orderBy: [{ semester: { programme: { name: "asc" } } }, { code: "asc" }],
      }),
    ]);
    return { users, sections, subjects };
  }

  /* ─── CREATE ─── */

  async createDepartment(user: AuthPrincipal, input: CreateDepartmentDto, requestId: string) {
    const campus = await this.prisma.campus.findFirst({ where: { id: input.campusId, collegeId: user.collegeId, isActive: true } });
    if (!campus) throw new BadRequestException("The selected campus is not active.");
    await this.assertDepartmentUnique(user.collegeId, input.code, input.name);
    const hodId = input.hodPublicId ? await this.resolveHod(user, input.hodPublicId) : null;
    const department = await this.prisma.department.create({
      data: {
        collegeId: user.collegeId,
        campusId: input.campusId,
        code: input.code.trim().toUpperCase(),
        name: input.name.trim(),
        shortName: input.shortName?.trim(),
        description: input.description?.trim(),
        hodId,
        officialEmail: input.officialEmail?.trim().toLowerCase(),
        contactNumber: input.contactNumber?.trim(),
        location: input.location?.trim(),
        sortOrder: input.sortOrder ?? 0,
        createdById: user.id,
        updatedById: user.id,
      },
    });
    await this.audit.record({ actorId: user.id, action: "department.created", entityType: "Department", entityId: department.id, afterValue: { code: department.code, name: department.name, campusId: department.campusId }, requestId });
    await this.officialGroups.synchronizeDepartment(user.collegeId, department.id);
    return department;
  }

  async createProgramme(user: AuthPrincipal, input: CreateProgrammeDto, requestId: string) {
    const department = await this.prisma.department.findFirst({ where: { id: input.departmentId, collegeId: user.collegeId, isActive: true } });
    if (!department) throw new BadRequestException("The selected department is not active.");
    const programme = await this.prisma.programme.create({
      data: {
        collegeId: user.collegeId,
        departmentId: input.departmentId,
        code: input.code.trim().toUpperCase(),
        name: input.name.trim(),
        degreeType: input.degreeType?.trim(),
        durationYears: input.durationYears,
      },
    });
    await this.audit.record({ actorId: user.id, action: "programme.created", entityType: "Programme", entityId: programme.id, afterValue: { code: programme.code, name: programme.name, departmentId: programme.departmentId }, requestId });
    return programme;
  }

  async createAcademicYear(user: AuthPrincipal, input: CreateAcademicYearDto, requestId: string) {
    const startsOn = new Date(input.startsOn);
    const endsOn = new Date(input.endsOn);
    if (isNaN(startsOn.getTime()) || isNaN(endsOn.getTime())) throw new BadRequestException("Invalid date format.");
    if (endsOn <= startsOn) throw new BadRequestException("End date must be after start date.");
    return this.prisma.$transaction(async (tx) => {
      if (input.isCurrent) {
        await tx.academicYear.updateMany({ where: { collegeId: user.collegeId, isCurrent: true }, data: { isCurrent: false } });
      }
      const year = await tx.academicYear.create({
        data: { collegeId: user.collegeId, name: input.name.trim(), startsOn, endsOn, isCurrent: input.isCurrent ?? false },
      });
      await this.audit.record({ actorId: user.id, action: "academic_year.created", entityType: "AcademicYear", entityId: year.id, afterValue: { name: year.name, startsOn: year.startsOn, endsOn: year.endsOn, isCurrent: year.isCurrent }, requestId }, tx);
      return year;
    });
  }

  async createSemester(user: AuthPrincipal, input: CreateSemesterDto, requestId: string) {
    const programme = await this.prisma.programme.findFirst({ where: { id: input.programmeId, collegeId: user.collegeId, isActive: true } });
    if (!programme) throw new BadRequestException("The selected programme is not active.");
    const academicYear = await this.prisma.academicYear.findFirst({ where: { id: input.academicYearId, collegeId: user.collegeId, isActive: true } });
    if (!academicYear) throw new BadRequestException("The selected academic year is not active.");
    const semester = await this.prisma.semester.create({
      data: { programmeId: input.programmeId, academicYearId: input.academicYearId, number: input.number, name: input.name.trim() },
    });
    await this.audit.record({ actorId: user.id, action: "semester.created", entityType: "Semester", entityId: semester.id, afterValue: { programmeId: semester.programmeId, number: semester.number, name: semester.name }, requestId });
    return semester;
  }

  async createSection(user: AuthPrincipal, input: CreateSectionDto, requestId: string) {
    const semester = await this.prisma.semester.findFirst({ where: { id: input.semesterId, programme: { collegeId: user.collegeId }, isActive: true } });
    if (!semester) throw new BadRequestException("The selected semester is not active.");
    if (input.assignedRoomId) await this.requireRoom(user.collegeId, input.assignedRoomId);
    const section = await this.prisma.section.create({
      data: {
        semesterId: input.semesterId,
        code: input.code.trim().toUpperCase(),
        name: input.name.trim(),
        studyYear: input.studyYear,
        displayName: input.displayName?.trim(),
        assignedRoomId: input.assignedRoomId,
        officialGroupEnabled: input.officialGroupEnabled ?? true,
        capacity: input.capacity,
      },
    });
    await this.audit.record({ actorId: user.id, action: "section.created", entityType: "Section", entityId: section.id, afterValue: { semesterId: section.semesterId, code: section.code, name: section.name }, requestId });
    if (input.coordinatorPublicId) {
      await this.createCoordinatorAssignment(user, { coordinatorPublicId: input.coordinatorPublicId, sectionId: section.id, validFrom: new Date().toISOString() }, requestId);
    }
    if (input.representativePublicId) {
      await this.createRepresentativeAssignment(user, { representativePublicId: input.representativePublicId, sectionId: section.id, validFrom: new Date().toISOString() }, requestId);
    }
    if (section.officialGroupEnabled) await this.officialGroups.synchronizeSection(user.collegeId, section.id);
    return section;
  }

  async createSubject(user: AuthPrincipal, input: CreateSubjectDto, requestId: string) {
    const semester = await this.prisma.semester.findFirst({ where: { id: input.semesterId, programme: { collegeId: user.collegeId }, isActive: true } });
    if (!semester) throw new BadRequestException("The selected semester is not active.");
    const subject = await this.prisma.subject.create({
      data: { semesterId: input.semesterId, code: input.code.trim().toUpperCase(), name: input.name.trim() },
    });
    await this.audit.record({ actorId: user.id, action: "subject.created", entityType: "Subject", entityId: subject.id, afterValue: { semesterId: subject.semesterId, code: subject.code, name: subject.name }, requestId });
    return subject;
  }

  /* ─── UPDATE ─── */

  async createFacultyAssignment(user: AuthPrincipal, input: CreateFacultySubjectAssignmentDto, requestId: string) {
    const { validFrom, validUntil } = this.assignmentPeriod(input.validFrom, input.validUntil);
    const created = await this.prisma.$transaction(async (tx) => {
      const faculty = await this.assignmentUser(tx, user, input.facultyPublicId, "FACULTY", "faculty member");
      const section = await this.activeAssignmentSection(tx, user, input.sectionId);
      const subject = await this.activeAssignmentSubject(tx, user, input.subjectId);
      if (section.semesterId !== subject.semesterId) throw new BadRequestException("The subject and section must belong to the same semester.");
      this.assertPeriodWithinAcademicYear(validFrom, validUntil, section.semester.academicYear.startsOn, section.semester.academicYear.endsOn);
      const conflict = await tx.facultySubjectAssignment.findFirst({
        where: {
          facultyId: faculty.id, subjectId: subject.id, sectionId: section.id, isActive: true,
          ...(validUntil ? { validFrom: { lte: validUntil } } : {}),
          OR: [{ validUntil: null }, { validUntil: { gte: validFrom } }],
        },
        select: { id: true },
      });
      if (conflict) throw new ConflictException("This faculty member already has an overlapping assignment for the subject and section.");
      const assignment = await tx.facultySubjectAssignment.create({
        data: { facultyId: faculty.id, subjectId: subject.id, sectionId: section.id, validFrom, validUntil },
      });
      await this.audit.record({
        actorId: user.id, action: "faculty_subject_assignment.created", entityType: "FacultySubjectAssignment", entityId: assignment.id,
        afterValue: { facultyId: faculty.id, subjectId: subject.id, sectionId: section.id, validFrom, validUntil }, requestId,
      }, tx);
      return assignment;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    await this.officialGroups.synchronizeSection(user.collegeId, input.sectionId);
    return created;
  }

  async createCoordinatorAssignment(user: AuthPrincipal, input: CreateClassCoordinatorAssignmentDto, requestId: string) {
    const { validFrom, validUntil } = this.assignmentPeriod(input.validFrom, input.validUntil);
    const created = await this.prisma.$transaction(async (tx) => {
      const coordinator = await this.assignmentUser(tx, user, input.coordinatorPublicId, "CLASS_COORDINATOR", "class coordinator");
      const section = await this.activeAssignmentSection(tx, user, input.sectionId);
      this.assertPeriodWithinAcademicYear(validFrom, validUntil, section.semester.academicYear.startsOn, section.semester.academicYear.endsOn);
      const conflict = await tx.classCoordinatorAssignment.findFirst({
        where: {
          sectionId: section.id, isActive: true,
          ...(validUntil ? { validFrom: { lte: validUntil } } : {}),
          OR: [{ validUntil: null }, { validUntil: { gte: validFrom } }],
        },
        select: { id: true },
      });
      if (conflict) throw new ConflictException("This section already has a class coordinator during the selected dates.");
      const assignment = await tx.classCoordinatorAssignment.create({
        data: { coordinatorId: coordinator.id, sectionId: section.id, validFrom, validUntil },
      });
      await this.audit.record({
        actorId: user.id, action: "class_coordinator_assignment.created", entityType: "ClassCoordinatorAssignment", entityId: assignment.id,
        afterValue: { coordinatorId: coordinator.id, sectionId: section.id, validFrom, validUntil }, requestId,
      }, tx);
      return assignment;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    await this.officialGroups.synchronizeSection(user.collegeId, input.sectionId);
    return created;
  }

  async createRepresentativeAssignment(user: AuthPrincipal, input: CreateClassRepresentativeAssignmentDto, requestId: string) {
    const { validFrom, validUntil } = this.assignmentPeriod(input.validFrom, input.validUntil);
    const created = await this.prisma.$transaction(async (tx) => {
      const representative = await this.assignmentUser(tx, user, input.representativePublicId, "CLASS_REPRESENTATIVE", "class representative");
      const section = await this.activeAssignmentSection(tx, user, input.sectionId);
      this.assertPeriodWithinAcademicYear(validFrom, validUntil, section.semester.academicYear.startsOn, section.semester.academicYear.endsOn);
      const conflict = await tx.classRepresentativeAssignment.findFirst({
        where: {
          sectionId: section.id, isActive: true,
          ...(validUntil ? { validFrom: { lte: validUntil } } : {}),
          OR: [{ validUntil: null }, { validUntil: { gte: validFrom } }],
        },
        select: { id: true },
      });
      if (conflict) throw new ConflictException("This section already has a class representative during the selected dates.");
      const assignment = await tx.classRepresentativeAssignment.create({
        data: { representativeId: representative.id, sectionId: section.id, validFrom, validUntil },
      });
      await this.audit.record({
        actorId: user.id, action: "class_representative_assignment.created", entityType: "ClassRepresentativeAssignment", entityId: assignment.id,
        afterValue: { representativeId: representative.id, sectionId: section.id, validFrom, validUntil }, requestId,
      }, tx);
      return assignment;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    await this.officialGroups.synchronizeSection(user.collegeId, input.sectionId);
    return created;
  }

  async updateDepartment(user: AuthPrincipal, id: string, input: UpdateDepartmentDto, requestId: string) {
    const existing = await this.prisma.department.findFirst({ where: { id, collegeId: user.collegeId } });
    if (!existing) throw new NotFoundException("Department not found.");
    if (input.code !== undefined || input.name !== undefined) {
      await this.assertDepartmentUnique(user.collegeId, input.code ?? existing.code, input.name ?? existing.name, id);
    }
    const hodId = input.hodPublicId === undefined ? undefined : input.hodPublicId ? await this.resolveHod(user, input.hodPublicId) : null;
    const department = await this.prisma.department.update({
      where: { id },
      data: {
        ...(input.code !== undefined ? { code: input.code.trim().toUpperCase() } : {}),
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.shortName !== undefined ? { shortName: input.shortName?.trim() || null } : {}),
        ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
        ...(hodId !== undefined ? { hodId } : {}),
        ...(input.officialEmail !== undefined ? { officialEmail: input.officialEmail?.trim().toLowerCase() || null } : {}),
        ...(input.contactNumber !== undefined ? { contactNumber: input.contactNumber?.trim() || null } : {}),
        ...(input.location !== undefined ? { location: input.location?.trim() || null } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        updatedById: user.id,
      },
    });
    await this.audit.record({ actorId: user.id, action: "department.updated", entityType: "Department", entityId: id, beforeValue: existing, afterValue: department, requestId });
    if (department.isActive && !department.archivedAt) await this.officialGroups.synchronizeDepartment(user.collegeId, department.id);
    return department;
  }

  async updateProgramme(user: AuthPrincipal, id: string, input: UpdateProgrammeDto, requestId: string) {
    const existing = await this.prisma.programme.findFirst({ where: { id, collegeId: user.collegeId } });
    if (!existing) throw new NotFoundException("Programme not found.");
    const programme = await this.prisma.programme.update({
      where: { id },
      data: { ...(input.name !== undefined ? { name: input.name.trim() } : {}), ...(input.degreeType !== undefined ? { degreeType: input.degreeType?.trim() || null } : {}), ...(input.durationYears !== undefined ? { durationYears: input.durationYears } : {}), ...(input.isActive !== undefined ? { isActive: input.isActive } : {}) },
    });
    await this.audit.record({ actorId: user.id, action: "programme.updated", entityType: "Programme", entityId: id, beforeValue: { name: existing.name, isActive: existing.isActive }, afterValue: { name: programme.name, isActive: programme.isActive }, requestId });
    return programme;
  }

  async updateSection(user: AuthPrincipal, id: string, input: UpdateSectionDto, requestId: string) {
    const existing = await this.prisma.section.findFirst({ where: { id, semester: { programme: { collegeId: user.collegeId } } } });
    if (!existing) throw new NotFoundException("Section not found.");
    if (input.assignedRoomId) await this.requireRoom(user.collegeId, input.assignedRoomId);
    const section = await this.prisma.section.update({
      where: { id },
      data: {
        ...(input.code !== undefined ? { code: input.code.trim().toUpperCase() } : {}),
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.studyYear !== undefined ? { studyYear: input.studyYear } : {}),
        ...(input.displayName !== undefined ? { displayName: input.displayName?.trim() || null } : {}),
        ...(input.assignedRoomId !== undefined ? { assignedRoomId: input.assignedRoomId } : {}),
        ...(input.officialGroupEnabled !== undefined ? { officialGroupEnabled: input.officialGroupEnabled } : {}),
        ...(input.capacity !== undefined ? { capacity: input.capacity } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    });
    await this.audit.record({ actorId: user.id, action: "section.updated", entityType: "Section", entityId: id, beforeValue: existing, afterValue: section, requestId });
    if (input.coordinatorPublicId !== undefined) {
      if (input.coordinatorPublicId) {
        await this.createCoordinatorAssignment(user, { coordinatorPublicId: input.coordinatorPublicId, sectionId: section.id, validFrom: new Date().toISOString() }, requestId);
      }
    }
    if (input.representativePublicId !== undefined) {
      if (input.representativePublicId) {
        await this.createRepresentativeAssignment(user, { representativePublicId: input.representativePublicId, sectionId: section.id, validFrom: new Date().toISOString() }, requestId);
      }
    }
    if (section.isActive && section.officialGroupEnabled) await this.officialGroups.synchronizeSection(user.collegeId, id);
    else await this.officialGroups.archiveLinkedGroup(user.collegeId, "section", id);
    return section;
  }

  async archiveDepartment(user: AuthPrincipal, id: string, reason: string | undefined, requestId: string) {
    const existing = await this.prisma.department.findFirst({ where: { id, collegeId: user.collegeId } });
    if (!existing) throw new NotFoundException("Department not found.");
    if (existing.archivedAt) return existing;
    const archived = await this.prisma.department.update({ where: { id }, data: { isActive: false, archivedAt: new Date(), updatedById: user.id } });
    await this.audit.record({ actorId: user.id, action: "department.archived", entityType: "Department", entityId: id, beforeValue: existing, afterValue: archived, reason: reason?.trim() ?? "Archived by administrator", requestId });
    await this.officialGroups.archiveLinkedGroup(user.collegeId, "department", id);
    return archived;
  }

  async restoreDepartment(user: AuthPrincipal, id: string, requestId: string) {
    const existing = await this.prisma.department.findFirst({ where: { id, collegeId: user.collegeId } });
    if (!existing) throw new NotFoundException("Department not found.");
    const restored = await this.prisma.department.update({ where: { id }, data: { isActive: true, archivedAt: null, updatedById: user.id } });
    await this.audit.record({ actorId: user.id, action: "department.restored", entityType: "Department", entityId: id, beforeValue: existing, afterValue: restored, requestId });
    await this.officialGroups.synchronizeDepartment(user.collegeId, id);
    return restored;
  }

  async deleteDepartment(user: AuthPrincipal, id: string, requestId: string) {
    const existing = await this.prisma.department.findFirst({
      where: { id, collegeId: user.collegeId },
      include: {
        _count: {
          select: { programmes: true, studentProfiles: true, staffProfiles: true, rooms: true, issues: true },
        },
      },
    });
    if (!existing) throw new NotFoundException("Department not found.");
    const totalDependent =
      existing._count.programmes +
      existing._count.studentProfiles +
      existing._count.staffProfiles +
      existing._count.rooms +
      existing._count.issues;
    if (totalDependent > 0) {
      throw new BadRequestException("A department cannot be permanently deleted when valid classes, students, staff or attendance records depend on it. Use archive or deactivate by default.");
    }
    await this.prisma.department.delete({ where: { id } });
    await this.audit.record({
      actorId: user.id,
      action: "department.deleted",
      entityType: "Department",
      entityId: id,
      beforeValue: existing,
      requestId,
    });
    return { deleted: true };
  }

  async deactivateFacultyAssignment(user: AuthPrincipal, id: string, input: DeactivateAcademicAssignmentDto, requestId: string) {
    const effectiveOn = this.assignmentDate(input.effectiveOn, "effective date");
    const updated = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.facultySubjectAssignment.findFirst({
        where: { id, section: { semester: { programme: { collegeId: user.collegeId } } } },
      });
      if (!existing) throw new NotFoundException("Faculty assignment not found.");
      this.assertCanDeactivate(existing.validFrom, existing.validUntil, existing.isActive, effectiveOn);
      const assignment = await tx.facultySubjectAssignment.update({ where: { id }, data: { isActive: false, validUntil: effectiveOn } });
      await this.audit.record({
        actorId: user.id, action: "faculty_subject_assignment.deactivated", entityType: "FacultySubjectAssignment", entityId: id,
        beforeValue: { isActive: existing.isActive, validUntil: existing.validUntil }, afterValue: { isActive: false, validUntil: effectiveOn }, reason: input.reason.trim(), requestId,
      }, tx);
      return assignment;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    await this.officialGroups.synchronizeSection(user.collegeId, updated.sectionId);
    return updated;
  }

  async deactivateCoordinatorAssignment(user: AuthPrincipal, id: string, input: DeactivateAcademicAssignmentDto, requestId: string) {
    const effectiveOn = this.assignmentDate(input.effectiveOn, "effective date");
    const updated = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.classCoordinatorAssignment.findFirst({
        where: { id, section: { semester: { programme: { collegeId: user.collegeId } } } },
      });
      if (!existing) throw new NotFoundException("Class coordinator assignment not found.");
      this.assertCanDeactivate(existing.validFrom, existing.validUntil, existing.isActive, effectiveOn);
      const assignment = await tx.classCoordinatorAssignment.update({ where: { id }, data: { isActive: false, validUntil: effectiveOn } });
      await this.audit.record({
        actorId: user.id, action: "class_coordinator_assignment.deactivated", entityType: "ClassCoordinatorAssignment", entityId: id,
        beforeValue: { isActive: existing.isActive, validUntil: existing.validUntil }, afterValue: { isActive: false, validUntil: effectiveOn }, reason: input.reason.trim(), requestId,
      }, tx);
      return assignment;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    await this.officialGroups.synchronizeSection(user.collegeId, updated.sectionId);
    return updated;
  }

  async deactivateRepresentativeAssignment(user: AuthPrincipal, id: string, input: DeactivateAcademicAssignmentDto, requestId: string) {
    const effectiveOn = this.assignmentDate(input.effectiveOn, "effective date");
    const updated = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.classRepresentativeAssignment.findFirst({
        where: { id, section: { semester: { programme: { collegeId: user.collegeId } } } },
      });
      if (!existing) throw new NotFoundException("Class representative assignment not found.");
      this.assertCanDeactivate(existing.validFrom, existing.validUntil, existing.isActive, effectiveOn);
      const assignment = await tx.classRepresentativeAssignment.update({ where: { id }, data: { isActive: false, validUntil: effectiveOn } });
      await this.audit.record({
        actorId: user.id, action: "class_representative_assignment.deactivated", entityType: "ClassRepresentativeAssignment", entityId: id,
        beforeValue: { isActive: existing.isActive, validUntil: existing.validUntil }, afterValue: { isActive: false, validUntil: effectiveOn }, reason: input.reason.trim(), requestId,
      }, tx);
      return assignment;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    await this.officialGroups.synchronizeSection(user.collegeId, updated.sectionId);
    return updated;
  }

  async updateEntityStatus(user: AuthPrincipal, entityType: string, id: string, input: UpdateEntityStatusDto, requestId: string) {
    const actions: Record<string, () => Promise<unknown>> = {
      department: async () => {
        const existing = await this.prisma.department.findFirst({ where: { id, collegeId: user.collegeId } });
        if (!existing) throw new NotFoundException("Department not found.");
        if (input.isActive && existing.hodId) {
          const hod = await this.prisma.user.findFirst({ where: { id: existing.hodId, collegeId: user.collegeId, status: "ACTIVE" } });
          if (!hod) throw new BadRequestException("Cannot activate department: Assigned HOD is not an active user.");
        }
        const updated = await this.prisma.department.update({ where: { id }, data: { isActive: input.isActive } });
        await this.audit.record({ actorId: user.id, action: "department.updated", entityType: "Department", entityId: id, beforeValue: { isActive: existing.isActive }, afterValue: { isActive: updated.isActive }, requestId });
        return updated;
      },
      programme: async () => {
        const existing = await this.prisma.programme.findFirst({ where: { id, collegeId: user.collegeId } });
        if (!existing) throw new NotFoundException("Programme not found.");
        const updated = await this.prisma.programme.update({ where: { id }, data: { isActive: input.isActive } });
        await this.audit.record({ actorId: user.id, action: "programme.updated", entityType: "Programme", entityId: id, beforeValue: { isActive: existing.isActive }, afterValue: { isActive: updated.isActive }, requestId });
        return updated;
      },
      semester: async () => {
        const existing = await this.prisma.semester.findFirst({ where: { id, programme: { collegeId: user.collegeId } } });
        if (!existing) throw new NotFoundException("Semester not found.");
        const updated = await this.prisma.semester.update({ where: { id }, data: { isActive: input.isActive } });
        await this.audit.record({ actorId: user.id, action: "semester.updated", entityType: "Semester", entityId: id, beforeValue: { isActive: existing.isActive }, afterValue: { isActive: updated.isActive }, requestId });
        return updated;
      },
      section: async () => {
        const existing = await this.prisma.section.findFirst({ where: { id, semester: { programme: { collegeId: user.collegeId } } } });
        if (!existing) throw new NotFoundException("Section not found.");
        const updated = await this.prisma.section.update({ where: { id }, data: { isActive: input.isActive } });
        await this.audit.record({ actorId: user.id, action: "section.updated", entityType: "Section", entityId: id, beforeValue: { isActive: existing.isActive }, afterValue: { isActive: updated.isActive }, requestId });
        return updated;
      },
      subject: async () => {
        const existing = await this.prisma.subject.findFirst({ where: { id, semester: { programme: { collegeId: user.collegeId } } } });
        if (!existing) throw new NotFoundException("Subject not found.");
        const updated = await this.prisma.subject.update({ where: { id }, data: { isActive: input.isActive } });
        await this.audit.record({ actorId: user.id, action: "subject.updated", entityType: "Subject", entityId: id, beforeValue: { isActive: existing.isActive }, afterValue: { isActive: updated.isActive }, requestId });
        return updated;
      },
      academicYear: async () => {
        const existing = await this.prisma.academicYear.findFirst({ where: { id, collegeId: user.collegeId } });
        if (!existing) throw new NotFoundException("Academic year not found.");
        const updated = await this.prisma.academicYear.update({ where: { id }, data: { isActive: input.isActive } });
        await this.audit.record({ actorId: user.id, action: "academic_year.updated", entityType: "AcademicYear", entityId: id, beforeValue: { isActive: existing.isActive }, afterValue: { isActive: updated.isActive }, requestId });
        return updated;
      },
    };
    const handler = actions[entityType];
    if (!handler) throw new BadRequestException(`Unknown entity type: ${entityType}`);
    const result = await handler();
    if (entityType === "section") {
      if (input.isActive) await this.officialGroups.synchronizeSection(user.collegeId, id);
      else await this.officialGroups.archiveLinkedGroup(user.collegeId, "section", id);
    } else if (entityType === "department") {
      if (input.isActive) await this.officialGroups.synchronizeDepartment(user.collegeId, id);
      else await this.officialGroups.archiveLinkedGroup(user.collegeId, "department", id);
    }
    return result;
  }

  private async assertDepartmentUnique(collegeId: string, rawCode: string, rawName: string, exceptId?: string) {
    const duplicate = await this.prisma.department.findFirst({
      where: {
        collegeId,
        ...(exceptId ? { id: { not: exceptId } } : {}),
        OR: [
          { code: rawCode.trim().toUpperCase() },
          { name: { equals: rawName.trim(), mode: "insensitive" } },
        ],
      },
      select: { code: true, name: true },
    });
    if (duplicate) {
      throw new ConflictException(duplicate.code === rawCode.trim().toUpperCase() ? "Department code already exists." : "Department name already exists in this college.");
    }
  }

  private async resolveHod(user: AuthPrincipal, publicId: string): Promise<string> {
    const now = new Date();
    const hod = await this.prisma.user.findFirst({
      where: {
        publicId,
        collegeId: user.collegeId,
        status: "ACTIVE",
        archivedAt: null,
        OR: [
          { staffProfile: { isNot: null } },
          { roles: { some: { validFrom: { lte: now }, OR: [{ validUntil: null }, { validUntil: { gt: now } }], role: { code: "HOD", isActive: true } } } },
        ],
      },
      select: { id: true },
    });
    if (!hod) throw new BadRequestException("The selected HOD must be an active authorized staff account.");
    return hod.id;
  }

  private async requireRoom(collegeId: string, roomId: string): Promise<void> {
    const room = await this.prisma.room.findFirst({ where: { id: roomId, isActive: true, floor: { block: { campus: { collegeId } } } }, select: { id: true } });
    if (!room) throw new BadRequestException("The assigned classroom is not an active room in this college.");
  }

  private assignmentPeriod(validFromInput: string, validUntilInput?: string) {
    const validFrom = this.assignmentDate(validFromInput, "start date");
    const validUntil = validUntilInput ? this.assignmentDate(validUntilInput, "end date") : undefined;
    if (validUntil && validUntil < validFrom) throw new BadRequestException("The assignment end date cannot be before its start date.");
    return { validFrom, validUntil };
  }

  private assignmentDate(input: string, label: string) {
    const parsed = new Date(input);
    if (Number.isNaN(parsed.getTime())) throw new BadRequestException(`The assignment ${label} is invalid.`);
    return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()));
  }

  private assertPeriodWithinAcademicYear(validFrom: Date, validUntil: Date | undefined, startsOn: Date, endsOn: Date) {
    if (validFrom < startsOn || validFrom > endsOn || (validUntil && validUntil > endsOn)) {
      throw new BadRequestException("Assignment dates must fall within the section's academic year.");
    }
  }

  private assertCanDeactivate(validFrom: Date, validUntil: Date | null, isActive: boolean, effectiveOn: Date) {
    if (!isActive) throw new ConflictException("This assignment is already inactive.");
    if (effectiveOn < validFrom) throw new BadRequestException("The deactivation date cannot be before the assignment start date.");
    if (validUntil && effectiveOn > validUntil) throw new BadRequestException("The deactivation date cannot be after the assignment end date.");
  }

  private async assignmentUser(tx: Prisma.TransactionClient, actor: AuthPrincipal, publicId: string, roleCode: string, label: string) {
    const now = new Date();
    const user = await tx.user.findFirst({
      where: {
        publicId, collegeId: actor.collegeId, status: "ACTIVE", archivedAt: null,
        OR: [
          {
            roles: { some: {
              validFrom: { lte: now }, OR: [{ validUntil: null }, { validUntil: { gte: now } }],
              role: { code: roleCode, isActive: true, OR: [{ collegeId: null }, { collegeId: actor.collegeId }] },
            } },
          },
          { staffProfile: { isNot: null } },
        ],
      },
      select: { id: true, publicId: true, fullName: true },
    });
    if (!user) throw new BadRequestException(`The selected ${label} must be an active authorized staff account.`);
    return user;
  }

  private async activeAssignmentSection(tx: Prisma.TransactionClient, actor: AuthPrincipal, sectionId: string) {
    const section = await tx.section.findFirst({
      where: {
        id: sectionId, isActive: true,
        semester: { isActive: true, programme: { collegeId: actor.collegeId, isActive: true }, academicYear: { collegeId: actor.collegeId, isActive: true } },
      },
      select: { id: true, semesterId: true, semester: { select: { academicYear: { select: { startsOn: true, endsOn: true } } } } },
    });
    if (!section) throw new BadRequestException("The selected section and its academic parents must be active.");
    return section;
  }

  private async activeAssignmentSubject(tx: Prisma.TransactionClient, actor: AuthPrincipal, subjectId: string) {
    const subject = await tx.subject.findFirst({
      where: {
        id: subjectId, isActive: true,
        semester: { isActive: true, programme: { collegeId: actor.collegeId, isActive: true }, academicYear: { collegeId: actor.collegeId, isActive: true } },
      },
      select: { id: true, semesterId: true },
    });
    if (!subject) throw new BadRequestException("The selected subject and its academic parents must be active.");
    return subject;
  }
}
