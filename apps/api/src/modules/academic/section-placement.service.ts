import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { AccountStatus, ScopeType } from "../../generated/prisma/enums";
import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../database/prisma.service";

export interface StudentPlacementProfileInput {
  departmentId?: string;
  programmeId?: string;
  academicYearId?: string;
  semesterId?: string;
  studentId?: string;
  registerNumber?: string | null;
  admissionYear?: number;
  rollNumber?: string | null;
  admissionNumber?: string | null;
  studyYear?: number | null;
  dateOfBirth?: Date | null;
  gender?: string | null;
  personalEmail?: string | null;
  bloodGroup?: string | null;
  address?: string | null;
  city?: string | null;
  district?: string | null;
  state?: string | null;
  pinCode?: string | null;
  parentName?: string | null;
  parentMobileNumber?: string | null;
  emergencyContact?: string | null;
}

export interface PlaceStudentInput {
  collegeId: string;
  userId: string;
  sectionId: string;
  startsOn: Date;
  accountStatus: AccountStatus;
  profile: StudentPlacementProfileInput;
}

export type ActivePlacementSection = Awaited<ReturnType<SectionPlacementService["lockActiveSection"]>>;

@Injectable()
export class SectionPlacementService {
  constructor(private readonly prisma: PrismaService) {}

  transaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async lockDepartment(tx: Prisma.TransactionClient, departmentId: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`department:${departmentId}`}))`;
  }

  async lockActiveSection(tx: Prisma.TransactionClient, collegeId: string, sectionId: string) {
    const located = await tx.section.findFirst({
      where: { id: sectionId, semester: { programme: { collegeId } } },
      select: { semester: { select: { programme: { select: { departmentId: true } } } } },
    });
    if (!located) throw new NotFoundException("The selected section was not found in this college.");
    await this.lockDepartment(tx, located.semester.programme.departmentId);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${sectionId}))`;
    const section = await tx.section.findFirst({
      where: {
        id: sectionId,
        isActive: true,
        archivedAt: null,
        semester: {
          isActive: true,
          academicYear: { collegeId, isActive: true },
          programme: {
            collegeId,
            isActive: true,
            department: { collegeId, isActive: true, archivedAt: null },
          },
        },
      },
      select: {
        id: true,
        code: true,
        name: true,
        capacity: true,
        studyYear: true,
        semesterId: true,
        semester: {
          select: {
            academicYearId: true,
            academicYear: { select: { startsOn: true } },
            programmeId: true,
            programme: { select: { id: true, departmentId: true } },
          },
        },
      },
    });
    if (!section) {
      throw new NotFoundException("The selected section and its academic parents must be active and unarchived.");
    }
    return section;
  }

  async assertAvailable(
    tx: Prisma.TransactionClient,
    section: { id: string; code: string; name: string; capacity: number },
    additionalSeats = 1,
    excludeUserIds: string[] = [],
  ) {
    const currentStudentCount = await tx.studentProfile.count({
      where: {
        sectionId: section.id,
        ...(excludeUserIds.length ? { userId: { notIn: excludeUserIds } } : {}),
        user: { status: AccountStatus.ACTIVE, archivedAt: null },
      },
    });
    return this.assertCapacity(section, currentStudentCount, additionalSeats);
  }

  assertCapacity(
    section: { id: string; code: string; name: string; capacity: number },
    currentStudentCount: number,
    additionalSeats = 1,
  ) {
    if (currentStudentCount + additionalSeats > section.capacity) {
      const availableSeats = Math.max(0, section.capacity - currentStudentCount);
      throw new ConflictException({
        code: "SECTION_FULL",
        message: `Section ${section.code || section.name} is full. Current capacity: ${currentStudentCount} / ${section.capacity}. Please select another Section.`,
        details: {
          sectionId: section.id,
          currentCapacity: currentStudentCount,
          maximumCapacity: section.capacity,
          availableSeats,
          requestedSeats: additionalSeats,
        },
      });
    }
    return {
      currentStudentCount,
      maximumCapacity: section.capacity,
      availableSeats: section.capacity - currentStudentCount,
    };
  }

  async placeStudent(tx: Prisma.TransactionClient, input: PlaceStudentInput) {
    const section = await this.lockActiveSection(tx, input.collegeId, input.sectionId);
    this.assertExpectedHierarchy(section, input.profile);
    const existing = await tx.studentProfile.findUnique({
      where: { userId: input.userId },
      select: { id: true, sectionId: true, studentId: true, admissionYear: true },
    });
    if (!existing && !input.profile.studentId?.trim()) {
      throw new BadRequestException("Student ID is required when creating a student profile.");
    }

    const capacity = input.accountStatus === AccountStatus.ACTIVE
      ? await this.assertAvailable(tx, section, 1, [input.userId])
      : await (async () => {
          const currentStudentCount = await tx.studentProfile.count({ where: { sectionId: section.id, user: { status: AccountStatus.ACTIVE, archivedAt: null } } });
          return { currentStudentCount, maximumCapacity: section.capacity, availableSeats: Math.max(0, section.capacity - currentStudentCount) };
        })();

    const derivedStudyYear = section.studyYear ?? input.profile.studyYear ?? null;
    const profileData = {
      departmentId: section.semester.programme.departmentId,
      programmeId: section.semester.programme.id,
      sectionId: section.id,
      studyYear: derivedStudyYear,
      ...(input.profile.studentId !== undefined ? { studentId: input.profile.studentId.trim() } : {}),
      ...(input.profile.registerNumber !== undefined ? { registerNumber: input.profile.registerNumber?.trim() || null } : {}),
      ...(input.profile.admissionYear !== undefined ? { admissionYear: input.profile.admissionYear } : {}),
      ...(input.profile.rollNumber !== undefined ? { rollNumber: input.profile.rollNumber?.trim() || null } : {}),
      ...(input.profile.admissionNumber !== undefined ? { admissionNumber: input.profile.admissionNumber?.trim() || null } : {}),
      ...(input.profile.dateOfBirth !== undefined ? { dateOfBirth: input.profile.dateOfBirth } : {}),
      ...(input.profile.gender !== undefined ? { gender: input.profile.gender?.trim() || null } : {}),
      ...(input.profile.personalEmail !== undefined ? { personalEmail: input.profile.personalEmail?.trim() || null } : {}),
      ...(input.profile.bloodGroup !== undefined ? { bloodGroup: input.profile.bloodGroup?.trim() || null } : {}),
      ...(input.profile.address !== undefined ? { address: input.profile.address?.trim() || null } : {}),
      ...(input.profile.city !== undefined ? { city: input.profile.city?.trim() || null } : {}),
      ...(input.profile.district !== undefined ? { district: input.profile.district?.trim() || null } : {}),
      ...(input.profile.state !== undefined ? { state: input.profile.state?.trim() || null } : {}),
      ...(input.profile.pinCode !== undefined ? { pinCode: input.profile.pinCode?.trim() || null } : {}),
      ...(input.profile.parentName !== undefined ? { parentName: input.profile.parentName?.trim() || null } : {}),
      ...(input.profile.parentMobileNumber !== undefined ? { parentMobileNumber: input.profile.parentMobileNumber?.trim() || null } : {}),
      ...(input.profile.emergencyContact !== undefined ? { emergencyContact: input.profile.emergencyContact?.trim() || null } : {}),
    };

    if (existing) {
      await tx.studentProfile.update({ where: { id: existing.id }, data: profileData });
    } else {
      await tx.studentProfile.create({
        data: {
          collegeId: input.collegeId,
          userId: input.userId,
          studentId: input.profile.studentId!.trim(),
          admissionYear: input.profile.admissionYear ?? section.semester.academicYear.startsOn.getUTCFullYear(),
          ...profileData,
        },
      });
    }

    const activeMembership = await tx.sectionMembership.findFirst({
      where: { studentUserId: input.userId, isActive: true },
      select: { id: true, sectionId: true, academicYearId: true },
    });
    if (activeMembership?.sectionId !== section.id || activeMembership.academicYearId !== section.semester.academicYearId) {
      await tx.sectionMembership.updateMany({
        where: { studentUserId: input.userId, isActive: true },
        data: { isActive: false, endsOn: input.startsOn },
      });
      await tx.sectionMembership.create({
        data: {
          studentUserId: input.userId,
          sectionId: section.id,
          academicYearId: section.semester.academicYearId,
          startsOn: input.startsOn,
          isActive: true,
        },
      });
    } else {
      await tx.sectionMembership.update({ where: { id: activeMembership.id }, data: { isActive: true, endsOn: null } });
    }
    await tx.userScope.deleteMany({ where: { userId: input.userId, scopeType: ScopeType.SECTION } });
    await tx.userScope.create({ data: { userId: input.userId, scopeType: ScopeType.SECTION, scopeId: section.id } });

    const currentStudentCount = capacity.currentStudentCount + (input.accountStatus === AccountStatus.ACTIVE ? 1 : 0);
    return {
      section,
      previousSectionId: existing?.sectionId ?? null,
      currentStudentCount,
      maximumCapacity: section.capacity,
      availableSeats: Math.max(0, section.capacity - currentStudentCount),
    };
  }

  async assertActivationCapacity(tx: Prisma.TransactionClient, collegeId: string, userId: string, sectionId: string) {
    const section = await this.lockActiveSection(tx, collegeId, sectionId);
    return this.assertAvailable(tx, section, 1, [userId]);
  }

  private assertExpectedHierarchy(
    section: Awaited<ReturnType<SectionPlacementService["lockActiveSection"]>>,
    profile: StudentPlacementProfileInput,
  ) {
    if (profile.departmentId && profile.departmentId !== section.semester.programme.departmentId) {
      throw new BadRequestException("Student department does not match the selected section.");
    }
    if (profile.programmeId && profile.programmeId !== section.semester.programme.id) {
      throw new BadRequestException("Student programme does not match the selected section.");
    }
    if (profile.academicYearId && profile.academicYearId !== section.semester.academicYearId) {
      throw new BadRequestException("Student academic year does not match the selected section.");
    }
    if (profile.semesterId && profile.semesterId !== section.semesterId) {
      throw new BadRequestException("Student semester does not match the selected section.");
    }
    if (profile.studyYear != null && section.studyYear != null && profile.studyYear !== section.studyYear) {
      throw new BadRequestException("Student study year does not match the selected section.");
    }
  }
}
