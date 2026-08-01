import { config } from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import * as argon2 from "argon2";
import { createHash, randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { PrismaClient } from "../src/generated/prisma/client";

config({ path: resolve(process.cwd(), ".env") });
config({ path: resolve(process.cwd(), "../../.env") });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for seeding.");
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl }),
});
const developmentCollegeCode = process.env.DEVELOPMENT_COLLEGE_CODE ?? "6201";
const developmentAdminEmail =
  process.env.DEVELOPMENT_ADMIN_EMAIL ?? "deva1253@college.com";
function requiredEnv(name: string, purpose: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for ${purpose}.`);
  return value;
}

const developmentAdminPassword = requiredEnv(
  "DEVELOPMENT_ADMIN_PASSWORD",
  "the temporary Main Admin password",
);
const developmentAdminName = process.env.DEVELOPMENT_ADMIN_NAME ?? "Devanand";
const developmentResetAdminPassword =
  process.env.DEVELOPMENT_RESET_ADMIN_PASSWORD === "true";
const developmentAdminMustChangePassword =
  process.env.DEVELOPMENT_ADMIN_MUST_CHANGE_PASSWORD === "true";
const collegeName = "AVS Engineering College";
const feedbackBaseUrl = process.env.WEB_URL ?? "http://localhost:3000";

function newFeedbackToken(): string {
  return `FB_${randomBytes(24).toString("base64url")}`;
}

function feedbackTokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function feedbackUrl(token: string): string {
  return `${feedbackBaseUrl.replace(/\/$/, "")}/feedback/scan/${token}`;
}

export const permissions = [
  "users.create",
  "users.read",
  "users.update",
  "users.suspend",
  "users.archive",
  "users.reset_password",
  "users.import",
  "users.delete_permanent",
  "roles.read",
  "roles.manage",
  "permissions.read",
  "permissions.manage",
  "scopes.manage",
  "sessions.read_own",
  "sessions.revoke_own",
  "sessions.revoke_any",
  "audit.read",
  "settings.read",
  "settings.manage",
  "integrations.manage",
  "system.health",
  "backups.manage",
  "data.maintenance",
  "academic.read",
  "academic.manage",
  "locations.read",
  "locations.manage",
  "locations.import",
  "locations.export",
  "locations.qr",
  "assets.read",
  "assets.manage",
  "assets.import",
  "assets.export",
  "attendance.read_own",
  "attendance.read_class",
  "attendance.read_department",
  "attendance.read_college",
  "attendance.staff.manage",
  "attendance.interventions.manage",
  "attendance.session.create",
  "attendance.mark",
  "attendance.submit",
  "attendance.edit_window",
  "attendance.correction.request",
  "attendance.correction.approve",
  "attendance.import",
  "attendance.export",
  "feedback.scan",
  "feedback.submit",
  "feedback.read_own",
  "feedback.read_staff",
  "feedback.read_department",
  "feedback.read_college",
  "feedback.targets.manage",
  "feedback.questions.manage",
  "feedback.cycles.manage",
  "feedback.qr.manage",
  "feedback.qr.download",
  "feedback.actions.manage",
  "feedback.export",
  "feedback.settings.manage",
  "issues.create",
  "issues.read_own",
  "issues.read_assigned",
  "issues.read_scope",
  "issues.read_all",
  "issues.assign",
  "issues.acknowledge",
  "issues.start",
  "issues.update_work",
  "issues.resolve",
  "issues.verify",
  "issues.reopen",
  "issues.reject",
  "issues.cancel",
  "issues.subscribe",
  "issues.export",
  "issue_config.manage",
  "routing.manage",
  "sla.manage",
  "escalations.manage",
  "conversations.create_direct",
  "conversations.read",
  "conversations.manage_official",
  "messages.send",
  "messages.edit_own",
  "messages.delete_own",
  "messages.react",
  "messages.report",
  "messages.moderate_reported",
  "messages.backup",
  "announcements.read",
  "announcements.publish_class",
  "announcements.publish_department",
  "announcements.publish_college",
  "announcements.manage",
  "notifications.read_own",
  "notifications.preferences",
  "notifications.retry",
  "ai.use",
  "ai.admin",
  "ai.knowledge.manage",
  "ai.usage.read",
];

export const rolePermissions: Record<string, string[]> = {
  SUPER_ADMIN: permissions,
  MAIN_ADMIN: permissions,
  PRINCIPAL: [
    "academic.read",
    "audit.read",
    "attendance.read_college",
    "attendance.staff.manage",
    "attendance.interventions.manage",
    "attendance.export",
    "feedback.read_college",
    "feedback.read_staff",
    "feedback.actions.manage",
    "feedback.export",
    "issues.create",
    "issues.read_all",
    "issues.verify",
    "issues.export",
    "conversations.read",
    "messages.send",
    "announcements.read",
    "announcements.publish_college",
    "notifications.read_own",
    "settings.read",
  ],
  VICE_PRINCIPAL: [
    "academic.read",
    "attendance.read_college",
    "attendance.staff.manage",
    "attendance.interventions.manage",
    "attendance.export",
    "feedback.read_college",
    "feedback.read_staff",
    "feedback.actions.manage",
    "feedback.export",
    "issues.create",
    "issues.read_scope",
    "issues.verify",
    "issues.export",
    "conversations.read",
    "messages.send",
    "announcements.read",
    "announcements.publish_college",
    "notifications.read_own",
  ],
  HOD: [
    "academic.read",
    "attendance.read_department",
    "attendance.staff.manage",
    "attendance.interventions.manage",
    "attendance.correction.approve",
    "attendance.export",
    "feedback.read_department",
    "feedback.read_staff",
    "feedback.actions.manage",
    "feedback.export",
    "issues.create",
    "issues.read_scope",
    "issues.verify",
    "conversations.read",
    "messages.send",
    "announcements.read",
    "announcements.publish_department",
    "notifications.read_own",
  ],
  CLASS_COORDINATOR: [
    "academic.read",
    "attendance.read_class",
    "attendance.correction.request",
    "attendance.correction.approve",
    "attendance.export",
    "issues.create",
    "issues.read_scope",
    "issues.verify",
    "issues.reopen",
    "conversations.read",
    "messages.send",
    "announcements.read",
    "announcements.publish_class",
    "notifications.read_own",
  ],
  FACULTY: [
    "academic.read",
    "attendance.read_class",
    "attendance.session.create",
    "attendance.mark",
    "attendance.submit",
    "attendance.correction.request",
    "feedback.read_staff",
    "issues.create",
    "issues.read_own",
    "issues.subscribe",
    "conversations.create_direct",
    "conversations.read",
    "messages.send",
    "messages.edit_own",
    "announcements.read",
    "notifications.read_own",
  ],
  CLASS_REPRESENTATIVE: [
    "academic.read",
    "attendance.read_class",
    "feedback.scan",
    "feedback.submit",
    "feedback.read_own",
    "issues.create",
    "issues.read_own",
    "issues.read_scope",
    "issues.subscribe",
    "conversations.read",
    "messages.send",
    "messages.edit_own",
    "announcements.read",
    "notifications.read_own",
  ],
  STUDENT: [
    "academic.read",
    "attendance.read_own",
    "feedback.scan",
    "feedback.submit",
    "feedback.read_own",
    "issues.create",
    "issues.read_own",
    "issues.subscribe",
    "issues.reopen",
    "conversations.create_direct",
    "conversations.read",
    "messages.send",
    "messages.edit_own",
    "announcements.read",
    "notifications.read_own",
    "sessions.read_own",
    "sessions.revoke_own",
  ],
  MAINTENANCE_ADMIN: [
    "locations.read",
    "assets.read",
    "issues.create",
    "issues.read_scope",
    "issues.read_assigned",
    "issues.assign",
    "issues.acknowledge",
    "issues.start",
    "issues.update_work",
    "issues.resolve",
    "issues.verify",
    "routing.manage",
    "sla.manage",
    "escalations.manage",
    "conversations.read",
    "messages.send",
    "announcements.read",
    "notifications.read_own",
    "notifications.retry",
  ],
  MAINTENANCE_SUPERVISOR: [
    "locations.read",
    "assets.read",
    "issues.create",
    "issues.read_scope",
    "issues.read_assigned",
    "issues.assign",
    "issues.acknowledge",
    "issues.start",
    "issues.update_work",
    "issues.resolve",
    "issues.verify",
    "conversations.read",
    "messages.send",
    "announcements.read",
    "notifications.read_own",
  ],
  MAINTENANCE_STAFF: [
    "locations.read",
    "assets.read",
    "issues.create",
    "issues.read_assigned",
    "issues.acknowledge",
    "issues.start",
    "issues.update_work",
    "issues.resolve",
    "conversations.read",
    "messages.send",
    "announcements.read",
    "notifications.read_own",
  ],
  ELECTRICIAN: [
    "locations.read",
    "assets.read",
    "issues.create",
    "issues.read_assigned",
    "issues.acknowledge",
    "issues.start",
    "issues.update_work",
    "issues.resolve",
    "conversations.read",
    "messages.send",
    "announcements.read",
    "notifications.read_own",
  ],
  PLUMBER: [
    "locations.read",
    "assets.read",
    "issues.create",
    "issues.read_assigned",
    "issues.acknowledge",
    "issues.start",
    "issues.update_work",
    "issues.resolve",
    "conversations.read",
    "messages.send",
    "announcements.read",
    "notifications.read_own",
  ],
  IT_SUPPORT: [
    "locations.read",
    "assets.read",
    "issues.create",
    "issues.read_assigned",
    "issues.acknowledge",
    "issues.start",
    "issues.update_work",
    "issues.resolve",
    "conversations.read",
    "messages.send",
    "announcements.read",
    "notifications.read_own",
  ],
  LAB_TECHNICIAN: [
    "locations.read",
    "assets.read",
    "issues.create",
    "issues.read_assigned",
    "issues.acknowledge",
    "issues.start",
    "issues.update_work",
    "issues.resolve",
    "conversations.read",
    "messages.send",
    "announcements.read",
    "notifications.read_own",
  ],
  HOUSEKEEPING: [
    "locations.read",
    "issues.create",
    "issues.read_assigned",
    "issues.acknowledge",
    "issues.start",
    "issues.update_work",
    "issues.resolve",
    "conversations.read",
    "messages.send",
    "announcements.read",
    "notifications.read_own",
  ],
  SECURITY: [
    "locations.read",
    "issues.create",
    "issues.read_assigned",
    "issues.acknowledge",
    "issues.start",
    "issues.update_work",
    "issues.resolve",
    "conversations.read",
    "messages.send",
    "announcements.read",
    "notifications.read_own",
  ],
  OTHER_RESPONSIBLE: [
    "locations.read",
    "issues.create",
    "issues.read_assigned",
    "issues.acknowledge",
    "issues.start",
    "issues.update_work",
    "issues.resolve",
    "conversations.read",
    "messages.send",
    "announcements.read",
    "notifications.read_own",
  ],
};
for (const codes of Object.values(rolePermissions)) {
  if (!codes.includes("ai.use")) codes.push("ai.use");
  if (codes.includes("issues.create") && !codes.includes("issues.subscribe"))
    codes.push("issues.subscribe");
  if (codes.includes("messages.send")) {
    for (const code of [
      "messages.delete_own",
      "messages.react",
      "messages.report",
      "messages.backup",
    ])
      if (!codes.includes(code)) codes.push(code);
  }
}

export const roleNames: Record<string, string> = {
  SUPER_ADMIN: "Super Admin",
  MAIN_ADMIN: "Main Admin",
  PRINCIPAL: "Principal",
  VICE_PRINCIPAL: "Vice Principal",
  HOD: "Head of Department",
  CLASS_COORDINATOR: "Class Coordinator",
  FACULTY: "Faculty",
  CLASS_REPRESENTATIVE: "Class Representative",
  STUDENT: "Student",
  MAINTENANCE_ADMIN: "Maintenance Admin",
  MAINTENANCE_SUPERVISOR: "Maintenance Supervisor",
  MAINTENANCE_STAFF: "Maintenance Staff",
  ELECTRICIAN: "Electrician",
  PLUMBER: "Plumber",
  IT_SUPPORT: "IT Support Technician",
  LAB_TECHNICIAN: "Laboratory Technician",
  HOUSEKEEPING: "Housekeeping Staff",
  SECURITY: "Security Staff",
  OTHER_RESPONSIBLE: "Other Responsible Person",
};

async function upsertUser(
  collegeId: string,
  roleIds: Map<string, string>,
  input: {
    id: string;
    name: string;
    email: string;
    role: string;
    password: string;
    resetPassword?: boolean;
    mustChangePassword?: boolean;
  },
) {
  const existing = await prisma.user.findUnique({
    where: {
      collegeId_collegeIdentityId: { collegeId, collegeIdentityId: input.id },
    },
  });
  const user = existing
    ? await prisma.user.update({
        where: { id: existing.id },
        data: {
          fullName: input.name,
          email: input.email,
          normalizedEmail: input.email.toLowerCase(),
          ...(input.mustChangePassword === undefined
            ? {}
            : {
                mustChangePassword: input.mustChangePassword,
                firstLoginCompletedAt: input.mustChangePassword
                  ? null
                  : (existing.firstLoginCompletedAt ?? new Date()),
              }),
        },
      })
    : await prisma.user.create({
        data: {
          collegeId,
          collegeIdentityId: input.id,
          fullName: input.name,
          email: input.email,
          normalizedEmail: input.email.toLowerCase(),
          status: "ACTIVE",
          mustChangePassword: input.mustChangePassword ?? false,
          firstLoginCompletedAt: input.mustChangePassword ?? false ? null : new Date(),
        },
      });
  const credential = await prisma.userCredential.findUnique({
    where: { userId: user.id },
    select: { userId: true },
  });
  if (!credential || input.resetPassword) {
    const passwordHash = await argon2.hash(
      input.password + (process.env.PASSWORD_PEPPER ?? ""),
      { type: argon2.argon2id },
    );
    if (credential)
      await prisma.userCredential.update({
        where: { userId: user.id },
        data: {
          passwordHash,
          passwordChangedAt: new Date(),
          failedAttemptCount: 0,
          lockedUntil: null,
        },
      });
    else
      await prisma.userCredential.create({
        data: { userId: user.id, passwordHash },
      });
  }
  await prisma.userRole.upsert({
    where: {
      userId_roleId: { userId: user.id, roleId: roleIds.get(input.role)! },
    },
    create: { userId: user.id, roleId: roleIds.get(input.role)! },
    update: {},
  });
  const collegeWideRoles = new Set([
    "SUPER_ADMIN",
    "MAIN_ADMIN",
    "PRINCIPAL",
    "VICE_PRINCIPAL",
  ]);
  const scopeType = collegeWideRoles.has(input.role)
    ? "COLLEGE"
    : "ASSIGNED_ISSUES";
  const scopeId = scopeType === "COLLEGE" ? collegeId : null;
  const existingScope = await prisma.userScope.findFirst({
    where: { userId: user.id, scopeType, scopeId },
  });
  if (!existingScope)
    await prisma.userScope.create({
      data: { userId: user.id, scopeType, scopeId },
    });
  return user;
}

async function main() {
  if (
    process.env.NODE_ENV === "production" &&
    process.env.SEED_DEVELOPMENT_DATA !== "true"
  )
    throw new Error("Development seed data is disabled in production.");
  const existingCollege = await prisma.college.findUnique({
    where: { code: developmentCollegeCode },
  });
  const legacyCollege = existingCollege
    ? null
    : await prisma.college.findUnique({ where: { code: "DCC" } });
  const college = existingCollege
    ? await prisma.college.update({
        where: { id: existingCollege.id },
        data: { name: collegeName, timezone: "Asia/Kolkata" },
      })
    : legacyCollege
      ? await prisma.college.update({
          where: { id: legacyCollege.id },
          data: {
            code: developmentCollegeCode,
            name: collegeName,
            timezone: "Asia/Kolkata",
          },
        })
      : await prisma.college.create({
          data: {
            code: developmentCollegeCode,
            name: collegeName,
            timezone: "Asia/Kolkata",
          },
        });
  const mainCampus = await prisma.campus.upsert({
    where: { collegeId_code: { collegeId: college.id, code: "MAIN" } },
    create: { collegeId: college.id, code: "MAIN", name: "Main Campus" },
    update: {},
  });
  const cityCampus = await prisma.campus.upsert({
    where: { collegeId_code: { collegeId: college.id, code: "CITY" } },
    create: {
      collegeId: college.id,
      code: "CITY",
      name: "City Campus",
      sortOrder: 2,
    },
    update: {},
  });
  const deptInputs = [
    ["CSE", "Computer Science & Engineering"],
    ["ECE", "Electronics & Communication"],
    ["ME", "Mechanical Engineering"],
  ] as const;
  const departments = new Map<string, string>();
  for (const [code, name] of deptInputs) {
    const row = await prisma.department.upsert({
      where: { collegeId_code: { collegeId: college.id, code } },
      create: { collegeId: college.id, campusId: mainCampus.id, code, name },
      update: { name },
    });
    departments.set(code, row.id);
  }
  const programme = await prisma.programme.upsert({
    where: {
      departmentId_code: {
        departmentId: departments.get("CSE")!,
        code: "BTECH-CSE",
      },
    },
    create: {
      collegeId: college.id,
      departmentId: departments.get("CSE")!,
      code: "BTECH-CSE",
      name: "B.Tech Computer Science",
      durationYears: 4,
    },
    update: {},
  });
  const year = await prisma.academicYear.upsert({
    where: { collegeId_name: { collegeId: college.id, name: "2026-27" } },
    create: {
      collegeId: college.id,
      name: "2026-27",
      startsOn: new Date("2026-06-01"),
      endsOn: new Date("2027-05-31"),
      isCurrent: true,
    },
    update: { isCurrent: true },
  });
  const semester = await prisma.semester.upsert({
    where: {
      programmeId_academicYearId_number: {
        programmeId: programme.id,
        academicYearId: year.id,
        number: 5,
      },
    },
    create: {
      programmeId: programme.id,
      academicYearId: year.id,
      number: 5,
      name: "Semester 5",
    },
    update: {},
  });
  const sectionA = await prisma.section.upsert({
    where: { semesterId_code: { semesterId: semester.id, code: "A" } },
    create: {
      semesterId: semester.id,
      code: "A",
      name: "CSE 3A",
      capacity: 60,
    },
    update: {},
  });
  const sectionB = await prisma.section.upsert({
    where: { semesterId_code: { semesterId: semester.id, code: "B" } },
    create: {
      semesterId: semester.id,
      code: "B",
      name: "CSE 3B",
      capacity: 60,
    },
    update: {},
  });
  const subject = await prisma.subject.upsert({
    where: { semesterId_code: { semesterId: semester.id, code: "CS501" } },
    create: {
      semesterId: semester.id,
      code: "CS501",
      name: "Database Management Systems",
    },
    update: {},
  });
  await prisma.subject.upsert({
    where: { semesterId_code: { semesterId: semester.id, code: "CS502" } },
    create: {
      semesterId: semester.id,
      code: "CS502",
      name: "Computer Networks",
    },
    update: {},
  });

  for (const code of permissions)
    await prisma.permission.upsert({
      where: { code },
      create: {
        code,
        resource: code.split(".")[0]!,
        action: code.split(".").slice(1).join("."),
        description: code.replaceAll(".", " "),
      },
      update: {},
    });
  const permissionRows = await prisma.permission.findMany();
  const permissionIds = new Map(
    permissionRows.map((row) => [row.code, row.id]),
  );
  const roleIds = new Map<string, string>();
  for (const [code, name] of Object.entries(roleNames)) {
    const role = await prisma.role.upsert({
      where: { collegeId_code: { collegeId: college.id, code } },
      create: { collegeId: college.id, code, name, isSystem: true },
      update: { name, isActive: true },
    });
    roleIds.set(code, role.id);
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({
      data: (rolePermissions[code] ?? []).map((permission) => ({
        roleId: role.id,
        permissionId: permissionIds.get(permission)!,
      })),
    });
  }

  const password = developmentAdminPassword;
  const users = {
    superadmin: await upsertUser(college.id, roleIds, {
      id: "SUPER001",
      name: "Development Super Administrator",
      email: "superadmin@college.local",
      role: "SUPER_ADMIN",
      password,
    }),
    admin: await upsertUser(college.id, roleIds, {
      id: "ADM001",
      name: developmentAdminName,
      email: developmentAdminEmail,
      role: "MAIN_ADMIN",
      password,
      resetPassword: developmentResetAdminPassword,
      mustChangePassword: developmentAdminMustChangePassword,
    }),
    principal: await upsertUser(college.id, roleIds, {
      id: "PRN001",
      name: "Dr. Ravi Narayanan",
      email: "principal@college.local",
      role: "PRINCIPAL",
      password,
    }),
    vice: await upsertUser(college.id, roleIds, {
      id: "VP001",
      name: "Dr. Meera Iyer",
      email: "viceprincipal@college.local",
      role: "VICE_PRINCIPAL",
      password,
    }),
    hod: await upsertUser(college.id, roleIds, {
      id: "HOD-CSE",
      name: "Dr. Farah Khan",
      email: "hod.cse@college.local",
      role: "HOD",
      password,
    }),
    faculty: await upsertUser(college.id, roleIds, {
      id: "FAC101",
      name: "Prof. Arjun Das",
      email: "faculty@college.local",
      role: "FACULTY",
      password,
    }),
    coordinator: await upsertUser(college.id, roleIds, {
      id: "CC-CSE3A",
      name: "Prof. Nisha Paul",
      email: "coordinator@college.local",
      role: "CLASS_COORDINATOR",
      password,
    }),
    student: await upsertUser(college.id, roleIds, {
      id: "STU26001",
      name: "Aarav Nair",
      email: "student@college.local",
      role: "STUDENT",
      password,
    }),
    cr: await upsertUser(college.id, roleIds, {
      id: "STU26002",
      name: "Diya Thomas",
      email: "cr@college.local",
      role: "CLASS_REPRESENTATIVE",
      password,
    }),
    maint: await upsertUser(college.id, roleIds, {
      id: "MNT001",
      name: "Suresh Kumar",
      email: "maintenance@college.local",
      role: "MAINTENANCE_ADMIN",
      password,
    }),
    electrician: await upsertUser(college.id, roleIds, {
      id: "ELEC001",
      name: "Manoj Electrical",
      email: "electrician@college.local",
      role: "ELECTRICIAN",
      password,
    }),
    plumber: await upsertUser(college.id, roleIds, {
      id: "PLMB001",
      name: "Joseph Plumbing",
      email: "plumber@college.local",
      role: "PLUMBER",
      password,
    }),
    it: await upsertUser(college.id, roleIds, {
      id: "IT001",
      name: "Kiran IT Support",
      email: "itsupport@college.local",
      role: "IT_SUPPORT",
      password,
    }),
  };
  for (const [user, designation, departmentId] of [
    [users.principal, "Principal", undefined],
    [users.vice, "Vice Principal", undefined],
    [users.hod, "Head of Department", departments.get("CSE")],
    [users.faculty, "Faculty", departments.get("CSE")],
    [users.coordinator, "Faculty", departments.get("CSE")],
  ] as const)
    await prisma.staffProfile.upsert({
      where: { userId: user.id },
      create: {
        collegeId: college.id,
        userId: user.id,
        departmentId,
        employeeId: user.collegeIdentityId,
        designation,
      },
      update: { collegeId: college.id, departmentId, designation },
    });
  for (const [user, index] of [
    [users.student, 1],
    [users.cr, 2],
  ] as const)
    await prisma.studentProfile.upsert({
      where: { userId: user.id },
      create: {
        collegeId: college.id,
        userId: user.id,
        departmentId: departments.get("CSE")!,
        programmeId: programme.id,
        sectionId: sectionA.id,
        studentId: user.collegeIdentityId,
        admissionYear: 2024,
        rollNumber: `CSE${String(index).padStart(2, "0")}`,
      },
      update: { collegeId: college.id },
    });
  await prisma.facultySubjectAssignment.upsert({
    where: {
      facultyId_subjectId_sectionId_validFrom: {
        facultyId: users.faculty.id,
        subjectId: subject.id,
        sectionId: sectionA.id,
        validFrom: new Date("2026-06-01"),
      },
    },
    create: {
      facultyId: users.faculty.id,
      subjectId: subject.id,
      sectionId: sectionA.id,
      validFrom: new Date("2026-06-01"),
    },
    update: {},
  });
  if (
    !(await prisma.classCoordinatorAssignment.findFirst({
      where: {
        coordinatorId: users.coordinator.id,
        sectionId: sectionA.id,
        isActive: true,
      },
    }))
  )
    await prisma.classCoordinatorAssignment.create({
      data: {
        coordinatorId: users.coordinator.id,
        sectionId: sectionA.id,
        validFrom: new Date("2026-06-01"),
      },
    });
  if (
    !(await prisma.classRepresentativeAssignment.findFirst({
      where: {
        representativeId: users.cr.id,
        sectionId: sectionA.id,
        isActive: true,
      },
    }))
  )
    await prisma.classRepresentativeAssignment.create({
      data: {
        representativeId: users.cr.id,
        sectionId: sectionA.id,
        validFrom: new Date("2026-06-01"),
      },
    });
  for (const user of [users.hod]) {
    if (
      !(await prisma.userScope.findFirst({
        where: {
          userId: user.id,
          scopeType: "DEPARTMENT",
          scopeId: departments.get("CSE"),
        },
      }))
    )
      await prisma.userScope.create({
        data: {
          userId: user.id,
          scopeType: "DEPARTMENT",
          scopeId: departments.get("CSE"),
        },
      });
  }
  for (const user of [users.coordinator, users.cr]) {
    if (
      !(await prisma.userScope.findFirst({
        where: { userId: user.id, scopeType: "SECTION", scopeId: sectionA.id },
      }))
    )
      await prisma.userScope.create({
        data: { userId: user.id, scopeType: "SECTION", scopeId: sectionA.id },
      });
  }

  const blocks: Array<{ id: string; campusId: string; code: string }> = [];
  for (const [campus, code, name] of [
    [mainCampus, "A", "Academic Block A"],
    [mainCampus, "B", "Academic Block B"],
    [cityCampus, "C", "City Academic Block"],
  ] as const) {
    const block = await prisma.block.upsert({
      where: { campusId_code: { campusId: campus.id, code } },
      create: { campusId: campus.id, code, name },
      update: {},
    });
    blocks.push(block);
    for (let level = 0; level < 3; level++) {
      const floor = await prisma.floor.upsert({
        where: { blockId_code: { blockId: block.id, code: `F${level}` } },
        create: {
          blockId: block.id,
          code: `F${level}`,
          name:
            level === 0
              ? "Ground Floor"
              : level === 1
                ? "First Floor"
                : "Second Floor",
          level,
        },
        update: {},
      });
      for (let roomIndex = 1; roomIndex <= 2; roomIndex++) {
        const roomCode = `${code}${level}${roomIndex}0${roomIndex}`;
        await prisma.room.upsert({
          where: { floorId_code: { floorId: floor.id, code: roomCode } },
          create: {
            floorId: floor.id,
            departmentId:
              campus.id === mainCampus.id ? departments.get("CSE") : undefined,
            code: roomCode,
            name:
              roomIndex === 2
                ? `${code} Computer Laboratory ${level + 1}`
                : `${code} Classroom ${level + 1}`,
            roomNumber: `${level}${roomIndex}0${roomIndex}`,
            roomType: roomIndex === 2 ? "LABORATORY" : "CLASSROOM",
            capacity: roomIndex === 2 ? 40 : 60,
          },
          update: {},
        });
      }
    }
  }
  const room101 = await prisma.room.findFirstOrThrow({
    where: {
      floor: { blockId: blocks[0]!.id, level: 1 },
      roomType: "CLASSROOM",
    },
  });
  const assetCategory = await prisma.assetCategory.upsert({
    where: { name: "Electrical Equipment" },
    create: { name: "Electrical Equipment" },
    update: {},
  });
  const fan = await prisma.asset.upsert({
    where: { code: "FAN-A-101-01" },
    create: {
      roomId: room101.id,
      categoryId: assetCategory.id,
      code: "FAN-A-101-01",
      name: "Ceiling Fan 1",
    },
    update: {},
  });

  const categoryInputs: Array<[string, string, string[]]> = [
    [
      "ELECTRICAL",
      "Electrical",
      [
        "Fan not working",
        "Light not working",
        "Switch damaged",
        "Plug point damaged",
        "Power supply unavailable",
        "Loose wire",
        "Electrical burning smell",
        "Other electrical issue",
      ],
    ],
    [
      "PLUMBING",
      "Plumbing",
      [
        "Tap leaking",
        "Pipe leaking",
        "Drain blocked",
        "Toilet not flushing",
        "Other plumbing issue",
      ],
    ],
    [
      "IT",
      "Computer or IT",
      [
        "Computer not starting",
        "Monitor not working",
        "Keyboard or mouse problem",
        "Software not opening",
        "Internet unavailable",
        "Projector not connecting",
        "Printer not working",
        "Other IT issue",
      ],
    ],
    [
      "NETWORK",
      "Network or Wi-Fi",
      [
        "Wi-Fi unavailable",
        "Slow network",
        "Network socket damaged",
        "Other network issue",
      ],
    ],
    [
      "PROJECTOR",
      "Projector or Smart Board",
      [
        "Projector not starting",
        "No display",
        "Smart board not responding",
        "Other display issue",
      ],
    ],
    [
      "FURNITURE",
      "Furniture",
      [
        "Bench damaged",
        "Chair damaged",
        "Table damaged",
        "Cupboard damaged",
        "Podium damaged",
        "Other furniture issue",
      ],
    ],
    ["FAN", "Fan", ["Fan not working", "Fan noisy", "Regulator damaged"]],
    ["LIGHT", "Light", ["Light not working", "Light flickering"]],
    ["AC", "Air Conditioner", ["AC not cooling", "AC leaking"]],
    [
      "LAB",
      "Laboratory Equipment",
      ["Equipment not working", "Calibration required"],
    ],
    ["CIVIL", "Civil Work", ["Wall crack", "Ceiling damage"]],
    ["DOOR_WINDOW", "Door or Window", ["Lock damaged", "Glass broken"]],
    ["CLEANING", "Cleaning", ["Room cleaning required", "Waste not collected"]],
    ["WATER", "Water Supply", ["No water supply", "Drinking water issue"]],
    ["RESTROOM", "Restroom", ["Restroom cleaning", "Fixture damaged"]],
    ["SAFETY", "Safety", ["Trip hazard", "Unsafe equipment"]],
    ["SECURITY", "Security", ["Access control issue", "Suspicious activity"]],
    ["PROPERTY", "Property Damage", ["College property damaged"]],
    ["FIRE", "Fire Safety", ["Fire extinguisher issue", "Smoke detected"]],
    [
      "AUDIO",
      "Audio System",
      ["Microphone not working", "Speaker not working"],
    ],
    ["GENERATOR", "Generator or Power Backup", ["Backup power unavailable"]],
    ["OTHER", "Other", ["Other campus issue"]],
  ];
  const categoryMap = new Map<
    string,
    { id: string; typeIds: Map<string, string> }
  >();
  for (const [code, name, types] of categoryInputs) {
    const category = await prisma.issueCategory.upsert({
      where: { collegeId_code: { collegeId: college.id, code } },
      create: {
        collegeId: college.id,
        code,
        name,
        description: `${name} service requests`,
      },
      update: {},
    });
    const typeIds = new Map<string, string>();
    for (const [index, typeName] of types.entries()) {
      const typeCode = typeName
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, "_")
        .slice(0, 60);
      const type = await prisma.issueType.upsert({
        where: { categoryId_code: { categoryId: category.id, code: typeCode } },
        create: {
          categoryId: category.id,
          code: typeCode,
          name: typeName,
          defaultPriority:
            code === "FIRE" || code === "SAFETY" ? "CRITICAL" : "MEDIUM",
          isOther: typeName.toLowerCase().startsWith("other"),
          sortOrder: index,
        },
        update: {},
      });
      typeIds.set(typeName, type.id);
    }
    categoryMap.set(code, { id: category.id, typeIds });
  }

  const electricalTeam = await prisma.responsibleTeam.upsert({
    where: { collegeId_code: { collegeId: college.id, code: "ELECTRICAL" } },
    create: {
      collegeId: college.id,
      code: "ELECTRICAL",
      name: "Electrical Maintenance",
    },
    update: {},
  });
  const maintenanceTeam = await prisma.responsibleTeam.upsert({
    where: { collegeId_code: { collegeId: college.id, code: "MAINTENANCE" } },
    create: {
      collegeId: college.id,
      code: "MAINTENANCE",
      name: "Central Maintenance",
      isDefaultMaintenance: true,
    },
    update: { isDefaultMaintenance: true },
  });
  const plumbingTeam = await prisma.responsibleTeam.upsert({
    where: { collegeId_code: { collegeId: college.id, code: "PLUMBING" } },
    create: {
      collegeId: college.id,
      code: "PLUMBING",
      name: "Plumbing Maintenance",
    },
    update: {},
  });
  const itTeam = await prisma.responsibleTeam.upsert({
    where: { collegeId_code: { collegeId: college.id, code: "IT_SUPPORT" } },
    create: { collegeId: college.id, code: "IT_SUPPORT", name: "IT Support" },
    update: {},
  });
  for (const [team, user, isPrimary] of [
    [maintenanceTeam, users.maint, true],
    [electricalTeam, users.electrician, true],
    [plumbingTeam, users.plumber, true],
    [itTeam, users.it, true],
  ] as const)
    await prisma.responsibleTeamMember.upsert({
      where: { teamId_userId: { teamId: team.id, userId: user.id } },
      create: { teamId: team.id, userId: user.id, isPrimary },
      update: { isActive: true },
    });
  const rules = [
    [electricalTeam, categoryMap.get("ELECTRICAL")!.id, users.electrician.id],
    [plumbingTeam, categoryMap.get("PLUMBING")!.id, users.plumber.id],
    [itTeam, categoryMap.get("IT")!.id, users.it.id],
  ] as const;
  for (const [team, categoryId, primaryUserId] of rules) {
    const existing = await prisma.issueAssignmentRule.findFirst({
      where: {
        collegeId: college.id,
        categoryId,
        teamId: team.id,
        roomId: null,
      },
    });
    if (!existing)
      await prisma.issueAssignmentRule.create({
        data: {
          collegeId: college.id,
          categoryId,
          teamId: team.id,
          primaryUserId,
          rulePriority: 100,
        },
      });
  }
  const exact = await prisma.issueAssignmentRule.findFirst({
    where: {
      collegeId: college.id,
      roomId: room101.id,
      categoryId: categoryMap.get("ELECTRICAL")!.id,
      issueTypeId: categoryMap
        .get("ELECTRICAL")!
        .typeIds.get("Fan not working"),
    },
  });
  if (!exact)
    await prisma.issueAssignmentRule.create({
      data: {
        collegeId: college.id,
        roomId: room101.id,
        categoryId: categoryMap.get("ELECTRICAL")!.id,
        issueTypeId: categoryMap
          .get("ELECTRICAL")!
          .typeIds.get("Fan not working"),
        teamId: electricalTeam.id,
        primaryUserId: users.electrician.id,
        rulePriority: 1000,
      },
    });
  const slaValues = {
    LOW: [480, 7200],
    MEDIUM: [240, 2880],
    HIGH: [60, 480],
    CRITICAL: [15, 120],
    EMERGENCY: [5, 30],
  } as const;
  for (const [priority, [ack, resolution]] of Object.entries(slaValues))
    await prisma.issueSlaPolicy.upsert({
      where: {
        collegeId_priority: {
          collegeId: college.id,
          priority: priority as keyof typeof slaValues,
        },
      },
      create: {
        collegeId: college.id,
        priority: priority as keyof typeof slaValues,
        acknowledgementMinutes: ack,
        resolutionMinutes: resolution,
      },
      update: { acknowledgementMinutes: ack, resolutionMinutes: resolution },
    });

  const session = await prisma.attendanceSession.upsert({
    where: {
      sectionId_subjectId_sessionDate_periodNumber: {
        sectionId: sectionA.id,
        subjectId: subject.id,
        sessionDate: new Date("2026-07-14"),
        periodNumber: 2,
      },
    },
    create: {
      academicYearId: year.id,
      sectionId: sectionA.id,
      subjectId: subject.id,
      facultyId: users.faculty.id,
      sessionDate: new Date("2026-07-14"),
      periodNumber: 2,
      status: "SUBMITTED",
      submittedAt: new Date(),
    },
    update: {},
  });
  for (const [student, status] of [
    [users.student, "PRESENT"],
    [users.cr, "ON_DUTY"],
  ] as const)
    await prisma.attendanceRecord.upsert({
      where: {
        sessionId_studentUserId: {
          sessionId: session.id,
          studentUserId: student.id,
        },
      },
      create: { sessionId: session.id, studentUserId: student.id, status },
      update: {},
    });

  const sample = await prisma.issue.findUnique({
    where: { issueNumber: "ISS-2026-000001" },
  });
  if (!sample) {
    const issue = await prisma.issue.create({
      data: {
        issueNumber: "ISS-2026-000001",
        collegeId: college.id,
        campusId: mainCampus.id,
        blockId: blocks[0]!.id,
        floorId: room101.floorId,
        roomId: room101.id,
        departmentId: departments.get("CSE"),
        categoryId: categoryMap.get("ELECTRICAL")!.id,
        issueTypeId: categoryMap
          .get("ELECTRICAL")!
          .typeIds.get("Fan not working"),
        assetId: fan.id,
        reporterId: users.student.id,
        title: "Ceiling fan not starting",
        description:
          "The first ceiling fan near the windows does not start even when the regulator is turned up.",
        priority: "MEDIUM",
        status: "ASSIGNED",
        teamId: electricalTeam.id,
        assignedToId: users.electrician.id,
        affectedUserCount: 1,
      },
    });
    await prisma.issueAffectedUser.create({
      data: { issueId: issue.id, userId: users.student.id },
    });
    await prisma.issueStatusHistory.create({
      data: {
        issueId: issue.id,
        newStatus: "ASSIGNED",
        changedById: users.student.id,
        comment: "Development seed issue submitted.",
        requestId: "seed-2026",
      },
    });
    await prisma.issueAssignmentHistory.create({
      data: {
        issueId: issue.id,
        assignedUserId: users.electrician.id,
        assignedTeamId: electricalTeam.id,
        reason: "Exact room and issue type development routing rule.",
      },
    });
  }
  const classConversation = await prisma.conversation.upsert({
    where: { officialKey: `section:${sectionA.id}` },
    create: {
      type: "CLASS_GROUP",
      title: "CSE 3A Official",
      collegeId: college.id,
      officialKey: `section:${sectionA.id}`,
      isOfficial: true,
    },
    update: {},
  });
  await prisma.conversationParticipant.createMany({
    data: [users.student, users.cr, users.faculty, users.coordinator].map(
      (user) => ({ conversationId: classConversation.id, userId: user.id }),
    ),
    skipDuplicates: true,
  });
  if (
    (await prisma.message.count({
      where: { conversationId: classConversation.id },
    })) === 0
  )
    await prisma.message.create({
      data: {
        conversationId: classConversation.id,
        senderId: users.coordinator.id,
        body: "Welcome to the official CSE 3A college conversation. Please keep messages relevant to the class.",
      },
    });
  const announcement = await prisma.announcement.findFirst({
    where: { collegeId: college.id, title: `Welcome to ${collegeName}` },
  });
  if (!announcement) {
    const created = await prisma.announcement.create({
      data: {
        collegeId: college.id,
        authorId: users.admin.id,
        title: `Welcome to ${collegeName}`,
        message:
          "Attendance, campus service issues and official class communication are now available in one secure AVS workspace.",
        priority: "LOW",
        status: "PUBLISHED",
        publishAt: new Date(),
        pinned: true,
      },
    });
    await prisma.announcementAudience.create({
      data: {
        announcementId: created.id,
        scopeType: "COLLEGE",
        scopeId: college.id,
      },
    });
  }
  await prisma.appSetting.upsert({
    where: { collegeId_key: { collegeId: college.id, key: "working_hours" } },
    create: {
      collegeId: college.id,
      key: "working_hours",
      value: {
        timezone: "Asia/Kolkata",
        weekdays: [1, 2, 3, 4, 5, 6],
        startsAt: "09:00",
        endsAt: "17:00",
      },
    },
    update: {},
  });
  await prisma.appSetting.upsert({
    where: {
      collegeId_key: {
        collegeId: college.id,
        key: "attendance.lock_after_minutes",
      },
    },
    create: {
      collegeId: college.id,
      key: "attendance.lock_after_minutes",
      value: 60,
    },
    update: {},
  });
  await prisma.appSetting.upsert({
    where: {
      collegeId_key: {
        collegeId: college.id,
        key: "security.official_email_domains",
      },
    },
    create: {
      collegeId: college.id,
      key: "security.official_email_domains",
      value: {
        domains: (process.env.OFFICIAL_EMAIL_DOMAINS ?? "avsenggcollege.ac.in")
          .split(",")
          .map((domain) => domain.trim().toLowerCase().replace(/^@/, ""))
          .filter(Boolean),
      },
    },
    update: {},
  });
  await prisma.appSetting.upsert({
    where: {
      collegeId_key: {
        collegeId: college.id,
        key: "feedback.settings",
      },
    },
    create: {
      collegeId: college.id,
      key: "feedback.settings",
      value: {
        requiredAttendancePercentage: 75,
        attendanceWarningPercentage: 65,
        attendanceCriticalPercentage: 50,
        defaultSubmissionRule: "ONCE_PER_DAY",
        anonymousMode: true,
        commentsRequired: false,
        staffCanViewComments: false,
        studentIdentityVisibleToManagement: false,
        negativeFeedbackRequiresInvestigation: true,
        emailAlertsEnabled: false,
        whatsAppAlertsEnabled: false,
      },
    },
    update: {},
  });

  const questionGroups = [
    ["STAFF", ["Behaviour", "Communication", "Availability", "Service quality", "Problem resolution", "Professionalism", "Overall rating"]],
    ["HOD", ["Leadership", "Department coordination", "Student support", "Communication", "Academic planning", "Problem resolution", "Overall rating"]],
    ["PRINCIPAL", ["Leadership", "Campus administration", "Student support", "Communication", "Academic planning", "Problem resolution", "Overall rating"]],
    ["VICE_PRINCIPAL", ["Leadership", "Campus administration", "Student support", "Communication", "Academic planning", "Problem resolution", "Overall rating"]],
    ["DEPARTMENT", ["Academic support", "Communication", "Lab support", "Student support", "Department coordination", "Overall satisfaction"]],
    ["BUILDING", ["Cleanliness", "Safety", "Lighting", "Ventilation", "Accessibility", "Drinking water", "Restrooms", "Maintenance", "Overall satisfaction"]],
    ["BLOCK", ["Cleanliness", "Safety", "Lighting", "Ventilation", "Accessibility", "Maintenance", "Overall satisfaction"]],
    ["FLOOR", ["Cleanliness", "Safety", "Lighting", "Restrooms", "Maintenance", "Overall satisfaction"]],
    ["CLASSROOM", ["Cleanliness", "Fan and ventilation", "Lighting", "Seating condition", "Smartboard or projector", "Electrical facilities", "Network availability", "Overall classroom condition"]],
    ["LABORATORY", ["Computer availability", "Equipment condition", "Internet speed", "Software availability", "Lab cleanliness", "Technical assistance", "Safety", "Overall rating"]],
    ["CAMPUS_SERVICE", ["Cleanliness", "Availability", "Behaviour", "Service quality", "Safety", "Overall satisfaction"]],
    ["LIBRARY", ["Book availability", "Reading environment", "Staff support", "Cleanliness", "Digital access", "Overall rating"]],
    ["CANTEEN", ["Food quality", "Cleanliness", "Service speed", "Price fairness", "Seating", "Overall rating"]],
    ["TRANSPORT", ["Punctuality", "Safety", "Cleanliness", "Staff behaviour", "Route convenience", "Overall rating"]],
    ["MAINTENANCE", ["Response time", "Work quality", "Communication", "Cleanliness after work", "Overall rating"]],
    ["SECURITY", ["Behaviour", "Availability", "Campus safety", "Communication", "Overall rating"]],
    ["OFFICE", ["Behaviour", "Communication", "Document support", "Queue management", "Overall rating"]],
  ] as const;
  for (const [targetType, categories] of questionGroups) {
    for (const [index, category] of categories.entries()) {
      const existing = await prisma.feedbackQuestion.findFirst({
        where: { collegeId: college.id, targetType, category },
        select: { id: true },
      });
      const questionText =
        category === "Overall rating"
          ? "Overall rating"
          : `Rate ${category.toLowerCase()}`;
      if (existing) {
        await prisma.feedbackQuestion.update({
          where: { id: existing.id },
          data: { questionText, displayOrder: index + 1, isActive: true },
        });
      } else {
        await prisma.feedbackQuestion.create({
          data: {
            collegeId: college.id,
            targetType,
            category,
            questionText,
            displayOrder: index + 1,
          },
        });
      }
    }
  }
  const cycle = await prisma.feedbackCycle.findFirst({
    where: { collegeId: college.id, cycleName: "2026-27 General Feedback" },
    select: { id: true },
  });
  if (!cycle) {
    await prisma.feedbackCycle.create({
      data: {
        collegeId: college.id,
        cycleName: "2026-27 General Feedback",
        academicYearId: year.id,
        startDate: year.startsOn,
        endDate: year.endsOn,
        submissionRule: "ONCE_PER_DAY",
        anonymousMode: true,
        commentsRequired: false,
        staffCanViewComments: false,
        studentIdentityVisibleToManagement: false,
        negativeFeedbackRequiresInvestigation: true,
        createdById: users.admin.id,
      },
    });
  }
  async function ensureFeedbackQr(targetId: string) {
    const existing = await prisma.feedbackQrCode.findFirst({
      where: { targetId, status: "ACTIVE" },
      select: { id: true },
    });
    if (existing) return;
    const token = newFeedbackToken();
    await prisma.feedbackQrCode.create({
      data: {
        targetId,
        secureTokenHash: feedbackTokenHash(token),
        qrUrl: feedbackUrl(token),
        createdById: users.admin.id,
      },
    });
  }
  async function ensureFeedbackTarget(input: {
    targetType: (typeof questionGroups)[number][0];
    targetName: string;
    description?: string;
    staffUserId?: string;
    departmentId?: string;
    campusId?: string;
    blockId?: string;
    floorId?: string;
    roomId?: string;
    serviceCode?: string;
  }) {
    const existing = await prisma.feedbackTarget.findFirst({
      where: {
        collegeId: college.id,
        targetType: input.targetType,
        ...(input.staffUserId ? { staffUserId: input.staffUserId } : {}),
        ...(input.departmentId ? { departmentId: input.departmentId } : {}),
        ...(input.campusId ? { campusId: input.campusId } : {}),
        ...(input.blockId ? { blockId: input.blockId } : {}),
        ...(input.floorId ? { floorId: input.floorId } : {}),
        ...(input.roomId ? { roomId: input.roomId } : {}),
        ...(input.serviceCode ? { serviceCode: input.serviceCode } : {}),
      },
      select: { id: true },
    });
    const target = existing
      ? await prisma.feedbackTarget.update({
          where: { id: existing.id },
          data: {
            targetName: input.targetName,
            description: input.description,
            isActive: true,
          },
        })
      : await prisma.feedbackTarget.create({
          data: {
            collegeId: college.id,
            targetType: input.targetType,
            targetName: input.targetName,
            description: input.description,
            staffUserId: input.staffUserId,
            departmentId: input.departmentId,
            campusId: input.campusId,
            blockId: input.blockId,
            floorId: input.floorId,
            roomId: input.roomId,
            serviceCode: input.serviceCode,
            createdById: users.admin.id,
          },
        });
    await ensureFeedbackQr(target.id);
  }
  await ensureFeedbackTarget({ targetType: "PRINCIPAL", staffUserId: users.principal.id, targetName: users.principal.fullName, description: "Principal feedback" });
  await ensureFeedbackTarget({ targetType: "VICE_PRINCIPAL", staffUserId: users.vice.id, targetName: users.vice.fullName, description: "Vice Principal feedback" });
  await ensureFeedbackTarget({ targetType: "HOD", staffUserId: users.hod.id, departmentId: departments.get("CSE"), targetName: users.hod.fullName, description: "CSE HOD feedback" });
  await ensureFeedbackTarget({ targetType: "STAFF", staffUserId: users.faculty.id, departmentId: departments.get("CSE"), targetName: users.faculty.fullName, description: "Faculty feedback" });
  await ensureFeedbackTarget({ targetType: "STAFF", staffUserId: users.coordinator.id, departmentId: departments.get("CSE"), targetName: users.coordinator.fullName, description: "Faculty feedback" });
  await ensureFeedbackTarget({ targetType: "DEPARTMENT", departmentId: departments.get("CSE"), targetName: "Computer Science & Engineering", description: "Department feedback" });
  for (const block of blocks) {
    const fullBlock = await prisma.block.findUnique({
      where: { id: block.id },
      include: { campus: { select: { id: true, name: true } }, floors: { include: { rooms: true } } },
    });
    if (!fullBlock) continue;
    await ensureFeedbackTarget({ targetType: "BUILDING", campusId: fullBlock.campusId, blockId: fullBlock.id, targetName: fullBlock.name, description: fullBlock.campus.name });
    await ensureFeedbackTarget({ targetType: "BLOCK", campusId: fullBlock.campusId, blockId: fullBlock.id, targetName: fullBlock.name, description: fullBlock.campus.name });
    for (const floor of fullBlock.floors) {
      await ensureFeedbackTarget({ targetType: "FLOOR", campusId: fullBlock.campusId, blockId: fullBlock.id, floorId: floor.id, targetName: `${fullBlock.name} - ${floor.name}`, description: fullBlock.campus.name });
      for (const room of floor.rooms) {
        await ensureFeedbackTarget({
          targetType: room.roomType === "LABORATORY" ? "LABORATORY" : "CLASSROOM",
          campusId: fullBlock.campusId,
          blockId: fullBlock.id,
          floorId: floor.id,
          roomId: room.id,
          departmentId: room.departmentId ?? undefined,
          targetName: room.name,
          description: room.roomNumber ? `Room ${room.roomNumber}` : undefined,
        });
      }
    }
  }
  for (const [targetType, serviceCode, targetName] of [
    ["LIBRARY", "LIBRARY", "Library"],
    ["CANTEEN", "CANTEEN", "Canteen"],
    ["TRANSPORT", "TRANSPORT", "Transport"],
    ["MAINTENANCE", "MAINTENANCE", "Maintenance services"],
    ["SECURITY", "SECURITY", "Security services"],
    ["OFFICE", "OFFICE", "Office administration"],
    ["CAMPUS_SERVICE", "PLACEMENT", "Placement cell"],
    ["CAMPUS_SERVICE", "TRAINING", "Training cell"],
    ["CAMPUS_SERVICE", "MEDICAL", "Medical room"],
    ["CAMPUS_SERVICE", "DRINKING_WATER", "Drinking water"],
    ["CAMPUS_SERVICE", "RESTROOM", "Restrooms"],
  ] as const) {
    await ensureFeedbackTarget({ targetType, serviceCode, targetName, campusId: mainCampus.id, description: "Campus service feedback" });
  }
  console.info("Development seed complete.");
  console.info(
    `Admin login: ${developmentAdminEmail}; college code: ${developmentCollegeCode}`,
  );
  console.info(
    "Development accounts: superadmin@college.local, student@college.local, faculty@college.local, electrician@college.local",
  );
  console.info(
    developmentResetAdminPassword
      ? "The admin password was refreshed from DEVELOPMENT_ADMIN_PASSWORD."
      : "Existing admin credentials were preserved; set DEVELOPMENT_RESET_ADMIN_PASSWORD=true to refresh them.",
  );
  console.info(
    `Additional section created for scope testing: ${sectionB.name}`,
  );
}

if (require.main === module) {
  void main()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(async () => prisma.$disconnect());
}
