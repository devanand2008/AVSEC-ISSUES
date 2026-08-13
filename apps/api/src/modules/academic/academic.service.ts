import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { AuthPrincipal } from "../../common/http/request-context";
import { PrismaService } from "../../database/prisma.service";
import { Prisma } from "../../generated/prisma/client";
import { AuditService } from "../audit/audit.service";
import type {
  CreateClassCoordinatorAssignmentDto,
  CreateClassRepresentativeAssignmentDto,
  CreateClassStaffAssignmentDto,
  AssignSectionStudentDto,
  CreateDepartmentDto,
  CreateDegreeTypeDto,
  UpdateDegreeTypeDto,
  CreateFacultySubjectAssignmentDto,
  UpdateDepartmentDto,
  CreateProgrammeDto,
  UpdateProgrammeDto,
  CreateAcademicYearDto,
  UpdateAcademicYearDto,
  CreateSemesterDto,
  CreateSectionDto,
  CreateSubjectDto,
  DeactivateAcademicAssignmentDto,
  UpdateEntityStatusDto,
  UpdateSectionDto,
} from "./dto/academic.dto";
import { OfficialGroupsService } from "../conversations/official-groups.service";
import { SectionPlacementService } from "./section-placement.service";

@Injectable()
export class AcademicService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly officialGroups: OfficialGroupsService,
    private readonly placements: SectionPlacementService,
  ) {}

  /* ─── READ (existing, preserved) ─── */

  degreeTypes(user: AuthPrincipal) {
    return this.prisma.degreeType.findMany({
      where: { collegeId: user.collegeId, isActive: true, archivedAt: null },
      select: { id: true, code: true, name: true, description: true, isActive: true, sortOrder: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
  }

  allDegreeTypes(user: AuthPrincipal) {
    return this.prisma.degreeType.findMany({
      where: { collegeId: user.collegeId },
      include: { _count: { select: { programmes: true } } },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
  }

  departments(user: AuthPrincipal, degreeTypeId?: string) {
    return this.prisma.department.findMany({
      where: {
        collegeId: user.collegeId,
        isActive: true,
        archivedAt: null,
        ...(degreeTypeId
          ? { programmes: { some: { degreeTypeId, isActive: true, archivedAt: null } } }
          : {}),
      },
      select: { id: true, code: true, name: true, campusId: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
  }

  programmes(user: AuthPrincipal, departmentId?: string, degreeTypeId?: string) {
    return this.prisma.programme.findMany({
      where: {
        collegeId: user.collegeId,
        isActive: true,
        archivedAt: null,
        department: {
          collegeId: user.collegeId,
          isActive: true,
          archivedAt: null,
        },
        ...(departmentId ? { departmentId } : {}),
        ...(degreeTypeId ? { degreeTypeId } : {}),
      },
      select: {
        id: true,
        code: true,
        name: true,
        departmentId: true,
        degreeTypeId: true,
        degreeTypeMaster: { select: { id: true, code: true, name: true } },
        durationYears: true,
        totalSemesters: true,
      },
      orderBy: { name: "asc" },
    });
  }

  years(user: AuthPrincipal) {
    return this.prisma.academicYear.findMany({
      where: { collegeId: user.collegeId, isActive: true, archivedAt: null },
      select: {
        id: true,
        name: true,
        startsOn: true,
        endsOn: true,
        isCurrent: true,
        isActive: true,
        archivedAt: true,
      },
      orderBy: { startsOn: "desc" },
    });
  }

  semesters(
    user: AuthPrincipal,
    programmeId?: string,
    academicYearId?: string,
    studyYear?: number,
  ) {
    return this.prisma.semester.findMany({
      where: {
        programme: {
          collegeId: user.collegeId,
          isActive: true,
          archivedAt: null,
          department: { isActive: true, archivedAt: null },
        },
        academicYear: { collegeId: user.collegeId, isActive: true, archivedAt: null },
        isActive: true,
        ...(programmeId ? { programmeId } : {}),
        ...(academicYearId ? { academicYearId } : {}),
        ...(studyYear
          ? { number: { in: [studyYear * 2 - 1, studyYear * 2] } }
          : {}),
      },
      select: {
        id: true,
        number: true,
        name: true,
        programmeId: true,
        academicYearId: true,
        programme: { select: { totalSemesters: true } },
      },
      orderBy: { number: "asc" },
    });
  }

  async sections(
    user: AuthPrincipal,
    filters: {
      semesterId?: string;
      programmeId?: string;
      academicYearId?: string;
      studyYear?: number;
    } = {},
  ) {
    const sections = await this.prisma.section.findMany({
      where: {
        archivedAt: null,
        isActive: true,
        ...(filters.semesterId ? { semesterId: filters.semesterId } : {}),
        ...(filters.studyYear ? { OR: [{ studyYear: filters.studyYear }, { studyYear: null }] } : {}),
        semester: {
          isActive: true,
          ...(filters.studyYear ? { number: { in: [filters.studyYear * 2 - 1, filters.studyYear * 2] } } : {}),
          academicYear: {
            collegeId: user.collegeId,
            isActive: true,
            archivedAt: null,
            ...(filters.academicYearId ? { id: filters.academicYearId } : {}),
          },
          programme: {
            collegeId: user.collegeId,
            isActive: true,
            archivedAt: null,
            ...(filters.programmeId ? { id: filters.programmeId } : {}),
            department: { isActive: true, archivedAt: null },
          },
        },
      },
      select: {
        id: true,
        code: true,
        name: true,
        semesterId: true,
        capacity: true,
        studyYear: true,
        semester: { select: { number: true, programmeId: true, academicYearId: true } },
        _count: {
          select: {
            memberships: { where: { isActive: true, status: "ACTIVE" } },
          },
        },
      },
      orderBy: { code: "asc" },
    });
    return sections.map((section) => {
      const currentStudentCount = section._count.memberships;
      return {
        id: section.id,
        code: section.code,
        name: section.name,
        semesterId: section.semesterId,
        programmeId: section.semester.programmeId,
        academicYearId: section.semester.academicYearId,
        studyYear: section.studyYear ?? Math.ceil(section.semester.number / 2),
        capacity: section.capacity,
        currentStudentCount,
        availableSeats: Math.max(0, section.capacity - currentStudentCount),
        isFull: currentStudentCount >= section.capacity,
      };
    });
  }

  subjects(user: AuthPrincipal, semesterId?: string) {
    return this.prisma.subject.findMany({
      where: {
        semester: { programme: { collegeId: user.collegeId } },
        isActive: true,
        ...(semesterId ? { semesterId } : {}),
        ...(user.permissions.includes("attendance.session.create") &&
        !user.permissions.includes("attendance.read_college")
          ? {
              facultyAssignments: {
                some: { facultyId: user.id, isActive: true },
              },
            }
          : {}),
      },
      select: { id: true, code: true, name: true, semesterId: true },
      orderBy: { code: "asc" },
    });
  }

  /* ─── ADMIN READ (include inactive, full details) ─── */

  async allDepartments(
    user: AuthPrincipal,
    filters: { search?: string; status?: string; hod?: string } = {},
  ) {
    const departments = await this.prisma.department.findMany({
      where: {
        collegeId: user.collegeId,
        ...(filters.search
          ? {
              OR: [
                { name: { contains: filters.search, mode: "insensitive" } },
                { code: { contains: filters.search, mode: "insensitive" } },
                {
                  shortName: { contains: filters.search, mode: "insensitive" },
                },
              ],
            }
          : {}),
        ...(filters.status === "ACTIVE"
          ? { isActive: true, archivedAt: null }
          : {}),
        ...(filters.status === "INACTIVE"
          ? { isActive: false, archivedAt: null }
          : {}),
        ...(filters.status === "ARCHIVED" ? { archivedAt: { not: null } } : {}),
        ...(filters.hod === "ASSIGNED" ? { hodId: { not: null } } : {}),
        ...(filters.hod === "UNASSIGNED" ? { hodId: null } : {}),
      },
      include: {
        campus: { select: { id: true, name: true } },
        _count: {
          select: {
            programmes: true,
            studentProfiles: true,
            staffProfiles: true,
            rooms: true,
            issues: {
              where: {
                status: {
                  notIn: ["VERIFIED", "CLOSED", "REJECTED", "CANCELLED"],
                },
              },
            },
          },
        },
      },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
    const hodIds = [
      ...new Set(
        departments.flatMap((department) =>
          department.hodId ? [department.hodId] : [],
        ),
      ),
    ];
    const [hods, sectionCounts] = await Promise.all([
      hodIds.length
        ? this.prisma.user.findMany({
            where: { id: { in: hodIds }, collegeId: user.collegeId },
            select: { id: true, publicId: true, fullName: true, status: true },
          })
        : Promise.resolve([]),
      this.prisma.section.groupBy({
        by: ["semesterId"],
        _count: true,
        where: {
          semester: {
            programme: { departmentId: { in: departments.map((d) => d.id) } },
          },
        },
      }),
    ]);
    const programmes = await this.prisma.programme.findMany({
      where: { departmentId: { in: departments.map((d) => d.id) } },
      select: { departmentId: true, semesters: { select: { id: true } } },
    });
    const semesterToCount = new Map(
      sectionCounts.map((sc) => [sc.semesterId, sc._count]),
    );
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
      hod: department.hodId ? (byId.get(department.hodId) ?? null) : null,
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
        programmes: {
          include: {
            semesters: {
              include: {
                academicYear: true,
                sections: {
                  include: { _count: { select: { studentProfiles: true } } },
                },
              },
            },
          },
        },
        staffProfiles: {
          include: {
            user: { select: { publicId: true, fullName: true, status: true } },
          },
        },
        studentProfiles: {
          take: 100,
          include: {
            user: { select: { publicId: true, fullName: true, status: true } },
            section: { select: { code: true, name: true } },
          },
        },
        _count: {
          select: {
            programmes: true,
            studentProfiles: true,
            staffProfiles: true,
            rooms: true,
            issues: {
              where: {
                status: {
                  notIn: ["VERIFIED", "CLOSED", "REJECTED", "CANCELLED"],
                },
              },
            },
          },
        },
      },
    });
    if (!department) throw new NotFoundException("Department not found.");
    const hod = department.hodId
      ? await this.prisma.user.findFirst({
          where: { id: department.hodId, collegeId: user.collegeId },
          select: { publicId: true, fullName: true, status: true },
        })
      : null;
    return { ...department, hod };
  }

  allProgrammes(user: AuthPrincipal, departmentId?: string) {
    return this.prisma.programme.findMany({
      where: {
        collegeId: user.collegeId,
        ...(departmentId ? { departmentId } : {}),
      },
      include: {
        department: { select: { id: true, name: true } },
        degreeTypeMaster: { select: { id: true, code: true, name: true } },
        _count: { select: { semesters: true, studentProfiles: true } },
      },
      orderBy: { name: "asc" },
    });
  }

  allYears(user: AuthPrincipal) {
    return this.prisma.academicYear.findMany({
      where: { collegeId: user.collegeId },
      include: {
        _count: { select: { semesters: true, attendanceSessions: true } },
      },
      orderBy: { startsOn: "desc" },
    });
  }

  allSemesters(
    user: AuthPrincipal,
    programmeId?: string,
    academicYearId?: string,
  ) {
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
      where: {
        semester: { programme: { collegeId: user.collegeId } },
        ...(semesterId ? { semesterId } : {}),
      },
      include: {
        semester: {
          select: {
            id: true,
            name: true,
            programme: { select: { id: true, name: true } },
            academicYear: { select: { id: true, name: true } },
          },
        },
        coordinatorAssignments: {
          where: { isActive: true },
          take: 1,
          orderBy: { validFrom: "desc" },
          include: {
            coordinator: { select: { publicId: true, fullName: true } },
          },
        },
        representativeAssignments: {
          where: { isActive: true },
          take: 1,
          orderBy: { validFrom: "desc" },
          include: {
            representative: { select: { publicId: true, fullName: true } },
          },
        },
        staffAssignments: {
          where: { isActive: true },
          include: { staff: { select: { publicId: true, fullName: true } } },
        },
        _count: {
          select: {
            memberships: { where: { isActive: true, status: "ACTIVE" } },
            attendanceSessions: true,
          },
        },
      },
      orderBy: { code: "asc" },
    });
    const roomIds = [
      ...new Set(
        sections.flatMap((section) =>
          section.assignedRoomId ? [section.assignedRoomId] : [],
        ),
      ),
    ];
    const rooms = roomIds.length
      ? await this.prisma.room.findMany({
          where: { id: { in: roomIds } },
          select: {
            id: true,
            code: true,
            name: true,
            floor: {
              select: { name: true, block: { select: { name: true } } },
            },
          },
        })
      : [];
    const byId = new Map(rooms.map((room) => [room.id, room]));
    return sections.map((section) => ({
      ...section,
      assignedRoom: section.assignedRoomId
        ? (byId.get(section.assignedRoomId) ?? null)
        : null,
      currentStudentCount: section._count.memberships,
      maximumCapacity: section.capacity,
      availableSeats: Math.max(
        0,
        section.capacity - section._count.memberships,
      ),
    }));
  }

  async section(user: AuthPrincipal, id: string) {
    const section = await this.prisma.section.findFirst({
      where: { id, semester: { programme: { collegeId: user.collegeId } } },
      include: {
        semester: {
          select: {
            id: true,
            name: true,
            programme: { select: { id: true, name: true } },
            academicYear: { select: { id: true, name: true } },
          },
        },
        coordinatorAssignments: {
          where: { isActive: true },
          take: 1,
          orderBy: { validFrom: "desc" },
          include: {
            coordinator: { select: { publicId: true, fullName: true } },
          },
        },
        representativeAssignments: {
          where: { isActive: true },
          take: 1,
          orderBy: { validFrom: "desc" },
          include: {
            representative: { select: { publicId: true, fullName: true } },
          },
        },
        staffAssignments: {
          where: { isActive: true },
          include: {
            staff: {
              select: {
                publicId: true,
                fullName: true,
                collegeIdentityId: true,
              },
            },
          },
        },
        memberships: {
          where: { isActive: true, status: "ACTIVE" },
          include: {
            student: {
              select: {
                publicId: true,
                fullName: true,
                collegeIdentityId: true,
              },
            },
          },
          orderBy: { startsOn: "asc" },
        },
        _count: {
          select: {
            memberships: { where: { isActive: true, status: "ACTIVE" } },
            attendanceSessions: true,
          },
        },
      },
    });
    if (!section) throw new NotFoundException("Section not found.");
    return {
      ...section,
      currentStudentCount: section._count.memberships,
      maximumCapacity: section.capacity,
      availableSeats: Math.max(
        0,
        section.capacity - section._count.memberships,
      ),
    };
  }

  allSubjects(user: AuthPrincipal, semesterId?: string) {
    return this.prisma.subject.findMany({
      where: {
        semester: { programme: { collegeId: user.collegeId } },
        ...(semesterId ? { semesterId } : {}),
      },
      include: {
        semester: {
          select: {
            id: true,
            name: true,
            programme: { select: { id: true, name: true } },
          },
        },
        _count: {
          select: { facultyAssignments: true, attendanceSessions: true },
        },
      },
      orderBy: { code: "asc" },
    });
  }

  async assignments(user: AuthPrincipal) {
    const sectionCollege = {
      semester: { programme: { collegeId: user.collegeId } },
    };
    const [faculty, coordinators, representatives, classStaff] =
      await Promise.all([
        this.prisma.facultySubjectAssignment.findMany({
          where: { section: sectionCollege },
          select: {
            id: true,
            validFrom: true,
            validUntil: true,
            isActive: true,
            assignmentType: true,
            attendancePermission: true,
            learningResourcePermission: true,
            assessmentPermission: true,
            faculty: {
              select: {
                publicId: true,
                collegeIdentityId: true,
                fullName: true,
              },
            },
            subject: {
              select: { id: true, code: true, name: true, semesterId: true },
            },
            section: {
              select: {
                id: true,
                code: true,
                name: true,
                semesterId: true,
                semester: {
                  select: { name: true, programme: { select: { name: true } } },
                },
              },
            },
          },
          orderBy: [{ isActive: "desc" }, { validFrom: "desc" }],
        }),
        this.prisma.classCoordinatorAssignment.findMany({
          where: { section: sectionCollege },
          select: {
            id: true,
            validFrom: true,
            validUntil: true,
            isActive: true,
            coordinator: {
              select: {
                publicId: true,
                collegeIdentityId: true,
                fullName: true,
              },
            },
            section: {
              select: {
                id: true,
                code: true,
                name: true,
                semesterId: true,
                semester: {
                  select: { name: true, programme: { select: { name: true } } },
                },
              },
            },
          },
          orderBy: [{ isActive: "desc" }, { validFrom: "desc" }],
        }),
        this.prisma.classRepresentativeAssignment.findMany({
          where: { section: sectionCollege },
          select: {
            id: true,
            validFrom: true,
            validUntil: true,
            isActive: true,
            representative: {
              select: {
                publicId: true,
                collegeIdentityId: true,
                fullName: true,
              },
            },
            section: {
              select: {
                id: true,
                code: true,
                name: true,
                semesterId: true,
                semester: {
                  select: { name: true, programme: { select: { name: true } } },
                },
              },
            },
          },
          orderBy: [{ isActive: "desc" }, { validFrom: "desc" }],
        }),
        this.prisma.classStaffAssignment.findMany({
          where: { section: sectionCollege },
          select: {
            id: true,
            validFrom: true,
            validUntil: true,
            isActive: true,
            assignmentType: true,
            staff: {
              select: {
                publicId: true,
                collegeIdentityId: true,
                fullName: true,
              },
            },
            section: {
              select: {
                id: true,
                code: true,
                name: true,
                semesterId: true,
                semester: {
                  select: { name: true, programme: { select: { name: true } } },
                },
              },
            },
          },
          orderBy: [{ isActive: "desc" }, { validFrom: "desc" }],
        }),
      ]);
    return { faculty, coordinators, representatives, classStaff };
  }

  async assignmentOptions(user: AuthPrincipal) {
    const now = new Date();
    const roleCodes = [
      "HOD",
      "FACULTY",
      "CLASS_COORDINATOR",
      "CLASS_REPRESENTATIVE",
    ];
    const activeRole = {
      validFrom: { lte: now },
      OR: [{ validUntil: null }, { validUntil: { gte: now } }],
      role: {
        code: { in: roleCodes },
        isActive: true,
        OR: [{ collegeId: null }, { collegeId: user.collegeId }],
      },
    };
    const activeSemester = {
      isActive: true,
      programme: {
        collegeId: user.collegeId,
        isActive: true,
        archivedAt: null,
        degreeTypeMaster: { isActive: true, archivedAt: null },
        department: { isActive: true, archivedAt: null },
      },
      academicYear: { collegeId: user.collegeId, isActive: true, archivedAt: null },
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
          publicId: true,
          collegeIdentityId: true,
          fullName: true,
          roles: {
            where: activeRole,
            select: { role: { select: { code: true, name: true } } },
          },
        },
        orderBy: { fullName: "asc" },
      }),
      this.prisma.section.findMany({
        where: { isActive: true, archivedAt: null, semester: activeSemester },
        select: {
          id: true,
          code: true,
          name: true,
          semesterId: true,
          semester: {
            select: {
              name: true,
              programme: { select: { name: true } },
              academicYear: {
                select: { name: true, startsOn: true, endsOn: true },
              },
            },
          },
        },
        orderBy: [
          { semester: { programme: { name: "asc" } } },
          { code: "asc" },
        ],
      }),
      this.prisma.subject.findMany({
        where: { isActive: true, semester: activeSemester },
        select: {
          id: true,
          code: true,
          name: true,
          semesterId: true,
          semester: {
            select: { name: true, programme: { select: { name: true } } },
          },
        },
        orderBy: [
          { semester: { programme: { name: "asc" } } },
          { code: "asc" },
        ],
      }),
    ]);
    return { users, sections, subjects };
  }

  /* ─── CREATE ─── */

  async createDegreeType(
    user: AuthPrincipal,
    input: CreateDegreeTypeDto,
    requestId: string,
  ) {
    await this.assertDegreeTypeUnique(user.collegeId, input.code, input.name);
    try {
      const degreeType = await this.prisma.degreeType.create({
        data: {
          collegeId: user.collegeId,
          code: input.code.trim().toUpperCase(),
          name: input.name.trim(),
          description: input.description?.trim() || null,
          sortOrder: input.sortOrder ?? 0,
          isActive: input.isActive ?? true,
        },
      });
      await this.audit.record({
        actorId: user.id,
        action: "degree_type.created",
        entityType: "DegreeType",
        entityId: degreeType.id,
        afterValue: degreeType,
        requestId,
      });
      return degreeType;
    } catch (error) {
      this.rethrowAcademicDuplicate(
        error,
        "A Degree Type with this code or name already exists.",
      );
      throw error;
    }
  }

  async createDepartment(
    user: AuthPrincipal,
    input: CreateDepartmentDto,
    requestId: string,
  ) {
    const campus = input.campusId
      ? await this.prisma.campus.findFirst({
          where: {
            id: input.campusId,
            collegeId: user.collegeId,
            isActive: true,
            archivedAt: null,
          },
        })
      : await this.prisma.campus.findFirst({
          where: {
            collegeId: user.collegeId,
            isActive: true,
            archivedAt: null,
          },
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        });
    if (!campus)
      throw new BadRequestException(
        "An active campus is required before creating a department.",
      );
    await this.assertDepartmentUnique(user.collegeId, input.code, input.name);
    const hodId = input.hodPublicId
      ? await this.resolveHod(user, input.hodPublicId)
      : null;
    let department;
    try {
      department = await this.prisma.department.create({
        data: {
          collegeId: user.collegeId,
          campusId: campus.id,
          code: input.code.trim().toUpperCase(),
          name: input.name.trim(),
          shortName: input.shortName?.trim(),
          description: input.description?.trim(),
          hodId,
          officialEmail: input.officialEmail?.trim().toLowerCase(),
          contactNumber: input.contactNumber?.trim(),
          location: input.location?.trim(),
          sortOrder: input.sortOrder ?? 0,
          isActive: input.isActive ?? true,
          createdById: user.id,
          updatedById: user.id,
        },
      });
    } catch (error) {
      this.rethrowAcademicDuplicate(
        error,
        "A department with this code or name already exists in the college.",
      );
      throw error;
    }
    await this.audit.record({
      actorId: user.id,
      action: "department.created",
      entityType: "Department",
      entityId: department.id,
      afterValue: {
        code: department.code,
        name: department.name,
        campusId: department.campusId,
      },
      requestId,
    });
    if (department.isActive)
      await this.officialGroups.synchronizeDepartment(
        user.collegeId,
        department.id,
      );
    return department;
  }

  async createProgramme(
    user: AuthPrincipal,
    input: CreateProgrammeDto,
    requestId: string,
  ) {
    const department = await this.prisma.department.findFirst({
      where: {
        id: input.departmentId,
        collegeId: user.collegeId,
        isActive: true,
        archivedAt: null,
      },
    });
    if (!department)
      throw new BadRequestException("The selected department is not active.");
    const degreeType = await this.requireActiveDegreeType(
      user.collegeId,
      input.degreeTypeId,
    );
    await this.assertProgrammeUnique(
      input.departmentId,
      input.code,
      input.name,
    );
    let programme;
    try {
      programme = await this.prisma.$transaction(
        async (tx) => {
          await this.placements.lockDepartment(tx, input.departmentId);
          const activeDepartment = await tx.department.findFirst({
            where: {
              id: input.departmentId,
              collegeId: user.collegeId,
              isActive: true,
              archivedAt: null,
            },
            select: { id: true },
          });
          if (!activeDepartment)
            throw new BadRequestException(
              "The selected department must remain active.",
            );
          const totalSemesters =
            input.totalSemesters ?? input.durationYears * 2;
          if (totalSemesters < input.durationYears) {
            throw new BadRequestException(
              "Total semesters cannot be lower than duration years.",
            );
          }
          const created = await tx.programme.create({
            data: {
              collegeId: user.collegeId,
              departmentId: input.departmentId,
              code: input.code.trim().toUpperCase(),
              name: input.name.trim(),
              degreeTypeId: degreeType.id,
              degreeType: degreeType.name,
              durationYears: input.durationYears,
              totalSemesters,
              isActive: input.isActive ?? true,
            },
          });
          await this.audit.record(
            {
              actorId: user.id,
              action: "programme.created",
              entityType: "Programme",
              entityId: created.id,
              afterValue: {
                code: created.code,
                name: created.name,
                departmentId: created.departmentId,
              },
              requestId,
            },
            tx,
          );
          return created;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      this.rethrowAcademicDuplicate(
        error,
        "A programme with this code or name already exists in the department.",
      );
      throw error;
    }
    return programme;
  }

  async createAcademicYear(
    user: AuthPrincipal,
    input: CreateAcademicYearDto,
    requestId: string,
  ) {
    const startsOn = new Date(input.startsOn);
    const endsOn = new Date(input.endsOn);
    this.assertAcademicYearInput(input.name, startsOn, endsOn);
    await this.assertAcademicYearUnique(user.collegeId, input.name);
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`academic-year-current:${user.collegeId}`}))`;
      if (input.isCurrent) {
        await tx.academicYear.updateMany({
          where: { collegeId: user.collegeId, isCurrent: true },
          data: { isCurrent: false },
        });
      }
      const year = await tx.academicYear.create({
        data: {
          collegeId: user.collegeId,
          name: input.name.trim(),
          startsOn,
          endsOn,
          isCurrent: input.isCurrent ?? false,
          isActive: input.isActive ?? true,
        },
      });
      await this.audit.record(
        {
          actorId: user.id,
          action: "academic_year.created",
          entityType: "AcademicYear",
          entityId: year.id,
          afterValue: {
            name: year.name,
            startsOn: year.startsOn,
            endsOn: year.endsOn,
            isCurrent: year.isCurrent,
          },
          requestId,
        },
        tx,
      );
      return year;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async createSemester(
    user: AuthPrincipal,
    input: CreateSemesterDto,
    requestId: string,
  ) {
    const programme = await this.prisma.programme.findFirst({
      where: {
        id: input.programmeId,
        collegeId: user.collegeId,
        isActive: true,
        archivedAt: null,
        degreeTypeMaster: { isActive: true, archivedAt: null },
        department: { isActive: true, archivedAt: null },
      },
    });
    if (!programme)
      throw new BadRequestException("The selected programme is not active.");
    if (input.number > Math.min(programme.totalSemesters, 8))
      throw new BadRequestException(
        `Semester number cannot exceed this programme's ${programme.totalSemesters} configured semesters.`,
      );
    const academicYear = await this.prisma.academicYear.findFirst({
      where: {
        id: input.academicYearId,
        collegeId: user.collegeId,
        isActive: true,
        archivedAt: null,
      },
    });
    if (!academicYear)
      throw new BadRequestException(
        "The selected academic year is not active.",
      );
    return this.prisma.$transaction(
      async (tx) => {
        await this.placements.lockDepartment(
          tx,
          `academic-year:${input.academicYearId}`,
        );
        await this.placements.lockDepartment(tx, programme.departmentId);
        const [activeProgramme, activeAcademicYear] = await Promise.all([
          tx.programme.findFirst({
            where: {
              id: input.programmeId,
              collegeId: user.collegeId,
              isActive: true,
              archivedAt: null,
              degreeTypeMaster: { isActive: true, archivedAt: null },
              department: { isActive: true, archivedAt: null },
            },
            select: { id: true },
          }),
          tx.academicYear.findFirst({
            where: {
              id: input.academicYearId,
              collegeId: user.collegeId,
              isActive: true,
              archivedAt: null,
            },
            select: { id: true },
          }),
        ]);
        if (!activeProgramme)
          throw new BadRequestException(
            "The selected programme and department must remain active.",
          );
        if (!activeAcademicYear)
          throw new BadRequestException(
            "The selected academic year must remain active.",
          );
        const semester = await tx.semester.create({
          data: {
            programmeId: input.programmeId,
            academicYearId: input.academicYearId,
            number: input.number,
            name: input.name.trim(),
          },
        });
        await this.audit.record(
          {
            actorId: user.id,
            action: "semester.created",
            entityType: "Semester",
            entityId: semester.id,
            afterValue: {
              programmeId: semester.programmeId,
              number: semester.number,
              name: semester.name,
            },
            requestId,
          },
          tx,
        );
        return semester;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async createSection(
    user: AuthPrincipal,
    input: CreateSectionDto,
    requestId: string,
  ) {
    const semester = await this.prisma.semester.findFirst({
      where: {
        id: input.semesterId,
        isActive: true,
        academicYear: { collegeId: user.collegeId, isActive: true, archivedAt: null },
        programme: {
          collegeId: user.collegeId,
          isActive: true,
          archivedAt: null,
          degreeTypeMaster: { isActive: true, archivedAt: null },
          department: { isActive: true, archivedAt: null },
        },
      },
      select: {
        id: true,
        number: true,
        academicYear: { select: { startsOn: true, endsOn: true } },
        programme: { select: { departmentId: true, totalSemesters: true } },
      },
    });
    if (!semester)
      throw new BadRequestException("The selected semester is not active.");
    const derivedStudyYear = this.engineeringStudyYear(
      semester.number,
      semester.programme.totalSemesters,
    );
    if (input.studyYear !== undefined && input.studyYear !== derivedStudyYear)
      throw new BadRequestException(
        `Semester ${semester.number} belongs to Study Year ${derivedStudyYear}.`,
      );
    if (input.assignedRoomId)
      await this.requireRoom(user.collegeId, input.assignedRoomId);
    await this.assertSectionUnique(input.semesterId, input.code, input.name);
    if (
      input.isActive === false &&
      (input.coordinatorPublicId ||
        input.representativePublicId ||
        input.prospectiveClassStaffPublicIds?.length)
    ) {
      throw new BadRequestException(
        "Assignments can only be added when the new section is active.",
      );
    }
    if (input.representativePublicId) {
      throw new BadRequestException(
        "Create the section, assign the student to it, and then select the class representative.",
      );
    }
    const prospectiveStaffIds = await this.resolveProspectiveStaffIds(
      user,
      input.prospectiveClassStaffPublicIds ?? [],
    );
    const coordinatorId = input.coordinatorPublicId
      ? await this.resolveInitialCoordinatorId(user, input.coordinatorPublicId)
      : null;
    const today = this.dateOnly(new Date());
    const validFrom =
      today < semester.academicYear.startsOn ||
      today > semester.academicYear.endsOn
        ? semester.academicYear.startsOn
        : today;
    let section;
    try {
      section = await this.prisma.$transaction(
        async (tx) => {
          await this.placements.lockDepartment(
            tx,
            semester.programme.departmentId,
          );
          const activeSemester = await tx.semester.findFirst({
            where: {
              id: input.semesterId,
              isActive: true,
              academicYear: { collegeId: user.collegeId, isActive: true, archivedAt: null },
              programme: {
                collegeId: user.collegeId,
                isActive: true,
                archivedAt: null,
                degreeTypeMaster: { isActive: true, archivedAt: null },
                department: { isActive: true, archivedAt: null },
              },
            },
            select: {
              id: true,
              number: true,
              programme: { select: { totalSemesters: true } },
            },
          });
          if (!activeSemester)
            throw new BadRequestException(
              "The selected semester and its academic parents must remain active.",
            );
          const lockedStudyYear = this.engineeringStudyYear(
            activeSemester.number,
            activeSemester.programme.totalSemesters,
          );
          if (input.studyYear !== undefined && input.studyYear !== lockedStudyYear)
            throw new BadRequestException(
              `Semester ${activeSemester.number} belongs to Study Year ${lockedStudyYear}.`,
            );
          const created = await tx.section.create({
            data: {
              semesterId: input.semesterId,
              code: input.code.trim().toUpperCase(),
              name: input.name.trim(),
              studyYear: lockedStudyYear,
              displayName: input.displayName?.trim(),
              assignedRoomId: input.assignedRoomId,
              officialGroupEnabled: input.officialGroupEnabled ?? true,
              capacity: input.capacity ?? 70,
              isActive: input.isActive ?? true,
              ...(prospectiveStaffIds.length
                ? {
                    staffAssignments: {
                      create: prospectiveStaffIds.map((staffId) => ({
                        staffId,
                        assignmentType: "PROSPECTIVE_CLASS_STAFF",
                        validFrom,
                      })),
                    },
                  }
                : {}),
              ...(coordinatorId
                ? {
                    coordinatorAssignments: {
                      create: { coordinatorId, validFrom },
                    },
                  }
                : {}),
            },
          });
          await this.audit.record(
            {
              actorId: user.id,
              action: "section.created",
              entityType: "Section",
              entityId: created.id,
              afterValue: {
                semesterId: created.semesterId,
                code: created.code,
                name: created.name,
              },
              requestId,
            },
            tx,
          );
          return created;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      this.rethrowAcademicDuplicate(
        error,
        "A section with this code or name already exists for the selected semester.",
      );
      throw error;
    }
    if (section.isActive && section.officialGroupEnabled)
      await this.officialGroups.synchronizeSection(user.collegeId, section.id);
    return section;
  }

  async createSubject(
    user: AuthPrincipal,
    input: CreateSubjectDto,
    requestId: string,
  ) {
    const semester = await this.prisma.semester.findFirst({
      where: {
        id: input.semesterId,
        programme: { collegeId: user.collegeId },
        isActive: true,
      },
    });
    if (!semester)
      throw new BadRequestException("The selected semester is not active.");
    const subject = await this.prisma.subject.create({
      data: {
        semesterId: input.semesterId,
        code: input.code.trim().toUpperCase(),
        name: input.name.trim(),
      },
    });
    await this.audit.record({
      actorId: user.id,
      action: "subject.created",
      entityType: "Subject",
      entityId: subject.id,
      afterValue: {
        semesterId: subject.semesterId,
        code: subject.code,
        name: subject.name,
      },
      requestId,
    });
    return subject;
  }

  /* ─── UPDATE ─── */

  async createFacultyAssignment(
    user: AuthPrincipal,
    input: CreateFacultySubjectAssignmentDto,
    requestId: string,
  ) {
    const { validFrom, validUntil } = this.assignmentPeriod(
      input.validFrom,
      input.validUntil,
    );
    const created = await this.prisma.$transaction(
      async (tx) => {
        const faculty = await this.assignmentUser(
          tx,
          user,
          input.facultyPublicId,
          "FACULTY",
          "faculty member",
        );
        const section = await this.activeAssignmentSection(
          tx,
          user,
          input.sectionId,
        );
        const subject = await this.activeAssignmentSubject(
          tx,
          user,
          input.subjectId,
        );
        if (section.semesterId !== subject.semesterId)
          throw new BadRequestException(
            "The subject and section must belong to the same semester.",
          );
        this.assertPeriodWithinAcademicYear(
          validFrom,
          validUntil,
          section.semester.academicYear.startsOn,
          section.semester.academicYear.endsOn,
        );
        const conflict = await tx.facultySubjectAssignment.findFirst({
          where: {
            facultyId: faculty.id,
            subjectId: subject.id,
            sectionId: section.id,
            isActive: true,
            ...(validUntil ? { validFrom: { lte: validUntil } } : {}),
            OR: [{ validUntil: null }, { validUntil: { gte: validFrom } }],
          },
          select: { id: true },
        });
        if (conflict)
          throw new ConflictException(
            "This faculty member already has an overlapping assignment for the subject and section.",
          );
        const assignment = await tx.facultySubjectAssignment.create({
          data: {
            facultyId: faculty.id,
            subjectId: subject.id,
            sectionId: section.id,
            validFrom,
            validUntil,
            assignmentType: input.assignmentType ?? "PRIMARY_FACULTY",
            attendancePermission:
              input.attendancePermission ??
              input.assignmentType !== "GUEST_FACULTY",
            learningResourcePermission:
              input.learningResourcePermission ?? false,
            assessmentPermission: input.assessmentPermission ?? false,
          },
        });
        await this.audit.record(
          {
            actorId: user.id,
            action: "faculty_subject_assignment.created",
            entityType: "FacultySubjectAssignment",
            entityId: assignment.id,
            afterValue: {
              facultyId: faculty.id,
              subjectId: subject.id,
              sectionId: section.id,
              validFrom,
              validUntil,
            },
            requestId,
          },
          tx,
        );
        return assignment;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    await this.officialGroups.synchronizeSection(
      user.collegeId,
      input.sectionId,
    );
    return created;
  }

  async createCoordinatorAssignment(
    user: AuthPrincipal,
    input: CreateClassCoordinatorAssignmentDto,
    requestId: string,
  ) {
    const { validFrom, validUntil } = this.assignmentPeriod(
      input.validFrom,
      input.validUntil,
    );
    const created = await this.prisma.$transaction(
      async (tx) => {
        const coordinator = await this.assignmentUser(
          tx,
          user,
          input.coordinatorPublicId,
          "CLASS_COORDINATOR",
          "class coordinator",
        );
        const section = await this.activeAssignmentSection(
          tx,
          user,
          input.sectionId,
        );
        this.assertPeriodWithinAcademicYear(
          validFrom,
          validUntil,
          section.semester.academicYear.startsOn,
          section.semester.academicYear.endsOn,
        );
        const conflict = await tx.classCoordinatorAssignment.findFirst({
          where: {
            sectionId: section.id,
            isActive: true,
            ...(validUntil ? { validFrom: { lte: validUntil } } : {}),
            OR: [{ validUntil: null }, { validUntil: { gte: validFrom } }],
          },
          select: { id: true },
        });
        if (conflict)
          throw new ConflictException(
            "This section already has a class coordinator during the selected dates.",
          );
        const assignment = await tx.classCoordinatorAssignment.create({
          data: {
            coordinatorId: coordinator.id,
            sectionId: section.id,
            validFrom,
            validUntil,
          },
        });
        await this.audit.record(
          {
            actorId: user.id,
            action: "class_coordinator_assignment.created",
            entityType: "ClassCoordinatorAssignment",
            entityId: assignment.id,
            afterValue: {
              coordinatorId: coordinator.id,
              sectionId: section.id,
              validFrom,
              validUntil,
            },
            requestId,
          },
          tx,
        );
        return assignment;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    await this.officialGroups.synchronizeSection(
      user.collegeId,
      input.sectionId,
    );
    return created;
  }

  async createRepresentativeAssignment(
    user: AuthPrincipal,
    input: CreateClassRepresentativeAssignmentDto,
    requestId: string,
  ) {
    const { validFrom, validUntil } = this.assignmentPeriod(
      input.validFrom,
      input.validUntil,
    );
    const created = await this.prisma.$transaction(
      async (tx) => {
        const representative = await this.assignmentUser(
          tx,
          user,
          input.representativePublicId,
          "CLASS_REPRESENTATIVE",
          "class representative",
        );
        const section = await this.activeAssignmentSection(
          tx,
          user,
          input.sectionId,
        );
        const studentInSection = await tx.studentProfile.findFirst({
          where: {
            userId: representative.id,
            sectionId: section.id,
            academicStatus: "ACTIVE",
            user: { status: "ACTIVE", archivedAt: null },
            section: {
              memberships: {
                some: {
                  studentUserId: representative.id,
                  isActive: true,
                  endsOn: null,
                  status: "ACTIVE",
                },
              },
            },
          },
          select: { id: true },
        });
        if (!studentInSection)
          throw new BadRequestException(
            "The class representative must be an active student in this section.",
          );
        this.assertPeriodWithinAcademicYear(
          validFrom,
          validUntil,
          section.semester.academicYear.startsOn,
          section.semester.academicYear.endsOn,
        );
        const conflict = await tx.classRepresentativeAssignment.findFirst({
          where: {
            sectionId: section.id,
            isActive: true,
            ...(validUntil ? { validFrom: { lte: validUntil } } : {}),
            OR: [{ validUntil: null }, { validUntil: { gte: validFrom } }],
          },
          select: { id: true },
        });
        if (conflict)
          throw new ConflictException(
            "This section already has a class representative during the selected dates.",
          );
        const assignment = await tx.classRepresentativeAssignment.create({
          data: {
            representativeId: representative.id,
            sectionId: section.id,
            validFrom,
            validUntil,
          },
        });
        await this.audit.record(
          {
            actorId: user.id,
            action: "class_representative_assignment.created",
            entityType: "ClassRepresentativeAssignment",
            entityId: assignment.id,
            afterValue: {
              representativeId: representative.id,
              sectionId: section.id,
              validFrom,
              validUntil,
            },
            requestId,
          },
          tx,
        );
        return assignment;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    await this.officialGroups.synchronizeSection(
      user.collegeId,
      input.sectionId,
    );
    return created;
  }

  async createClassStaffAssignment(
    user: AuthPrincipal,
    input: CreateClassStaffAssignmentDto,
    requestId: string,
  ) {
    const { validFrom, validUntil } = this.assignmentPeriod(
      input.validFrom,
      input.validUntil,
    );
    const created = await this.prisma.$transaction(
      async (tx) => {
        const staff = await this.assignmentUser(
          tx,
          user,
          input.staffPublicId,
          "FACULTY",
          "class staff member",
        );
        const section = await this.activeAssignmentSection(
          tx,
          user,
          input.sectionId,
        );
        this.assertPeriodWithinAcademicYear(
          validFrom,
          validUntil,
          section.semester.academicYear.startsOn,
          section.semester.academicYear.endsOn,
        );
        const assignmentType =
          input.assignmentType ?? "PROSPECTIVE_CLASS_STAFF";
        const conflict = await tx.classStaffAssignment.findFirst({
          where: {
            staffId: staff.id,
            sectionId: section.id,
            assignmentType,
            isActive: true,
            OR: [{ validUntil: null }, { validUntil: { gte: validFrom } }],
          },
          select: { id: true },
        });
        if (conflict)
          throw new ConflictException(
            "This staff member already has an active class-staff assignment for the section.",
          );
        const assignment = await tx.classStaffAssignment.create({
          data: {
            staffId: staff.id,
            sectionId: section.id,
            assignmentType,
            validFrom,
            validUntil,
          },
        });
        await this.audit.record(
          {
            actorId: user.id,
            action: "class_staff_assignment.created",
            entityType: "ClassStaffAssignment",
            entityId: assignment.id,
            afterValue: assignment,
            requestId,
          },
          tx,
        );
        return assignment;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    await this.officialGroups.synchronizeSection(
      user.collegeId,
      input.sectionId,
    );
    return created;
  }

  async assignStudent(
    user: AuthPrincipal,
    sectionId: string,
    input: AssignSectionStudentDto,
    requestId: string,
  ) {
    const startsOn = this.assignmentDate(
      input.startsOn,
      "membership start date",
    );
    const result = await this.prisma.$transaction(
      async (tx) => {
        const student = await tx.user.findFirst({
          where: {
            publicId: input.studentPublicId,
            collegeId: user.collegeId,
            status: "ACTIVE",
            archivedAt: null,
            roles: { some: { role: { code: "STUDENT" } } },
          },
          select: {
            id: true,
            publicId: true,
            studentProfile: { select: { id: true, sectionId: true } },
          },
        });
        if (!student?.studentProfile)
          throw new BadRequestException(
            "The student must complete an approved student profile before section assignment.",
          );
        if (student.studentProfile.sectionId === sectionId)
          throw new ConflictException(
            "The selected user already belongs to this section.",
          );
        const placement = await this.placements.placeStudent(tx, {
          collegeId: user.collegeId,
          userId: student.id,
          sectionId,
          startsOn,
          accountStatus: "ACTIVE",
          profile: {},
        });
        await this.audit.record(
          {
            actorId: user.id,
            action: "section.student_assigned",
            entityType: "SectionMembership",
            entityId: student.id,
            beforeValue: { sectionId: student.studentProfile.sectionId },
            afterValue: { sectionId, startsOn },
            reason: input.reason,
            requestId,
          },
          tx,
        );
        return {
          studentPublicId: student.publicId,
          sectionId,
          currentStudentCount: placement.currentStudentCount,
          maximumCapacity: placement.maximumCapacity,
          availableSeats: placement.availableSeats,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    await this.officialGroups.synchronizeSection(user.collegeId, sectionId);
    return result;
  }

  async updateDegreeType(
    user: AuthPrincipal,
    id: string,
    input: UpdateDegreeTypeDto,
    requestId: string,
  ) {
    const existing = await this.prisma.degreeType.findFirst({
      where: { id, collegeId: user.collegeId },
    });
    if (!existing) throw new NotFoundException("Degree Type not found.");
    if (existing.archivedAt && input.isActive)
      throw new ConflictException("Restore the archived Degree Type instead.");
    if (input.code !== undefined || input.name !== undefined) {
      await this.assertDegreeTypeUnique(
        user.collegeId,
        input.code ?? existing.code,
        input.name ?? existing.name,
        id,
      );
    }
    if (input.isActive === false) {
      const activeProgrammes = await this.prisma.programme.count({
        where: { collegeId: user.collegeId, degreeTypeId: id, isActive: true, archivedAt: null },
      });
      if (activeProgrammes)
        throw new ConflictException("Deactivate or archive this Degree Type's active programmes first.");
    }
    const updated = await this.prisma.degreeType.update({
      where: { id },
      data: {
        ...(input.code !== undefined ? { code: input.code.trim().toUpperCase() } : {}),
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    });
    await this.audit.record({
      actorId: user.id,
      action: "degree_type.updated",
      entityType: "DegreeType",
      entityId: id,
      beforeValue: existing,
      afterValue: updated,
      requestId,
    });
    return updated;
  }

  async archiveDegreeType(
    user: AuthPrincipal,
    id: string,
    reason: string | undefined,
    requestId: string,
  ) {
    const existing = await this.prisma.degreeType.findFirst({
      where: { id, collegeId: user.collegeId },
    });
    if (!existing) throw new NotFoundException("Degree Type not found.");
    if (existing.archivedAt) throw new ConflictException("Degree Type is already archived.");
    const activeProgrammes = await this.prisma.programme.count({
      where: { collegeId: user.collegeId, degreeTypeId: id, isActive: true, archivedAt: null },
    });
    if (activeProgrammes)
      throw new ConflictException("Archive or deactivate active programmes before archiving this Degree Type.");
    const updated = await this.prisma.degreeType.update({
      where: { id },
      data: { isActive: false, archivedAt: new Date() },
    });
    await this.audit.record({ actorId: user.id, action: "degree_type.archived", entityType: "DegreeType", entityId: id, beforeValue: existing, afterValue: updated, reason, requestId });
    return updated;
  }

  async restoreDegreeType(user: AuthPrincipal, id: string, requestId: string) {
    const existing = await this.prisma.degreeType.findFirst({ where: { id, collegeId: user.collegeId } });
    if (!existing) throw new NotFoundException("Degree Type not found.");
    if (!existing.archivedAt) throw new ConflictException("Degree Type is not archived.");
    await this.assertDegreeTypeUnique(user.collegeId, existing.code, existing.name, id);
    const updated = await this.prisma.degreeType.update({ where: { id }, data: { archivedAt: null, isActive: true } });
    await this.audit.record({ actorId: user.id, action: "degree_type.restored", entityType: "DegreeType", entityId: id, beforeValue: existing, afterValue: updated, requestId });
    return updated;
  }

  async updateDepartment(
    user: AuthPrincipal,
    id: string,
    input: UpdateDepartmentDto,
    requestId: string,
  ) {
    const existing = await this.prisma.department.findFirst({
      where: { id, collegeId: user.collegeId },
    });
    if (!existing) throw new NotFoundException("Department not found.");
    if (input.code !== undefined || input.name !== undefined) {
      await this.assertDepartmentUnique(
        user.collegeId,
        input.code ?? existing.code,
        input.name ?? existing.name,
        id,
      );
    }
    const hodId =
      input.hodPublicId === undefined
        ? undefined
        : input.hodPublicId
          ? await this.resolveHod(user, input.hodPublicId)
          : null;
    let department;
    try {
      department = await this.prisma.$transaction(
        async (tx) => {
          if (input.isActive === false) {
            await this.lockDepartmentSections(tx, id);
          } else {
            await this.placements.lockDepartment(tx, id);
          }
          const current = await tx.department.findFirst({
            where: { id, collegeId: user.collegeId },
          });
          if (!current) throw new NotFoundException("Department not found.");
          if (input.isActive && current.archivedAt)
            throw new ConflictException(
              "Restore the archived department instead of activating it directly.",
            );
          if (input.campusId) {
            const campus = await tx.campus.findFirst({
              where: {
                id: input.campusId,
                collegeId: user.collegeId,
                isActive: true,
                archivedAt: null,
              },
              select: { id: true },
            });
            if (!campus)
              throw new BadRequestException(
                "The selected campus is not active in this college.",
              );
          }
          const resultingActive = input.isActive ?? current.isActive;
          const resultingCampusId =
            input.campusId === undefined ? current.campusId : input.campusId;
          if (resultingActive) {
            await this.assertDepartmentCanActivate(tx, user.collegeId, {
              ...current,
              campusId: resultingCampusId,
              hodId: hodId === undefined ? current.hodId : hodId,
            });
          }
          const updated = await tx.department.update({
            where: { id },
            data: {
              ...(input.code !== undefined
                ? { code: input.code.trim().toUpperCase() }
                : {}),
              ...(input.name !== undefined ? { name: input.name.trim() } : {}),
              ...(input.campusId !== undefined
                ? {
                    campus: input.campusId
                      ? { connect: { id: input.campusId } }
                      : { disconnect: true },
                  }
                : {}),
              ...(input.shortName !== undefined
                ? { shortName: input.shortName?.trim() || null }
                : {}),
              ...(input.description !== undefined
                ? { description: input.description?.trim() || null }
                : {}),
              ...(hodId !== undefined ? { hodId } : {}),
              ...(input.officialEmail !== undefined
                ? {
                    officialEmail:
                      input.officialEmail?.trim().toLowerCase() || null,
                  }
                : {}),
              ...(input.contactNumber !== undefined
                ? { contactNumber: input.contactNumber?.trim() || null }
                : {}),
              ...(input.location !== undefined
                ? { location: input.location?.trim() || null }
                : {}),
              ...(input.isActive !== undefined
                ? { isActive: input.isActive }
                : {}),
              ...(input.sortOrder !== undefined
                ? { sortOrder: input.sortOrder }
                : {}),
              updatedById: user.id,
            },
          });
          if (input.isActive === false)
            await this.closeDepartmentAssignments(
              tx,
              id,
              this.dateOnly(new Date()),
            );
          await this.audit.record(
            {
              actorId: user.id,
              action: "department.updated",
              entityType: "Department",
              entityId: id,
              beforeValue: current,
              afterValue: updated,
              requestId,
            },
            tx,
          );
          return updated;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      this.rethrowAcademicDuplicate(
        error,
        "A department with this code or name already exists in the college.",
      );
      throw error;
    }
    if (department.isActive && !department.archivedAt)
      await this.officialGroups.synchronizeDepartment(
        user.collegeId,
        department.id,
      );
    return department;
  }

  async updateProgramme(
    user: AuthPrincipal,
    id: string,
    input: UpdateProgrammeDto,
    requestId: string,
  ) {
    const existing = await this.prisma.programme.findFirst({
      where: { id, collegeId: user.collegeId },
      include: { department: true },
    });
    if (!existing) throw new NotFoundException("Programme not found.");
    const degreeType = input.degreeTypeId
      ? await this.requireActiveDegreeType(user.collegeId, input.degreeTypeId)
      : null;
    if (
      input.isActive &&
      (!existing.department.isActive || existing.department.archivedAt)
    )
      throw new BadRequestException(
        "Restore or activate the parent department first.",
      );
    if (input.code !== undefined || input.name !== undefined) {
      await this.assertProgrammeUnique(
        existing.departmentId,
        input.code ?? existing.code,
        input.name ?? existing.name,
        id,
      );
    }
    let programme;
    try {
      programme = await this.prisma.$transaction(
        async (tx) => {
          if (input.isActive === false)
            await this.lockProgrammeSections(tx, existing.departmentId, id);
          else await this.placements.lockDepartment(tx, existing.departmentId);
          const current = await tx.programme.findFirst({
            where: { id, collegeId: user.collegeId },
          });
          if (!current) throw new NotFoundException("Programme not found.");
          if (input.isActive)
            await this.assertProgrammeCanActivate(
              tx,
              user.collegeId,
              current.departmentId,
            );
          const nextDurationYears = input.durationYears ?? current.durationYears;
          const nextTotalSemesters =
            input.totalSemesters ?? current.totalSemesters;
          if (nextTotalSemesters < nextDurationYears) {
            throw new BadRequestException(
              "Total semesters cannot be lower than duration years.",
            );
          }
          const updated = await tx.programme.update({
            where: { id },
            data: {
              ...(input.code !== undefined
                ? { code: input.code.trim().toUpperCase() }
                : {}),
              ...(input.name !== undefined ? { name: input.name.trim() } : {}),
              ...(degreeType
                ? { degreeTypeId: degreeType.id, degreeType: degreeType.name }
                : {}),
              ...(input.durationYears !== undefined
                ? { durationYears: input.durationYears }
                : {}),
              ...(input.totalSemesters !== undefined
                ? { totalSemesters: input.totalSemesters }
                : {}),
              ...(input.isActive !== undefined
                ? { isActive: input.isActive }
                : {}),
            },
          });
          if (input.isActive === false)
            await this.closeProgrammeAssignments(
              tx,
              id,
              this.dateOnly(new Date()),
            );
          await this.audit.record(
            {
              actorId: user.id,
              action: "programme.updated",
              entityType: "Programme",
              entityId: id,
              beforeValue: { name: current.name, isActive: current.isActive },
              afterValue: { name: updated.name, isActive: updated.isActive },
              requestId,
            },
            tx,
          );
          return updated;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      this.rethrowAcademicDuplicate(
        error,
        "A programme with this code or name already exists in the department.",
      );
      throw error;
    }
    return programme;
  }

  async updateSection(
    user: AuthPrincipal,
    id: string,
    input: UpdateSectionDto,
    requestId: string,
  ) {
    const existing = await this.prisma.section.findFirst({
      where: { id, semester: { programme: { collegeId: user.collegeId } } },
      include: {
        semester: {
          select: {
            number: true,
            academicYear: { select: { startsOn: true, endsOn: true } },
            programme: {
              select: { departmentId: true, totalSemesters: true },
            },
          },
        },
      },
    });
    if (!existing) throw new NotFoundException("Section not found.");
    const expectedStudyYear = this.engineeringStudyYear(
      existing.semester.number,
      existing.semester.programme.totalSemesters,
    );
    if (
      input.studyYear !== undefined &&
      input.studyYear !== null &&
      input.studyYear !== expectedStudyYear
    )
      throw new BadRequestException(
        `Semester ${existing.semester.number} belongs to Study Year ${expectedStudyYear}.`,
      );
    if (input.assignedRoomId)
      await this.requireRoom(user.collegeId, input.assignedRoomId);
    if (input.code !== undefined || input.name !== undefined) {
      await this.assertSectionUnique(
        existing.semesterId,
        input.code ?? existing.code,
        input.name ?? existing.name,
        id,
      );
    }
    const resultingActive = input.isActive ?? existing.isActive;
    if (input.isActive && existing.archivedAt)
      throw new ConflictException(
        "Restore the archived section instead of activating it directly.",
      );
    const addsAssignments = Boolean(
      input.coordinatorPublicId ||
        input.representativePublicId ||
        input.prospectiveClassStaffPublicIds?.length,
    );
    if (addsAssignments && (!resultingActive || existing.archivedAt))
      throw new BadRequestException(
        "Assignments can only be added to an active, unarchived section.",
      );
    if (input.isActive || addsAssignments)
      await this.assertSectionAncestorsActive(
        user.collegeId,
        existing.semesterId,
      );
    const coordinatorId = input.coordinatorPublicId
      ? await this.resolveInitialCoordinatorId(user, input.coordinatorPublicId)
      : null;
    const representativeId = input.representativePublicId
      ? await this.resolveInitialRepresentativeId(
          user,
          id,
          input.representativePublicId,
        )
      : null;
    const prospectiveStaffIds =
      input.prospectiveClassStaffPublicIds === undefined
        ? undefined
        : await this.resolveProspectiveStaffIds(
            user,
            input.prospectiveClassStaffPublicIds,
          );
    const effectiveOn = this.dateOnly(new Date());
    const validFrom =
      effectiveOn < existing.semester.academicYear.startsOn ||
      effectiveOn > existing.semester.academicYear.endsOn
        ? existing.semester.academicYear.startsOn
        : effectiveOn;
    let section;
    try {
      section = await this.prisma.$transaction(
        async (tx) => {
          await this.placements.lockDepartment(
            tx,
            existing.semester.programme.departmentId,
          );
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;
          const current = await tx.section.findFirst({
            where: {
              id,
              semester: { programme: { collegeId: user.collegeId } },
            },
            include: {
              semester: {
                select: {
                  number: true,
                  programme: { select: { totalSemesters: true } },
                },
              },
            },
          });
          if (!current) throw new NotFoundException("Section not found.");
          const lockedStudyYear = this.engineeringStudyYear(
            current.semester.number,
            current.semester.programme.totalSemesters,
          );
          if (
            input.studyYear !== undefined &&
            input.studyYear !== null &&
            input.studyYear !== lockedStudyYear
          )
            throw new BadRequestException(
              `Semester ${current.semester.number} belongs to Study Year ${lockedStudyYear}.`,
            );
          const lockedResultingActive = input.isActive ?? current.isActive;
          if (input.isActive && current.archivedAt)
            throw new ConflictException(
              "Restore the archived section instead of activating it directly.",
            );
          if (addsAssignments && (!lockedResultingActive || current.archivedAt))
            throw new BadRequestException(
              "Assignments can only be added to an active, unarchived section.",
            );
          if (lockedResultingActive) {
            const activeSemester = await tx.semester.findFirst({
              where: {
                id: current.semesterId,
                isActive: true,
                academicYear: { collegeId: user.collegeId, isActive: true, archivedAt: null },
                programme: {
                  collegeId: user.collegeId,
                  isActive: true,
                  archivedAt: null,
                  degreeTypeMaster: { isActive: true, archivedAt: null },
                  department: { isActive: true, archivedAt: null },
                },
              },
              select: { id: true },
            });
            if (!activeSemester)
              throw new BadRequestException(
                "The section's academic parents must remain active.",
              );
          }
          if (input.capacity !== undefined) {
            const currentStudentCount = await tx.sectionMembership.count({
              where: { sectionId: id, isActive: true, status: "ACTIVE" },
            });
            if (input.capacity < currentStudentCount)
              throw new BadRequestException(
                `Capacity cannot be lower than the ${currentStudentCount} active students already assigned.`,
              );
          }
          const updated = await tx.section.update({
            where: { id },
            data: {
              ...(input.code !== undefined
                ? { code: input.code.trim().toUpperCase() }
                : {}),
              ...(input.name !== undefined ? { name: input.name.trim() } : {}),
              ...(input.studyYear !== undefined
                ? { studyYear: lockedStudyYear }
                : {}),
              ...(input.displayName !== undefined
                ? { displayName: input.displayName?.trim() || null }
                : {}),
              ...(input.assignedRoomId !== undefined
                ? {
                    assignedRoom: input.assignedRoomId
                      ? { connect: { id: input.assignedRoomId } }
                      : { disconnect: true },
                  }
                : {}),
              ...(input.officialGroupEnabled !== undefined
                ? { officialGroupEnabled: input.officialGroupEnabled }
                : {}),
              ...(input.capacity !== undefined
                ? { capacity: input.capacity }
                : {}),
              ...(input.isActive !== undefined
                ? { isActive: input.isActive }
                : {}),
            },
          });
          if (input.isActive === false) {
            await this.closeSectionAssignments(tx, id, effectiveOn);
          } else {
            if (input.coordinatorPublicId !== undefined) {
              const current = await tx.classCoordinatorAssignment.findFirst({
                where: { sectionId: id, isActive: true },
                select: { id: true, coordinatorId: true },
              });
              if (!coordinatorId) {
                await tx.classCoordinatorAssignment.updateMany({
                  where: { sectionId: id, isActive: true },
                  data: { isActive: false, validUntil: effectiveOn },
                });
              } else if (current?.coordinatorId !== coordinatorId) {
                await tx.classCoordinatorAssignment.updateMany({
                  where: { sectionId: id, isActive: true },
                  data: { isActive: false, validUntil: effectiveOn },
                });
                await tx.classCoordinatorAssignment.create({
                  data: { sectionId: id, coordinatorId, validFrom },
                });
              }
            }
            if (input.representativePublicId !== undefined) {
              const current = await tx.classRepresentativeAssignment.findFirst({
                where: { sectionId: id, isActive: true },
                select: { id: true, representativeId: true },
              });
              if (!representativeId) {
                await tx.classRepresentativeAssignment.updateMany({
                  where: { sectionId: id, isActive: true },
                  data: { isActive: false, validUntil: effectiveOn },
                });
              } else if (current?.representativeId !== representativeId) {
                await tx.classRepresentativeAssignment.updateMany({
                  where: { sectionId: id, isActive: true },
                  data: { isActive: false, validUntil: effectiveOn },
                });
                await tx.classRepresentativeAssignment.create({
                  data: { sectionId: id, representativeId, validFrom },
                });
              }
            }
            if (prospectiveStaffIds !== undefined) {
              const current = await tx.classStaffAssignment.findMany({
                where: {
                  sectionId: id,
                  assignmentType: "PROSPECTIVE_CLASS_STAFF",
                  isActive: true,
                },
                select: { id: true, staffId: true },
              });
              const desired = new Set(prospectiveStaffIds);
              const removedIds = current
                .filter((assignment) => !desired.has(assignment.staffId))
                .map((assignment) => assignment.id);
              if (removedIds.length)
                await tx.classStaffAssignment.updateMany({
                  where: { id: { in: removedIds } },
                  data: { isActive: false, validUntil: effectiveOn },
                });
              const currentIds = new Set(
                current.map((assignment) => assignment.staffId),
              );
              for (const staffId of prospectiveStaffIds.filter(
                (candidate) => !currentIds.has(candidate),
              )) {
                const sameDay = await tx.classStaffAssignment.findFirst({
                  where: {
                    sectionId: id,
                    staffId,
                    assignmentType: "PROSPECTIVE_CLASS_STAFF",
                    validFrom,
                  },
                  select: { id: true },
                });
                if (sameDay)
                  await tx.classStaffAssignment.update({
                    where: { id: sameDay.id },
                    data: { isActive: true, validUntil: null },
                  });
                else
                  await tx.classStaffAssignment.create({
                    data: {
                      sectionId: id,
                      staffId,
                      assignmentType: "PROSPECTIVE_CLASS_STAFF",
                      validFrom,
                    },
                  });
              }
            }
          }
          await this.audit.record(
            {
              actorId: user.id,
              action: "section.updated",
              entityType: "Section",
              entityId: id,
              beforeValue: current,
              afterValue: updated,
              requestId,
            },
            tx,
          );
          return updated;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      this.rethrowAcademicDuplicate(
        error,
        "A section with this code or name already exists for the selected semester.",
      );
      throw error;
    }
    if (section.isActive && section.officialGroupEnabled)
      await this.officialGroups.synchronizeSection(user.collegeId, id);
    else
      await this.officialGroups.archiveLinkedGroup(
        user.collegeId,
        "section",
        id,
      );
    return section;
  }

  async archiveProgramme(
    user: AuthPrincipal,
    id: string,
    reason: string | undefined,
    requestId: string,
  ) {
    const existing = await this.prisma.programme.findFirst({
      where: { id, collegeId: user.collegeId },
    });
    if (!existing) throw new NotFoundException("Programme not found.");
    if (existing.archivedAt) throw new ConflictException("Programme is already archived.");
    const now = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      await this.lockProgrammeSections(tx, existing.departmentId, id);
      const archived = await tx.programme.update({ where: { id }, data: { isActive: false, archivedAt: now } });
      await tx.semester.updateMany({ where: { programmeId: id }, data: { isActive: false } });
      await tx.section.updateMany({ where: { semester: { programmeId: id } }, data: { isActive: false } });
      const activeMemberships = await tx.sectionMembership.findMany({
        where: { programmeId: id, isActive: true, status: "ACTIVE" },
        select: { studentUserId: true, sectionId: true },
      });
      await tx.sectionMembership.updateMany({
        where: { programmeId: id, isActive: true, status: "ACTIVE" },
        data: { isActive: false, endsOn: this.dateOnly(now), status: "ARCHIVED", changedById: user.id, reason: reason?.trim() || "Programme archived" },
      });
      if (activeMemberships.length) {
        await tx.userScope.deleteMany({
          where: {
            userId: {
              in: activeMemberships.map(({ studentUserId }) => studentUserId),
            },
            scopeType: "SECTION",
            scopeId: {
              in: activeMemberships.map(({ sectionId }) => sectionId),
            },
          },
        });
      }
      await this.closeProgrammeAssignments(tx, id, this.dateOnly(now));
      await this.audit.record({ actorId: user.id, action: "programme.archived", entityType: "Programme", entityId: id, beforeValue: existing, afterValue: archived, reason, requestId }, tx);
      return archived;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return updated;
  }

  async restoreProgramme(user: AuthPrincipal, id: string, requestId: string) {
    const existing = await this.prisma.programme.findFirst({
      where: { id, collegeId: user.collegeId },
      include: { department: true, degreeTypeMaster: true },
    });
    if (!existing) throw new NotFoundException("Programme not found.");
    if (!existing.archivedAt) throw new ConflictException("Programme is not archived.");
    if (!existing.department.isActive || existing.department.archivedAt || !existing.degreeTypeMaster.isActive || existing.degreeTypeMaster.archivedAt)
      throw new ConflictException("Restore the Programme's Department and Degree Type first.");
    const updated = await this.prisma.programme.update({ where: { id }, data: { archivedAt: null, isActive: true } });
    await this.audit.record({ actorId: user.id, action: "programme.restored", entityType: "Programme", entityId: id, beforeValue: existing, afterValue: updated, requestId });
    return updated;
  }

  async updateAcademicYear(
    user: AuthPrincipal,
    id: string,
    input: UpdateAcademicYearDto,
    requestId: string,
  ) {
    const existing = await this.prisma.academicYear.findFirst({ where: { id, collegeId: user.collegeId } });
    if (!existing) throw new NotFoundException("Academic year not found.");
    if (existing.archivedAt) throw new ConflictException("Restore the archived Academic Year before editing it.");
    if (input.isActive === false && existing.isCurrent)
      throw new ConflictException("Set another Academic Year as current before deactivating this one.");
    const startsOn = input.startsOn ? new Date(input.startsOn) : existing.startsOn;
    const endsOn = input.endsOn ? new Date(input.endsOn) : existing.endsOn;
    const name = input.name?.trim() ?? existing.name;
    this.assertAcademicYearInput(name, startsOn, endsOn);
    await this.assertAcademicYearUnique(user.collegeId, name, id);
    const updated = await this.prisma.academicYear.update({
      where: { id },
      data: { name, startsOn, endsOn, ...(input.isActive !== undefined ? { isActive: input.isActive } : {}) },
    });
    await this.audit.record({ actorId: user.id, action: "academic_year.updated", entityType: "AcademicYear", entityId: id, beforeValue: existing, afterValue: updated, requestId });
    return updated;
  }

  async setCurrentAcademicYear(user: AuthPrincipal, id: string, requestId: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`academic-year-current:${user.collegeId}`}))`;
      const year = await tx.academicYear.findFirst({ where: { id, collegeId: user.collegeId, isActive: true, archivedAt: null } });
      if (!year) throw new BadRequestException("Only an active, unarchived Academic Year can be current.");
      await tx.academicYear.updateMany({ where: { collegeId: user.collegeId, isCurrent: true, id: { not: id } }, data: { isCurrent: false } });
      const updated = await tx.academicYear.update({ where: { id }, data: { isCurrent: true } });
      await this.audit.record({ actorId: user.id, action: "academic_year.set_current", entityType: "AcademicYear", entityId: id, beforeValue: year, afterValue: updated, requestId }, tx);
      return updated;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async archiveAcademicYear(user: AuthPrincipal, id: string, reason: string | undefined, requestId: string) {
    const existing = await this.prisma.academicYear.findFirst({ where: { id, collegeId: user.collegeId } });
    if (!existing) throw new NotFoundException("Academic year not found.");
    if (existing.isCurrent) throw new ConflictException("Set another Academic Year as current before archiving this one.");
    if (existing.archivedAt) throw new ConflictException("Academic year is already archived.");
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      await this.lockAcademicYearSections(tx, user.collegeId, id);
      const updated = await tx.academicYear.update({ where: { id }, data: { isActive: false, isCurrent: false, archivedAt: now } });
      await tx.semester.updateMany({ where: { academicYearId: id }, data: { isActive: false } });
      await tx.section.updateMany({ where: { semester: { academicYearId: id } }, data: { isActive: false } });
      const activeMemberships = await tx.sectionMembership.findMany({
        where: { academicYearId: id, isActive: true, status: "ACTIVE" },
        select: { studentUserId: true, sectionId: true },
      });
      await tx.sectionMembership.updateMany({ where: { academicYearId: id, isActive: true, status: "ACTIVE" }, data: { isActive: false, endsOn: this.dateOnly(now), status: "ARCHIVED", changedById: user.id, reason: reason?.trim() || "Academic Year archived" } });
      if (activeMemberships.length) {
        await tx.userScope.deleteMany({
          where: {
            userId: {
              in: activeMemberships.map(({ studentUserId }) => studentUserId),
            },
            scopeType: "SECTION",
            scopeId: {
              in: activeMemberships.map(({ sectionId }) => sectionId),
            },
          },
        });
      }
      await this.closeAcademicYearAssignments(tx, id, this.dateOnly(now));
      await this.audit.record({ actorId: user.id, action: "academic_year.archived", entityType: "AcademicYear", entityId: id, beforeValue: existing, afterValue: updated, reason, requestId }, tx);
      return updated;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async restoreAcademicYear(user: AuthPrincipal, id: string, requestId: string) {
    const existing = await this.prisma.academicYear.findFirst({ where: { id, collegeId: user.collegeId } });
    if (!existing) throw new NotFoundException("Academic year not found.");
    if (!existing.archivedAt) throw new ConflictException("Academic year is not archived.");
    const updated = await this.prisma.academicYear.update({ where: { id }, data: { archivedAt: null, isActive: true, isCurrent: false } });
    await this.audit.record({ actorId: user.id, action: "academic_year.restored", entityType: "AcademicYear", entityId: id, beforeValue: existing, afterValue: updated, requestId });
    return updated;
  }

  async archiveDepartment(
    user: AuthPrincipal,
    id: string,
    reason: string | undefined,
    requestId: string,
  ) {
    const existing = await this.prisma.department.findFirst({
      where: { id, collegeId: user.collegeId },
    });
    if (!existing) throw new NotFoundException("Department not found.");
    const now = new Date();
    const archived = await this.prisma.$transaction(
      async (tx) => {
        await this.lockDepartmentSections(tx, id);
        const current = await tx.department.findFirst({
          where: { id, collegeId: user.collegeId },
        });
        if (!current) throw new NotFoundException("Department not found.");
        if (current.archivedAt) return current;
        const updated = await tx.department.update({
          where: { id },
          data: { isActive: false, archivedAt: now, updatedById: user.id },
        });
        const activeMemberships = await tx.sectionMembership.findMany({
          where: { departmentId: id, isActive: true, status: "ACTIVE" },
          select: { studentUserId: true },
        });
        if (activeMemberships.length) {
          const userIds = activeMemberships.map(
            (membership) => membership.studentUserId,
          );
          await tx.sectionMembership.updateMany({
            where: { departmentId: id, isActive: true, status: "ACTIVE" },
            data: {
              isActive: false,
              endsOn: this.dateOnly(now),
              status: "ARCHIVED",
              changedById: user.id,
              reason: reason?.trim() || "Department archived",
            },
          });
          await tx.userScope.deleteMany({
            where: {
              userId: { in: userIds },
              scopeType: "SECTION",
              scopeId: {
                in: (
                  await tx.section.findMany({
                    where: {
                      semester: { programme: { departmentId: id } },
                    },
                    select: { id: true },
                  })
                ).map((section) => section.id),
              },
            },
          });
        }
        await this.closeDepartmentAssignments(tx, id, this.dateOnly(now));
        await this.audit.record(
          {
            actorId: user.id,
            action: "department.archived",
            entityType: "Department",
            entityId: id,
            beforeValue: current,
            afterValue: updated,
            reason: reason?.trim() ?? "Archived by administrator",
            requestId,
          },
          tx,
        );
        return updated;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    await this.officialGroups.archiveLinkedGroup(
      user.collegeId,
      "department",
      id,
    );
    return archived;
  }

  async departmentDependencies(user: AuthPrincipal, id: string) {
    return this.departmentDependenciesWithClient(
      this.prisma as unknown as Prisma.TransactionClient,
      user,
      id,
    );
  }

  private async departmentDependenciesWithClient(
    client: Prisma.TransactionClient,
    user: AuthPrincipal,
    id: string,
  ) {
    const department = await client.department.findFirst({
      where: { id, collegeId: user.collegeId },
      include: {
        _count: {
          select: {
            programmes: true,
            studentProfiles: true,
            staffProfiles: true,
            rooms: true,
            issues: true,
            feedbackTargets: true,
            feedbackActions: true,
            courses: true,
            aiUsageRecords: true,
            aiKnowledgeDocuments: true,
          },
        },
      },
    });
    if (!department) throw new NotFoundException("Department not found.");
    const sectionWhere = { semester: { programme: { departmentId: id } } };
    const [
      sections,
      subjects,
      memberships,
      facultyAssignments,
      coordinatorAssignments,
      staffAssignments,
      representativeAssignments,
      attendanceSessions,
      attendanceRecords,
      attendanceSummaries,
      learningResources,
      userScopes,
      announcementAudiences,
      officialGroups,
      archivedRecords,
    ] = await Promise.all([
      client.section.count({ where: sectionWhere }),
      client.subject.count({
        where: { semester: { programme: { departmentId: id } } },
      }),
      client.sectionMembership.count({ where: { section: sectionWhere } }),
      client.facultySubjectAssignment.count({
        where: { section: sectionWhere },
      }),
      client.classCoordinatorAssignment.count({
        where: { section: sectionWhere },
      }),
      client.classStaffAssignment.count({
        where: { section: sectionWhere },
      }),
      client.classRepresentativeAssignment.count({
        where: { section: sectionWhere },
      }),
      client.attendanceSession.count({ where: { section: sectionWhere } }),
      client.attendanceRecord.count({
        where: { session: { section: sectionWhere } },
      }),
      client.attendanceSummary.count({ where: { section: sectionWhere } }),
      client.subjectResourceSection.count({
        where: { section: sectionWhere },
      }),
      client.userScope.count({
        where: { scopeType: "DEPARTMENT", scopeId: id },
      }),
      client.announcementAudience.count({
        where: { scopeType: "DEPARTMENT", scopeId: id },
      }),
      client.conversation.count({
        where: {
          collegeId: user.collegeId,
          officialGroupType: "DEPARTMENT",
          linkedEntityId: id,
        },
      }),
      client.archivedRecord.count({
        where: {
          collegeId: user.collegeId,
          entityType: "Department",
          entityId: id,
        },
      }),
    ]);
    const dependencies = {
      ...department._count,
      sections,
      subjects,
      sectionMemberships: memberships,
      facultyAssignments,
      coordinatorAssignments,
      staffAssignments,
      representativeAssignments,
      attendanceSessions,
      attendanceRecords,
      attendanceSummaries,
      learningResourceTargets: learningResources,
      userScopes,
      announcementAudiences,
      officialGroups,
      archivedRecords,
    };
    const dependencyCount = Object.values(dependencies).reduce(
      (total, count) => total + count,
      0,
    );
    return {
      department: {
        id: department.id,
        code: department.code,
        name: department.name,
        isActive: department.isActive,
        archivedAt: department.archivedAt,
      },
      dependencies,
      dependencyCount,
      canDelete: Boolean(department.archivedAt) && dependencyCount === 0,
    };
  }

  async restoreDepartment(user: AuthPrincipal, id: string, requestId: string) {
    const existing = await this.prisma.department.findFirst({
      where: { id, collegeId: user.collegeId },
    });
    if (!existing) throw new NotFoundException("Department not found.");
    const restored = await this.prisma.$transaction(
      async (tx) => {
        await this.placements.lockDepartment(tx, id);
        const current = await tx.department.findFirst({
          where: { id, collegeId: user.collegeId },
        });
        if (!current) throw new NotFoundException("Department not found.");
        if (current.isActive && !current.archivedAt) return current;
        await this.assertDepartmentCanActivate(tx, user.collegeId, current);
        const updated = await tx.department.update({
          where: { id },
          data: { isActive: true, archivedAt: null, updatedById: user.id },
        });
        await this.audit.record(
          {
            actorId: user.id,
            action: "department.restored",
            entityType: "Department",
            entityId: id,
            beforeValue: current,
            afterValue: updated,
            requestId,
          },
          tx,
        );
        return updated;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    await this.officialGroups.synchronizeDepartment(user.collegeId, id);
    return restored;
  }

  async deleteDepartment(user: AuthPrincipal, id: string, requestId: string) {
    return this.prisma.$transaction(
      async (tx) => {
        await this.lockDepartmentSections(tx, id);
        const report = await this.departmentDependenciesWithClient(
          tx,
          user,
          id,
        );
        if (!report.department.archivedAt)
          throw new ConflictException(
            "Archive the department before requesting permanent deletion.",
          );
        if (report.dependencyCount > 0) {
          throw new ConflictException({
            code: "DEPARTMENT_HAS_DEPENDENCIES",
            message:
              "The department still has dependent academic or historical records. Keep it archived.",
            details: report.dependencies,
          });
        }
        try {
          await tx.department.delete({ where: { id } });
        } catch (error) {
          if (this.isPrismaConstraintError(error))
            throw new ConflictException(
              "The department still has protected dependencies and cannot be deleted.",
            );
          throw error;
        }
        await this.audit.record(
          {
            actorId: user.id,
            action: "department.deleted",
            entityType: "Department",
            entityId: id,
            beforeValue: report.department,
            requestId,
          },
          tx,
        );
        return { deleted: true };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async sectionDependencies(user: AuthPrincipal, id: string) {
    return this.sectionDependenciesWithClient(
      this.prisma as unknown as Prisma.TransactionClient,
      user,
      id,
    );
  }

  private async sectionDependenciesWithClient(
    client: Prisma.TransactionClient,
    user: AuthPrincipal,
    id: string,
  ) {
    const section = await client.section.findFirst({
      where: { id, semester: { programme: { collegeId: user.collegeId } } },
      include: {
        _count: {
          select: {
            studentProfiles: true,
            memberships: true,
            coordinatorAssignments: true,
            staffAssignments: true,
            representativeAssignments: true,
            attendanceSessions: true,
            attendanceSummaries: true,
            facultyAssignments: true,
            subjectResourceTargets: true,
            modelPaperTargets: true,
          },
        },
      },
    });
    if (!section) throw new NotFoundException("Section not found.");
    const [
      attendanceImports,
      userScopes,
      announcementAudiences,
      officialGroups,
      archivedRecords,
    ] = await Promise.all([
      client.attendanceImportBatch.count({ where: { sectionId: id } }),
      client.userScope.count({
        where: { scopeType: "SECTION", scopeId: id },
      }),
      client.announcementAudience.count({
        where: { scopeType: "SECTION", scopeId: id },
      }),
      client.conversation.count({
        where: {
          collegeId: user.collegeId,
          officialGroupType: "SECTION",
          linkedEntityId: id,
        },
      }),
      client.archivedRecord.count({
        where: {
          collegeId: user.collegeId,
          entityType: "Section",
          entityId: id,
        },
      }),
    ]);
    const dependencies = {
      ...section._count,
      attendanceImports,
      userScopes,
      announcementAudiences,
      officialGroups,
      archivedRecords,
    };
    const dependencyCount = Object.values(dependencies).reduce(
      (total, count) => total + count,
      0,
    );
    return {
      section: {
        id: section.id,
        code: section.code,
        name: section.name,
        isActive: section.isActive,
        archivedAt: section.archivedAt,
      },
      dependencies,
      dependencyCount,
      canDelete: Boolean(section.archivedAt) && dependencyCount === 0,
    };
  }

  async archiveSection(
    user: AuthPrincipal,
    id: string,
    reason: string | undefined,
    requestId: string,
  ) {
    const existing = await this.prisma.section.findFirst({
      where: { id, semester: { programme: { collegeId: user.collegeId } } },
      include: {
        semester: { select: { programme: { select: { departmentId: true } } } },
      },
    });
    if (!existing) throw new NotFoundException("Section not found.");
    const now = new Date();
    const archived = await this.prisma.$transaction(
      async (tx) => {
        await this.placements.lockDepartment(
          tx,
          existing.semester.programme.departmentId,
        );
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;
        const current = await tx.section.findFirst({
          where: { id, semester: { programme: { collegeId: user.collegeId } } },
        });
        if (!current) throw new NotFoundException("Section not found.");
        if (current.archivedAt) return current;
        const updated = await tx.section.update({
          where: { id },
          data: { isActive: false, archivedAt: now },
        });
        const activeMemberships = await tx.sectionMembership.findMany({
          where: { sectionId: id, isActive: true, status: "ACTIVE" },
          select: { studentUserId: true },
        });
        if (activeMemberships.length) {
          const userIds = activeMemberships.map(
            (membership) => membership.studentUserId,
          );
          await tx.sectionMembership.updateMany({
            where: { sectionId: id, isActive: true, status: "ACTIVE" },
            data: {
              isActive: false,
              endsOn: this.dateOnly(now),
              status: "ARCHIVED",
              changedById: user.id,
              reason: reason?.trim() || "Section archived",
            },
          });
          await tx.userScope.deleteMany({
            where: {
              userId: { in: userIds },
              scopeType: "SECTION",
              scopeId: id,
            },
          });
        }
        await this.closeSectionAssignments(tx, id, this.dateOnly(now));
        await this.audit.record(
          {
            actorId: user.id,
            action: "section.archived",
            entityType: "Section",
            entityId: id,
            beforeValue: current,
            afterValue: updated,
            reason: reason?.trim() ?? "Archived by administrator",
            requestId,
          },
          tx,
        );
        return updated;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    await this.officialGroups.archiveLinkedGroup(user.collegeId, "section", id);
    return archived;
  }

  async restoreSection(user: AuthPrincipal, id: string, requestId: string) {
    const existing = await this.prisma.section.findFirst({
      where: { id, semester: { programme: { collegeId: user.collegeId } } },
      include: {
        semester: { select: { programme: { select: { departmentId: true } } } },
      },
    });
    if (!existing) throw new NotFoundException("Section not found.");
    const restored = await this.prisma.$transaction(
      async (tx) => {
        await this.placements.lockDepartment(
          tx,
          existing.semester.programme.departmentId,
        );
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;
        const current = await tx.section.findFirst({
          where: { id, semester: { programme: { collegeId: user.collegeId } } },
        });
        if (!current) throw new NotFoundException("Section not found.");
        if (current.isActive && !current.archivedAt) return current;
        const activeSemester = await tx.semester.findFirst({
          where: {
            id: current.semesterId,
            isActive: true,
            academicYear: { collegeId: user.collegeId, isActive: true, archivedAt: null },
            programme: {
              collegeId: user.collegeId,
              isActive: true,
              archivedAt: null,
              degreeTypeMaster: { isActive: true, archivedAt: null },
              department: { isActive: true, archivedAt: null },
            },
          },
          select: { id: true },
        });
        if (!activeSemester)
          throw new BadRequestException(
            "Activate the section's department, programme, academic year and semester first.",
          );
        const updated = await tx.section.update({
          where: { id },
          data: { isActive: true, archivedAt: null },
        });
        await this.audit.record(
          {
            actorId: user.id,
            action: "section.restored",
            entityType: "Section",
            entityId: id,
            beforeValue: current,
            afterValue: updated,
            requestId,
          },
          tx,
        );
        return updated;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    if (restored.officialGroupEnabled)
      await this.officialGroups.synchronizeSection(user.collegeId, id);
    return restored;
  }

  async deleteSection(user: AuthPrincipal, id: string, requestId: string) {
    const existing = await this.prisma.section.findFirst({
      where: { id, semester: { programme: { collegeId: user.collegeId } } },
      include: {
        semester: { select: { programme: { select: { departmentId: true } } } },
      },
    });
    if (!existing) throw new NotFoundException("Section not found.");
    return this.prisma.$transaction(
      async (tx) => {
        await this.placements.lockDepartment(
          tx,
          existing.semester.programme.departmentId,
        );
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;
        const report = await this.sectionDependenciesWithClient(tx, user, id);
        if (!report.section.archivedAt)
          throw new ConflictException(
            "Archive the section before requesting permanent deletion.",
          );
        if (report.dependencyCount > 0) {
          throw new ConflictException({
            code: "SECTION_HAS_DEPENDENCIES",
            message:
              "The section still has dependent academic or historical records. Keep it archived.",
            details: report.dependencies,
          });
        }
        try {
          await tx.section.delete({ where: { id } });
        } catch (error) {
          if (this.isPrismaConstraintError(error))
            throw new ConflictException(
              "The section still has protected dependencies and cannot be deleted.",
            );
          throw error;
        }
        await this.audit.record(
          {
            actorId: user.id,
            action: "section.deleted",
            entityType: "Section",
            entityId: id,
            beforeValue: report.section,
            requestId,
          },
          tx,
        );
        return { deleted: true };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async deactivateFacultyAssignment(
    user: AuthPrincipal,
    id: string,
    input: DeactivateAcademicAssignmentDto,
    requestId: string,
  ) {
    const effectiveOn = this.assignmentDate(
      input.effectiveOn,
      "effective date",
    );
    const updated = await this.prisma.$transaction(
      async (tx) => {
        const existing = await tx.facultySubjectAssignment.findFirst({
          where: {
            id,
            section: { semester: { programme: { collegeId: user.collegeId } } },
          },
        });
        if (!existing)
          throw new NotFoundException("Faculty assignment not found.");
        this.assertCanDeactivate(
          existing.validFrom,
          existing.validUntil,
          existing.isActive,
          effectiveOn,
        );
        const assignment = await tx.facultySubjectAssignment.update({
          where: { id },
          data: { isActive: false, validUntil: effectiveOn },
        });
        await this.audit.record(
          {
            actorId: user.id,
            action: "faculty_subject_assignment.deactivated",
            entityType: "FacultySubjectAssignment",
            entityId: id,
            beforeValue: {
              isActive: existing.isActive,
              validUntil: existing.validUntil,
            },
            afterValue: { isActive: false, validUntil: effectiveOn },
            reason: input.reason.trim(),
            requestId,
          },
          tx,
        );
        return assignment;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    await this.officialGroups.synchronizeSection(
      user.collegeId,
      updated.sectionId,
    );
    return updated;
  }

  async deactivateCoordinatorAssignment(
    user: AuthPrincipal,
    id: string,
    input: DeactivateAcademicAssignmentDto,
    requestId: string,
  ) {
    const effectiveOn = this.assignmentDate(
      input.effectiveOn,
      "effective date",
    );
    const updated = await this.prisma.$transaction(
      async (tx) => {
        const existing = await tx.classCoordinatorAssignment.findFirst({
          where: {
            id,
            section: { semester: { programme: { collegeId: user.collegeId } } },
          },
        });
        if (!existing)
          throw new NotFoundException(
            "Class coordinator assignment not found.",
          );
        this.assertCanDeactivate(
          existing.validFrom,
          existing.validUntil,
          existing.isActive,
          effectiveOn,
        );
        const assignment = await tx.classCoordinatorAssignment.update({
          where: { id },
          data: { isActive: false, validUntil: effectiveOn },
        });
        await this.audit.record(
          {
            actorId: user.id,
            action: "class_coordinator_assignment.deactivated",
            entityType: "ClassCoordinatorAssignment",
            entityId: id,
            beforeValue: {
              isActive: existing.isActive,
              validUntil: existing.validUntil,
            },
            afterValue: { isActive: false, validUntil: effectiveOn },
            reason: input.reason.trim(),
            requestId,
          },
          tx,
        );
        return assignment;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    await this.officialGroups.synchronizeSection(
      user.collegeId,
      updated.sectionId,
    );
    return updated;
  }

  async deactivateRepresentativeAssignment(
    user: AuthPrincipal,
    id: string,
    input: DeactivateAcademicAssignmentDto,
    requestId: string,
  ) {
    const effectiveOn = this.assignmentDate(
      input.effectiveOn,
      "effective date",
    );
    const updated = await this.prisma.$transaction(
      async (tx) => {
        const existing = await tx.classRepresentativeAssignment.findFirst({
          where: {
            id,
            section: { semester: { programme: { collegeId: user.collegeId } } },
          },
        });
        if (!existing)
          throw new NotFoundException(
            "Class representative assignment not found.",
          );
        this.assertCanDeactivate(
          existing.validFrom,
          existing.validUntil,
          existing.isActive,
          effectiveOn,
        );
        const assignment = await tx.classRepresentativeAssignment.update({
          where: { id },
          data: { isActive: false, validUntil: effectiveOn },
        });
        await this.audit.record(
          {
            actorId: user.id,
            action: "class_representative_assignment.deactivated",
            entityType: "ClassRepresentativeAssignment",
            entityId: id,
            beforeValue: {
              isActive: existing.isActive,
              validUntil: existing.validUntil,
            },
            afterValue: { isActive: false, validUntil: effectiveOn },
            reason: input.reason.trim(),
            requestId,
          },
          tx,
        );
        return assignment;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    await this.officialGroups.synchronizeSection(
      user.collegeId,
      updated.sectionId,
    );
    return updated;
  }

  async deactivateClassStaffAssignment(
    user: AuthPrincipal,
    id: string,
    input: DeactivateAcademicAssignmentDto,
    requestId: string,
  ) {
    const effectiveOn = this.assignmentDate(
      input.effectiveOn,
      "effective date",
    );
    const updated = await this.prisma.$transaction(
      async (tx) => {
        const existing = await tx.classStaffAssignment.findFirst({
          where: {
            id,
            section: { semester: { programme: { collegeId: user.collegeId } } },
          },
        });
        if (!existing)
          throw new NotFoundException("Class staff assignment not found.");
        this.assertCanDeactivate(
          existing.validFrom,
          existing.validUntil,
          existing.isActive,
          effectiveOn,
        );
        const assignment = await tx.classStaffAssignment.update({
          where: { id },
          data: { isActive: false, validUntil: effectiveOn },
        });
        await this.audit.record(
          {
            actorId: user.id,
            action: "class_staff_assignment.deactivated",
            entityType: "ClassStaffAssignment",
            entityId: id,
            beforeValue: existing,
            afterValue: assignment,
            reason: input.reason,
            requestId,
          },
          tx,
        );
        return assignment;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    await this.officialGroups.synchronizeSection(
      user.collegeId,
      updated.sectionId,
    );
    return updated;
  }

  async updateEntityStatus(
    user: AuthPrincipal,
    entityType: string,
    id: string,
    input: UpdateEntityStatusDto,
    requestId: string,
  ) {
    const actions: Record<string, () => Promise<unknown>> = {
      department: async () => {
        const existing = await this.prisma.department.findFirst({
          where: { id, collegeId: user.collegeId },
        });
        if (!existing) throw new NotFoundException("Department not found.");
        if (input.isActive && existing.archivedAt)
          throw new ConflictException(
            "Restore the archived department instead of activating it directly.",
          );
        return this.prisma.$transaction(
          async (tx) => {
            if (!input.isActive) {
              await this.lockDepartmentSections(tx, id);
            } else {
              await this.placements.lockDepartment(tx, id);
            }
            const current = await tx.department.findFirst({
              where: { id, collegeId: user.collegeId },
            });
            if (!current) throw new NotFoundException("Department not found.");
            if (input.isActive && current.archivedAt)
              throw new ConflictException(
                "Restore the archived department instead of activating it directly.",
              );
            if (input.isActive)
              await this.assertDepartmentCanActivate(
                tx,
                user.collegeId,
                current,
              );
            const updated = await tx.department.update({
              where: { id },
              data: { isActive: input.isActive },
            });
            if (!input.isActive)
              await this.closeDepartmentAssignments(
                tx,
                id,
                this.dateOnly(new Date()),
              );
            await this.audit.record(
              {
                actorId: user.id,
                action: "department.updated",
                entityType: "Department",
                entityId: id,
                beforeValue: { isActive: current.isActive },
                afterValue: { isActive: updated.isActive },
                requestId,
              },
              tx,
            );
            return updated;
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      },
      programme: async () => {
        const existing = await this.prisma.programme.findFirst({
          where: { id, collegeId: user.collegeId },
          include: { department: true },
        });
        if (!existing) throw new NotFoundException("Programme not found.");
        return this.prisma.$transaction(
          async (tx) => {
            if (!input.isActive)
              await this.lockProgrammeSections(
                tx,
                existing.departmentId,
                id,
              );
            else
              await this.placements.lockDepartment(tx, existing.departmentId);
            const current = await tx.programme.findFirst({
              where: { id, collegeId: user.collegeId },
            });
            if (!current) throw new NotFoundException("Programme not found.");
            if (input.isActive)
              await this.assertProgrammeCanActivate(
                tx,
                user.collegeId,
                current.departmentId,
              );
            const updated = await tx.programme.update({
              where: { id },
              data: { isActive: input.isActive },
            });
            if (!input.isActive)
              await this.closeProgrammeAssignments(
                tx,
                id,
                this.dateOnly(new Date()),
              );
            await this.audit.record(
              {
                actorId: user.id,
                action: "programme.updated",
                entityType: "Programme",
                entityId: id,
                beforeValue: { isActive: current.isActive },
                afterValue: { isActive: updated.isActive },
                requestId,
              },
              tx,
            );
            return updated;
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      },
      semester: async () => {
        const existing = await this.prisma.semester.findFirst({
          where: { id, programme: { collegeId: user.collegeId } },
          include: {
            programme: { include: { department: true } },
            academicYear: true,
          },
        });
        if (!existing) throw new NotFoundException("Semester not found.");
        return this.prisma.$transaction(
          async (tx) => {
            await this.lockSemesterSections(
              tx,
              existing.programme.departmentId,
              id,
            );
            const current = await tx.semester.findFirst({
              where: { id, programme: { collegeId: user.collegeId } },
            });
            if (!current) throw new NotFoundException("Semester not found.");
            if (input.isActive)
              await this.assertSemesterCanActivate(tx, user.collegeId, id);
            const updated = await tx.semester.update({
              where: { id },
              data: { isActive: input.isActive },
            });
            if (!input.isActive)
              await this.closeSemesterAssignments(
                tx,
                id,
                this.dateOnly(new Date()),
              );
            await this.audit.record(
              {
                actorId: user.id,
                action: "semester.updated",
                entityType: "Semester",
                entityId: id,
                beforeValue: { isActive: current.isActive },
                afterValue: { isActive: updated.isActive },
                requestId,
              },
              tx,
            );
            return updated;
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      },
      section: async () => {
        const existing = await this.prisma.section.findFirst({
          where: { id, semester: { programme: { collegeId: user.collegeId } } },
          include: {
            semester: {
              select: { programme: { select: { departmentId: true } } },
            },
          },
        });
        if (!existing) throw new NotFoundException("Section not found.");
        if (input.isActive && existing.archivedAt)
          throw new ConflictException(
            "Restore the archived section instead of activating it directly.",
          );
        if (input.isActive)
          await this.assertSectionAncestorsActive(
            user.collegeId,
            existing.semesterId,
          );
        return this.prisma.$transaction(
          async (tx) => {
            await this.placements.lockDepartment(
              tx,
              existing.semester.programme.departmentId,
            );
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;
            const current = await tx.section.findFirst({
              where: {
                id,
                semester: { programme: { collegeId: user.collegeId } },
              },
            });
            if (!current) throw new NotFoundException("Section not found.");
            if (input.isActive && current.archivedAt)
              throw new ConflictException(
                "Restore the archived section instead of activating it directly.",
              );
            if (input.isActive) {
              const activeSection = await tx.section.findFirst({
                where: {
                  id,
                  archivedAt: null,
                  semester: {
                    isActive: true,
                    academicYear: { collegeId: user.collegeId, isActive: true, archivedAt: null },
                    programme: {
                      collegeId: user.collegeId,
                      isActive: true,
                      archivedAt: null,
                      degreeTypeMaster: { isActive: true, archivedAt: null },
                      department: {
                        collegeId: user.collegeId,
                        isActive: true,
                        archivedAt: null,
                      },
                    },
                  },
                },
                select: { id: true },
              });
              if (!activeSection) {
                throw new BadRequestException(
                  "The section's academic parents must remain active.",
                );
              }
            }
            const updated = await tx.section.update({
              where: { id },
              data: { isActive: input.isActive },
            });
            if (!input.isActive)
              await this.closeSectionAssignments(
                tx,
                id,
                this.dateOnly(new Date()),
              );
            await this.audit.record(
              {
                actorId: user.id,
                action: "section.updated",
                entityType: "Section",
                entityId: id,
                beforeValue: { isActive: current.isActive },
                afterValue: { isActive: updated.isActive },
                requestId,
              },
              tx,
            );
            return updated;
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      },
      subject: async () => {
        const existing = await this.prisma.subject.findFirst({
          where: { id, semester: { programme: { collegeId: user.collegeId } } },
        });
        if (!existing) throw new NotFoundException("Subject not found.");
        const updated = await this.prisma.subject.update({
          where: { id },
          data: { isActive: input.isActive },
        });
        await this.audit.record({
          actorId: user.id,
          action: "subject.updated",
          entityType: "Subject",
          entityId: id,
          beforeValue: { isActive: existing.isActive },
          afterValue: { isActive: updated.isActive },
          requestId,
        });
        return updated;
      },
      academicYear: async () => {
        const existing = await this.prisma.academicYear.findFirst({
          where: { id, collegeId: user.collegeId },
        });
        if (!existing) throw new NotFoundException("Academic year not found.");
        return this.prisma.$transaction(
          async (tx) => {
            await this.lockAcademicYearSections(tx, user.collegeId, id);
            const current = await tx.academicYear.findFirst({
              where: { id, collegeId: user.collegeId },
            });
            if (!current)
              throw new NotFoundException("Academic year not found.");
            const updated = await tx.academicYear.update({
              where: { id },
              data: { isActive: input.isActive },
            });
            if (!input.isActive)
              await this.closeAcademicYearAssignments(
                tx,
                id,
                this.dateOnly(new Date()),
              );
            await this.audit.record(
              {
                actorId: user.id,
                action: "academic_year.updated",
                entityType: "AcademicYear",
                entityId: id,
                beforeValue: { isActive: current.isActive },
                afterValue: { isActive: updated.isActive },
                requestId,
              },
              tx,
            );
            return updated;
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      },
    };
    const handler = actions[entityType];
    if (!handler)
      throw new BadRequestException(`Unknown entity type: ${entityType}`);
    const result = await handler();
    if (entityType === "section") {
      if (input.isActive)
        await this.officialGroups.synchronizeSection(user.collegeId, id);
      else
        await this.officialGroups.archiveLinkedGroup(
          user.collegeId,
          "section",
          id,
        );
    } else if (entityType === "department") {
      if (input.isActive)
        await this.officialGroups.synchronizeDepartment(user.collegeId, id);
      else
        await this.officialGroups.archiveLinkedGroup(
          user.collegeId,
          "department",
          id,
        );
    }
    return result;
  }

  private async assertDepartmentUnique(
    collegeId: string,
    rawCode: string,
    rawName: string,
    exceptId?: string,
  ) {
    if (!rawCode.trim())
      throw new BadRequestException("Department short code is required.");
    if (!rawName.trim())
      throw new BadRequestException("Department name is required.");
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
      throw new ConflictException(
        duplicate.code === rawCode.trim().toUpperCase()
          ? "Department code already exists."
          : "Department name already exists in this college.",
      );
    }
  }

  private async assertDegreeTypeUnique(
    collegeId: string,
    rawCode: string,
    rawName: string,
    exceptId?: string,
  ) {
    const code = rawCode.trim().toUpperCase();
    const name = rawName.trim();
    if (!code) throw new BadRequestException("Degree Type code is required.");
    if (!name) throw new BadRequestException("Degree Type name is required.");
    const duplicate = await this.prisma.degreeType.findFirst({
      where: {
        collegeId,
        ...(exceptId ? { id: { not: exceptId } } : {}),
        OR: [
          { code: { equals: code, mode: "insensitive" } },
          { name: { equals: name, mode: "insensitive" } },
        ],
      },
      select: { code: true, name: true },
    });
    if (duplicate)
      throw new ConflictException(
        duplicate.code.toUpperCase() === code
          ? "Degree Type code already exists."
          : "Degree Type name already exists in this college.",
      );
  }

  private async requireActiveDegreeType(collegeId: string, id: string) {
    const degreeType = await this.prisma.degreeType.findFirst({
      where: { id, collegeId, isActive: true, archivedAt: null },
      select: { id: true, code: true, name: true },
    });
    if (!degreeType)
      throw new BadRequestException("The selected Degree Type is not active.");
    return degreeType;
  }

  private assertAcademicYearInput(name: string, startsOn: Date, endsOn: Date) {
    const normalizedName = name.trim();
    if (!normalizedName) throw new BadRequestException("Academic Year name is required.");
    if (Number.isNaN(startsOn.getTime()) || Number.isNaN(endsOn.getTime()))
      throw new BadRequestException("Invalid Academic Year date format.");
    if (endsOn <= startsOn)
      throw new BadRequestException("Academic Year end date must be after its start date.");
    const match = normalizedName.match(/^(\d{4})-(\d{4})$/u);
    if (!match) {
      throw new BadRequestException(
        "Academic Year name must use YYYY-YYYY, for example 2026-2027.",
      );
    }
    const nameStartYear = Number(match[1]);
    const nameEndYear = Number(match[2]);
    if (nameEndYear !== nameStartYear + 1) {
      throw new BadRequestException(
        "Academic Year end year must be exactly one year after its start year.",
      );
    }
    if (
      startsOn.getUTCFullYear() !== nameStartYear ||
      endsOn.getUTCFullYear() !== nameEndYear
    ) {
      throw new BadRequestException(
        "Academic Year name must match the configured start and end dates.",
      );
    }
  }

  private async assertAcademicYearUnique(
    collegeId: string,
    rawName: string,
    exceptId?: string,
  ) {
    const duplicate = await this.prisma.academicYear.findFirst({
      where: {
        collegeId,
        ...(exceptId ? { id: { not: exceptId } } : {}),
        name: { equals: rawName.trim(), mode: "insensitive" },
      },
      select: { id: true },
    });
    if (duplicate)
      throw new ConflictException("This Academic Year already exists in the college.");
  }

  private async assertProgrammeUnique(
    departmentId: string,
    rawCode: string,
    rawName: string,
    exceptId?: string,
  ) {
    const code = rawCode.trim().toUpperCase();
    const name = rawName.trim();
    if (!code) throw new BadRequestException("Programme code is required.");
    if (!name) throw new BadRequestException("Programme name is required.");
    const duplicate = await this.prisma.programme.findFirst({
      where: {
        departmentId,
        ...(exceptId ? { id: { not: exceptId } } : {}),
        OR: [
          { code: { equals: code, mode: "insensitive" } },
          { name: { equals: name, mode: "insensitive" } },
        ],
      },
      select: { code: true, name: true },
    });
    if (duplicate)
      throw new ConflictException(
        duplicate.code.toUpperCase() === code
          ? "Programme code already exists in this department."
          : "Programme name already exists in this department.",
      );
  }

  private async assertSectionUnique(
    semesterId: string,
    rawCode: string,
    rawName: string,
    exceptId?: string,
  ) {
    const code = rawCode.trim().toUpperCase();
    const name = rawName.trim();
    if (!code) throw new BadRequestException("Section code is required.");
    if (!name) throw new BadRequestException("Section name is required.");
    const duplicate = await this.prisma.section.findFirst({
      where: {
        semesterId,
        ...(exceptId ? { id: { not: exceptId } } : {}),
        OR: [
          { code: { equals: code, mode: "insensitive" } },
          { name: { equals: name, mode: "insensitive" } },
        ],
      },
      select: { code: true, name: true },
    });
    if (duplicate)
      throw new ConflictException(
        duplicate.code.toUpperCase() === code
          ? "Section code already exists for this semester."
          : "Section name already exists for this semester.",
      );
  }

  private async assertSectionAncestorsActive(
    collegeId: string,
    semesterId: string,
  ) {
    const semester = await this.prisma.semester.findFirst({
      where: {
        id: semesterId,
        isActive: true,
        academicYear: { collegeId, isActive: true, archivedAt: null },
        programme: {
          collegeId,
          isActive: true,
          archivedAt: null,
          degreeTypeMaster: { isActive: true, archivedAt: null },
          department: { collegeId, isActive: true, archivedAt: null },
        },
      },
      select: { id: true },
    });
    if (!semester)
      throw new BadRequestException(
        "Activate the section's department, programme, academic year and semester first.",
      );
  }

  private async resolveProspectiveStaffIds(
    user: AuthPrincipal,
    publicIds: string[],
  ) {
    const uniqueIds = [...new Set(publicIds)];
    if (!uniqueIds.length) return [];
    const now = new Date();
    const staff = await this.prisma.user.findMany({
      where: {
        publicId: { in: uniqueIds },
        collegeId: user.collegeId,
        status: "ACTIVE",
        archivedAt: null,
        OR: [
          { staffProfile: { isNot: null } },
          {
            roles: {
              some: {
                validFrom: { lte: now },
                OR: [{ validUntil: null }, { validUntil: { gte: now } }],
                role: {
                  code: "FACULTY",
                  isActive: true,
                  OR: [{ collegeId: null }, { collegeId: user.collegeId }],
                },
              },
            },
          },
        ],
      },
      select: { id: true, publicId: true },
    });
    if (staff.length !== uniqueIds.length)
      throw new BadRequestException(
        "Every prospective class staff member must be an active staff or faculty account in this college.",
      );
    const byPublicId = new Map(
      staff.map((member) => [member.publicId, member.id]),
    );
    return uniqueIds.map((publicId) => byPublicId.get(publicId)!);
  }

  private async resolveInitialCoordinatorId(
    user: AuthPrincipal,
    publicId: string,
  ) {
    const now = new Date();
    const coordinator = await this.prisma.user.findFirst({
      where: {
        publicId,
        collegeId: user.collegeId,
        status: "ACTIVE",
        archivedAt: null,
        OR: [
          { staffProfile: { isNot: null } },
          {
            roles: {
              some: {
                validFrom: { lte: now },
                OR: [{ validUntil: null }, { validUntil: { gte: now } }],
                role: {
                  code: "CLASS_COORDINATOR",
                  isActive: true,
                  OR: [{ collegeId: null }, { collegeId: user.collegeId }],
                },
              },
            },
          },
        ],
      },
      select: { id: true },
    });
    if (!coordinator)
      throw new BadRequestException(
        "The selected class coordinator must be an active authorized staff account.",
      );
    return coordinator.id;
  }

  private async resolveInitialRepresentativeId(
    user: AuthPrincipal,
    sectionId: string,
    publicId: string,
  ) {
    const representative = await this.prisma.user.findFirst({
      where: {
        publicId,
        collegeId: user.collegeId,
        status: "ACTIVE",
        archivedAt: null,
        studentProfile: { sectionId, academicStatus: "ACTIVE" },
        sectionMemberships: {
          some: {
            sectionId,
            isActive: true,
            endsOn: null,
            status: "ACTIVE",
          },
        },
        roles: {
          some: {
            role: {
              code: { in: ["STUDENT", "CLASS_REPRESENTATIVE"] },
              isActive: true,
              OR: [{ collegeId: null }, { collegeId: user.collegeId }],
            },
          },
        },
      },
      select: { id: true },
    });
    if (!representative)
      throw new BadRequestException(
        "The class representative must be an active student in this section.",
      );
    return representative.id;
  }

  private rethrowAcademicDuplicate(error: unknown, message: string): void {
    if (this.isPrismaUniqueError(error)) throw new ConflictException(message);
  }

  private isPrismaUniqueError(error: unknown): boolean {
    return Boolean(
      error &&
        typeof error === "object" &&
        "code" in error &&
        (error as { code?: string }).code === "P2002",
    );
  }

  private isPrismaConstraintError(error: unknown): boolean {
    return Boolean(
      error &&
        typeof error === "object" &&
        "code" in error &&
        ["P2003", "P2014"].includes((error as { code?: string }).code ?? ""),
    );
  }

  private dateOnly(value: Date) {
    return new Date(
      Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
    );
  }

  private engineeringStudyYear(
    semesterNumber: number,
    totalSemesters: number,
  ): number {
    if (
      !Number.isInteger(semesterNumber) ||
      semesterNumber < 1 ||
      semesterNumber > Math.min(totalSemesters, 8)
    ) {
      throw new BadRequestException(
        "Semester must be within the configured four-year Engineering programme.",
      );
    }
    return Math.ceil(semesterNumber / 2);
  }

  private async closeSectionAssignments(
    tx: Prisma.TransactionClient,
    sectionId: string,
    effectiveOn: Date,
  ) {
    await Promise.all([
      tx.facultySubjectAssignment.updateMany({
        where: { sectionId, isActive: true },
        data: { isActive: false, validUntil: effectiveOn },
      }),
      tx.classCoordinatorAssignment.updateMany({
        where: { sectionId, isActive: true },
        data: { isActive: false, validUntil: effectiveOn },
      }),
      tx.classStaffAssignment.updateMany({
        where: { sectionId, isActive: true },
        data: { isActive: false, validUntil: effectiveOn },
      }),
      tx.classRepresentativeAssignment.updateMany({
        where: { sectionId, isActive: true },
        data: { isActive: false, validUntil: effectiveOn },
      }),
    ]);
  }

  private async lockDepartmentSections(
    tx: Prisma.TransactionClient,
    departmentId: string,
  ) {
    await this.placements.lockDepartment(tx, departmentId);
    await this.lockSections(tx, {
      semester: { programme: { departmentId } },
    });
  }

  private async lockProgrammeSections(
    tx: Prisma.TransactionClient,
    departmentId: string,
    programmeId: string,
  ) {
    await this.placements.lockDepartment(tx, departmentId);
    await this.lockSections(
      tx,
      { semester: { programmeId } },
    );
  }

  private async lockSemesterSections(
    tx: Prisma.TransactionClient,
    departmentId: string,
    semesterId: string,
  ) {
    await this.placements.lockDepartment(tx, departmentId);
    await this.lockSections(tx, { semesterId });
  }

  private async lockAcademicYearSections(
    tx: Prisma.TransactionClient,
    collegeId: string,
    academicYearId: string,
  ) {
    await this.placements.lockDepartment(tx, `academic-year:${academicYearId}`);
    const departments = await tx.department.findMany({
      where: {
        collegeId,
        programmes: { some: { semesters: { some: { academicYearId } } } },
      },
      select: { id: true },
      orderBy: { id: "asc" },
    });
    for (const department of departments) {
      await this.placements.lockDepartment(tx, department.id);
    }
    await this.lockSections(tx, { semester: { academicYearId } });
  }

  private async lockSections(
    tx: Prisma.TransactionClient,
    where: Prisma.SectionWhereInput,
  ) {
    const sections = await tx.section.findMany({
      where,
      select: { id: true },
      orderBy: { id: "asc" },
    });
    for (const section of sections) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${section.id}))`;
    }
  }

  private async closeDepartmentAssignments(
    tx: Prisma.TransactionClient,
    departmentId: string,
    effectiveOn: Date,
  ) {
    const section = { semester: { programme: { departmentId } } };
    await Promise.all([
      tx.facultySubjectAssignment.updateMany({
        where: { section, isActive: true },
        data: { isActive: false, validUntil: effectiveOn },
      }),
      tx.classCoordinatorAssignment.updateMany({
        where: { section, isActive: true },
        data: { isActive: false, validUntil: effectiveOn },
      }),
      tx.classStaffAssignment.updateMany({
        where: { section, isActive: true },
        data: { isActive: false, validUntil: effectiveOn },
      }),
      tx.classRepresentativeAssignment.updateMany({
        where: { section, isActive: true },
        data: { isActive: false, validUntil: effectiveOn },
      }),
    ]);
  }

  private closeProgrammeAssignments(
    tx: Prisma.TransactionClient,
    programmeId: string,
    effectiveOn: Date,
  ) {
    return this.closeAssignmentsForSections(
      tx,
      { semester: { programmeId } },
      effectiveOn,
    );
  }

  private closeSemesterAssignments(
    tx: Prisma.TransactionClient,
    semesterId: string,
    effectiveOn: Date,
  ) {
    return this.closeAssignmentsForSections(tx, { semesterId }, effectiveOn);
  }

  private closeAcademicYearAssignments(
    tx: Prisma.TransactionClient,
    academicYearId: string,
    effectiveOn: Date,
  ) {
    return this.closeAssignmentsForSections(
      tx,
      { semester: { academicYearId } },
      effectiveOn,
    );
  }

  private async closeAssignmentsForSections(
    tx: Prisma.TransactionClient,
    section: Prisma.SectionWhereInput,
    effectiveOn: Date,
  ) {
    await Promise.all([
      tx.facultySubjectAssignment.updateMany({
        where: { section, isActive: true },
        data: { isActive: false, validUntil: effectiveOn },
      }),
      tx.classCoordinatorAssignment.updateMany({
        where: { section, isActive: true },
        data: { isActive: false, validUntil: effectiveOn },
      }),
      tx.classStaffAssignment.updateMany({
        where: { section, isActive: true },
        data: { isActive: false, validUntil: effectiveOn },
      }),
      tx.classRepresentativeAssignment.updateMany({
        where: { section, isActive: true },
        data: { isActive: false, validUntil: effectiveOn },
      }),
    ]);
  }

  private async assertDepartmentCanActivate(
    tx: Prisma.TransactionClient,
    collegeId: string,
    department: { campusId: string | null; hodId: string | null },
  ) {
    if (!department.campusId)
      throw new BadRequestException(
        "Cannot activate department: Assign an active campus first.",
      );
    const campus = await tx.campus.findFirst({
      where: {
        id: department.campusId,
        collegeId,
        isActive: true,
        archivedAt: null,
      },
      select: { id: true },
    });
    if (!campus)
      throw new BadRequestException(
        "Cannot activate department: Assigned campus is not active.",
      );
    if (!department.hodId) return;
    const hod = await tx.user.findFirst({
      where: {
        id: department.hodId,
        collegeId,
        status: "ACTIVE",
        archivedAt: null,
      },
      select: { id: true },
    });
    if (!hod)
      throw new BadRequestException(
        "Cannot activate department: Assigned HOD is not an active user.",
      );
  }

  private async assertProgrammeCanActivate(
    tx: Prisma.TransactionClient,
    collegeId: string,
    departmentId: string,
  ) {
    const department = await tx.department.findFirst({
      where: {
        id: departmentId,
        collegeId,
        isActive: true,
        archivedAt: null,
      },
      select: { id: true },
    });
    if (!department)
      throw new BadRequestException(
        "Restore or activate the parent department first.",
      );
  }

  private async assertSemesterCanActivate(
    tx: Prisma.TransactionClient,
    collegeId: string,
    semesterId: string,
  ) {
    const semester = await tx.semester.findFirst({
      where: {
        id: semesterId,
        academicYear: { collegeId, isActive: true, archivedAt: null },
        programme: {
          collegeId,
          isActive: true,
          archivedAt: null,
          degreeTypeMaster: { isActive: true, archivedAt: null },
          department: { collegeId, isActive: true, archivedAt: null },
        },
      },
      select: { id: true },
    });
    if (!semester)
      throw new BadRequestException(
        "Activate the semester's programme, department and academic year first.",
      );
  }

  private async resolveHod(
    user: AuthPrincipal,
    publicId: string,
  ): Promise<string> {
    const now = new Date();
    const hod = await this.prisma.user.findFirst({
      where: {
        publicId,
        collegeId: user.collegeId,
        status: "ACTIVE",
        archivedAt: null,
        OR: [
          { staffProfile: { isNot: null } },
          {
            roles: {
              some: {
                validFrom: { lte: now },
                OR: [{ validUntil: null }, { validUntil: { gt: now } }],
                role: { code: "HOD", isActive: true },
              },
            },
          },
        ],
      },
      select: { id: true },
    });
    if (!hod)
      throw new BadRequestException(
        "The selected HOD must be an active authorized staff account.",
      );
    return hod.id;
  }

  private async requireRoom(collegeId: string, roomId: string): Promise<void> {
    const room = await this.prisma.room.findFirst({
      where: {
        id: roomId,
        isActive: true,
        floor: { block: { campus: { collegeId } } },
      },
      select: { id: true },
    });
    if (!room)
      throw new BadRequestException(
        "The assigned classroom is not an active room in this college.",
      );
  }

  private assignmentPeriod(validFromInput: string, validUntilInput?: string) {
    const validFrom = this.assignmentDate(validFromInput, "start date");
    const validUntil = validUntilInput
      ? this.assignmentDate(validUntilInput, "end date")
      : undefined;
    if (validUntil && validUntil < validFrom)
      throw new BadRequestException(
        "The assignment end date cannot be before its start date.",
      );
    return { validFrom, validUntil };
  }

  private assignmentDate(input: string, label: string) {
    const parsed = new Date(input);
    if (Number.isNaN(parsed.getTime()))
      throw new BadRequestException(`The assignment ${label} is invalid.`);
    return new Date(
      Date.UTC(
        parsed.getUTCFullYear(),
        parsed.getUTCMonth(),
        parsed.getUTCDate(),
      ),
    );
  }

  private assertPeriodWithinAcademicYear(
    validFrom: Date,
    validUntil: Date | undefined,
    startsOn: Date,
    endsOn: Date,
  ) {
    if (
      validFrom < startsOn ||
      validFrom > endsOn ||
      (validUntil && validUntil > endsOn)
    ) {
      throw new BadRequestException(
        "Assignment dates must fall within the section's academic year.",
      );
    }
  }

  private assertCanDeactivate(
    validFrom: Date,
    validUntil: Date | null,
    isActive: boolean,
    effectiveOn: Date,
  ) {
    if (!isActive)
      throw new ConflictException("This assignment is already inactive.");
    if (effectiveOn < validFrom)
      throw new BadRequestException(
        "The deactivation date cannot be before the assignment start date.",
      );
    if (validUntil && effectiveOn > validUntil)
      throw new BadRequestException(
        "The deactivation date cannot be after the assignment end date.",
      );
  }

  private async assignmentUser(
    tx: Prisma.TransactionClient,
    actor: AuthPrincipal,
    publicId: string,
    roleCode: string,
    label: string,
  ) {
    const now = new Date();
    const user = await tx.user.findFirst({
      where: {
        publicId,
        collegeId: actor.collegeId,
        status: "ACTIVE",
        archivedAt: null,
        OR: [
          {
            roles: {
              some: {
                validFrom: { lte: now },
                OR: [{ validUntil: null }, { validUntil: { gte: now } }],
                role: {
                  code: roleCode,
                  isActive: true,
                  OR: [{ collegeId: null }, { collegeId: actor.collegeId }],
                },
              },
            },
          },
          { staffProfile: { isNot: null } },
        ],
      },
      select: { id: true, publicId: true, fullName: true },
    });
    if (!user)
      throw new BadRequestException(
        `The selected ${label} must be an active authorized staff account.`,
      );
    return user;
  }

  private async activeAssignmentSection(
    tx: Prisma.TransactionClient,
    actor: AuthPrincipal,
    sectionId: string,
  ) {
    const section = await tx.section.findFirst({
      where: {
        id: sectionId,
        isActive: true,
        archivedAt: null,
        semester: {
          isActive: true,
          programme: {
            collegeId: actor.collegeId,
            isActive: true,
            archivedAt: null,
            degreeTypeMaster: { isActive: true, archivedAt: null },
            department: { isActive: true, archivedAt: null },
          },
          academicYear: { collegeId: actor.collegeId, isActive: true, archivedAt: null },
        },
      },
      select: {
        id: true,
        semesterId: true,
        semester: {
          select: {
            academicYear: { select: { startsOn: true, endsOn: true } },
          },
        },
      },
    });
    if (!section)
      throw new BadRequestException(
        "The selected section and its academic parents must be active.",
      );
    return section;
  }

  private async activeAssignmentSubject(
    tx: Prisma.TransactionClient,
    actor: AuthPrincipal,
    subjectId: string,
  ) {
    const subject = await tx.subject.findFirst({
      where: {
        id: subjectId,
        isActive: true,
        semester: {
          isActive: true,
          programme: {
            collegeId: actor.collegeId,
            isActive: true,
            archivedAt: null,
            degreeTypeMaster: { isActive: true, archivedAt: null },
            department: { isActive: true, archivedAt: null },
          },
          academicYear: { collegeId: actor.collegeId, isActive: true, archivedAt: null },
        },
      },
      select: { id: true, semesterId: true },
    });
    if (!subject)
      throw new BadRequestException(
        "The selected subject and its academic parents must be active.",
      );
    return subject;
  }
}
