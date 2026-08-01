import { config } from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import * as argon2 from "argon2";
import { resolve } from "node:path";
import { PrismaClient } from "../src/generated/prisma/client";
import { permissions, roleNames, rolePermissions } from "./seed";

config({ path: resolve(process.cwd(), ".env"), quiet: true });
config({ path: resolve(process.cwd(), "../../.env"), quiet: true });

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for production bootstrap.`);
  return value;
}

if (process.env.NODE_ENV !== "production") {
  throw new Error("Production bootstrap requires NODE_ENV=production.");
}

const databaseUrl = required("DATABASE_URL");
const collegeCode = process.env.DEVELOPMENT_COLLEGE_CODE?.trim() || "6201";
const collegeName =
  process.env.PRODUCTION_COLLEGE_NAME?.trim() || "AVS Engineering College";
const adminIdentity =
  process.env.PRODUCTION_ADMIN_IDENTITY_ID?.trim() || "ADM001";
const adminName =
  process.env.DEVELOPMENT_ADMIN_NAME?.trim() || "Main Administrator";
const adminEmail = required("DEVELOPMENT_ADMIN_EMAIL").toLowerCase();
const adminPassword = required("DEVELOPMENT_ADMIN_PASSWORD");

if (!/^[A-Z0-9_-]{2,30}$/i.test(collegeCode)) {
  throw new Error("DEVELOPMENT_COLLEGE_CODE has an invalid format.");
}
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) {
  throw new Error("DEVELOPMENT_ADMIN_EMAIL must be a valid email address.");
}
if (adminPassword.length < 12) {
  throw new Error(
    "DEVELOPMENT_ADMIN_PASSWORD must contain at least 12 characters.",
  );
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl }),
});

async function main() {
  const college = await prisma.college.upsert({
    where: { code: collegeCode },
    create: {
      code: collegeCode,
      name: collegeName,
      timezone: "Asia/Kolkata",
    },
    update: {
      name: collegeName,
      timezone: "Asia/Kolkata",
      isActive: true,
    },
  });

  for (const code of permissions) {
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
  }

  const permissionRows = await prisma.permission.findMany({
    where: { code: { in: permissions } },
    select: { id: true, code: true },
  });
  const permissionIds = new Map(
    permissionRows.map((permission) => [permission.code, permission.id]),
  );
  const roleIds = new Map<string, string>();

  for (const [code, name] of Object.entries(roleNames)) {
    const role = await prisma.role.upsert({
      where: { collegeId_code: { collegeId: college.id, code } },
      create: {
        collegeId: college.id,
        code,
        name,
        isSystem: true,
      },
      update: { name, isActive: true },
    });
    roleIds.set(code, role.id);
    const mappings = (rolePermissions[code] ?? []).map((permissionCode) => {
      const permissionId = permissionIds.get(permissionCode);
      if (!permissionId) {
        throw new Error(`Unknown permission in role map: ${permissionCode}`);
      }
      return { roleId: role.id, permissionId };
    });
    if (mappings.length > 0) {
      await prisma.rolePermission.createMany({
        data: mappings,
        skipDuplicates: true,
      });
    }
  }

  const mainAdminRoleId = roleIds.get("MAIN_ADMIN");
  if (!mainAdminRoleId) throw new Error("MAIN_ADMIN role was not created.");

  const activeMainAdmin = await prisma.user.findFirst({
    where: {
      collegeId: college.id,
      status: "ACTIVE",
      roles: { some: { roleId: mainAdminRoleId } },
    },
    select: { id: true },
  });
  if (activeMainAdmin) {
    process.stdout.write(
      "Production Main Admin already exists; bootstrap skipped.\n",
    );
    return;
  }

  const matchingUsers = await prisma.user.findMany({
    where: {
      collegeId: college.id,
      OR: [
        { collegeIdentityId: adminIdentity },
        { normalizedEmail: adminEmail },
      ],
    },
    take: 2,
  });
  if (matchingUsers.length > 1) {
    throw new Error(
      "Production admin identity and email belong to different existing users.",
    );
  }

  const existing = matchingUsers[0];
  const admin = existing
    ? await prisma.user.update({
        where: { id: existing.id },
        data: {
          collegeIdentityId: adminIdentity,
          fullName: adminName,
          email: adminEmail,
          normalizedEmail: adminEmail,
          status: "ACTIVE",
          archivedAt: null,
          mustChangePassword: true,
          firstLoginCompletedAt: null,
        },
      })
    : await prisma.user.create({
        data: {
          collegeId: college.id,
          collegeIdentityId: adminIdentity,
          fullName: adminName,
          email: adminEmail,
          normalizedEmail: adminEmail,
          status: "ACTIVE",
          mustChangePassword: true,
        },
      });

  const credential = await prisma.userCredential.findUnique({
    where: { userId: admin.id },
    select: { userId: true },
  });
  if (!credential) {
    const passwordHash = await argon2.hash(
      adminPassword + (process.env.PASSWORD_PEPPER ?? ""),
      { type: argon2.argon2id },
    );
    await prisma.userCredential.create({
      data: { userId: admin.id, passwordHash },
    });
  }

  await prisma.userRole.upsert({
    where: {
      userId_roleId: { userId: admin.id, roleId: mainAdminRoleId },
    },
    create: {
      userId: admin.id,
      roleId: mainAdminRoleId,
      isPrimary: true,
    },
    update: { isPrimary: true, validUntil: null },
  });

  const collegeScope = await prisma.userScope.findFirst({
    where: {
      userId: admin.id,
      scopeType: "COLLEGE",
      scopeId: college.id,
    },
    select: { id: true },
  });
  if (!collegeScope) {
    await prisma.userScope.create({
      data: {
        userId: admin.id,
        scopeType: "COLLEGE",
        scopeId: college.id,
      },
    });
  }

  process.stdout.write(
    `Production Main Admin created for college ${collegeCode}; a password change is required at first login.\n`,
  );
}

void main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
