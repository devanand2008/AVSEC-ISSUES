#!/usr/bin/env node
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { PrismaPg } from "@prisma/adapter-pg";

const root = process.cwd();
const legacyRoot = path.join(root, "learn language", "code-compass-main");
const reportPath = path.join(root, "artifacts", "learning-migration-report.json");
const mode = process.argv.includes("--migrate")
  ? "migrate"
  : process.argv.includes("--rollback")
    ? "rollback"
    : process.argv.includes("--validate")
      ? "validate"
      : "dry-run";

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function writeReport(report) {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}

function collectLegacySnapshot() {
  const syllabus = readJson(path.join(legacyRoot, "server", "data", "syllabusContent.json"), []);
  const ragSyllabus = readJson(path.join(legacyRoot, "study rag", "backend", "syllabus_content.json"), []);
  const admins = readJson(path.join(legacyRoot, "server", "data", "admins.json"), []);
  const uploadDir = path.join(legacyRoot, "study rag", "backend", "uploads");
  const uploadedFiles = fs.existsSync(uploadDir) ? fs.readdirSync(uploadDir).sort() : [];
  const languages = unique(syllabus.map((item) => item.langId));
  const topics = unique(syllabus.map((item) => item.topicId));
  return {
    legacyRoot,
    syllabusItems: syllabus.length,
    ragSyllabusItems: Array.isArray(ragSyllabus) ? ragSyllabus.length : Object.keys(ragSyllabus).length,
    adminUsers: Array.isArray(admins) ? admins.length : Object.keys(admins).length,
    uploadedFiles,
    languages,
    topics,
    items: syllabus,
  };
}

function toCourseCode(langId) {
  return `LEGACY-${String(langId || "LEARN").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "-")}`.slice(0, 60);
}

function toTitle(value) {
  return String(value || "Legacy Lesson")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .slice(0, 180);
}

async function migrateStaticSyllabus(snapshot) {
  const { PrismaClient } = await import(
    pathToFileURL(path.join(root, "apps", "api", "src", "generated", "prisma", "client.ts")).href
  );
  const prisma = prismaClient(PrismaClient);
  const collegeId = process.env.COLLEGE_ID || process.env.AVS_COLLEGE_ID;
  if (!collegeId) {
    throw new Error("Set COLLEGE_ID or AVS_COLLEGE_ID before running --migrate.");
  }
  const grouped = new Map();
  for (const item of snapshot.items) {
    const langId = item.langId || "legacy";
    if (!grouped.has(langId)) grouped.set(langId, []);
    grouped.get(langId).push(item);
  }
  const migrated = [];
  for (const [langId, items] of grouped.entries()) {
    const course = await prisma.course.upsert({
      where: { legacyLearningId: `language:${langId}` },
      create: {
        collegeId,
        legacyLearningId: `language:${langId}`,
        code: toCourseCode(langId),
        title: `${toTitle(langId)} Legacy Learning`,
        description: "Migrated from the legacy learn language portal.",
        status: "PUBLISHED",
      },
      update: {
        title: `${toTitle(langId)} Legacy Learning`,
        description: "Migrated from the legacy learn language portal.",
      },
    });
    const module = await prisma.courseModule.upsert({
      where: { legacyLearningId: `language:${langId}:module:default` },
      create: {
        courseId: course.id,
        legacyLearningId: `language:${langId}:module:default`,
        title: `${toTitle(langId)} Topics`,
        sortOrder: 0,
      },
      update: { title: `${toTitle(langId)} Topics` },
    });
    let lessonCount = 0;
    for (const [index, item] of items.entries()) {
      await prisma.courseLesson.upsert({
        where: { legacyLearningId: `topic:${item._id || item.topicId}` },
        create: {
          moduleId: module.id,
          legacyLearningId: `topic:${item._id || item.topicId}`,
          title: toTitle(item.title || item.topicId),
          content: item.adminContent || null,
          sortOrder: index,
        },
        update: {
          title: toTitle(item.title || item.topicId),
          content: item.adminContent || null,
          sortOrder: index,
        },
      });
      lessonCount += 1;
    }
    migrated.push({ langId, courseId: course.id, moduleId: module.id, lessons: lessonCount });
  }
  await prisma.$disconnect();
  return migrated;
}

async function rollbackStaticSyllabus(snapshot) {
  const { PrismaClient } = await import(
    pathToFileURL(path.join(root, "apps", "api", "src", "generated", "prisma", "client.ts")).href
  );
  const prisma = prismaClient(PrismaClient);
  const legacyIds = snapshot.languages.map((langId) => `language:${langId}`);
  const deleted = await prisma.course.deleteMany({ where: { legacyLearningId: { in: legacyIds } } });
  await prisma.$disconnect();
  return deleted;
}

function prismaClient(PrismaClient) {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required.");
  const max = Number(process.env.DATABASE_POOL_MAX || 20);
  const timeout = Number(process.env.DATABASE_POOL_TIMEOUT || 30);
  return new PrismaClient({
    adapter: new PrismaPg({
      connectionString,
      max,
      connectionTimeoutMillis: timeout * 1000,
      idleTimeoutMillis: timeout * 1000,
    }),
  });
}

async function main() {
  const snapshot = collectLegacySnapshot();
  const report = {
    mode,
    generatedAt: new Date().toISOString(),
    backupPath: path.join(root, "legacy", "learn-language-original-backup"),
    snapshot: {
      legacyRoot: snapshot.legacyRoot,
      syllabusItems: snapshot.syllabusItems,
      ragSyllabusItems: snapshot.ragSyllabusItems,
      adminUsers: snapshot.adminUsers,
      uploadedFiles: snapshot.uploadedFiles,
      languages: snapshot.languages,
      topics: snapshot.topics.length,
    },
    actions: [],
  };

  if (mode === "validate") {
    report.actions.push({ status: "ok", message: "Legacy files are readable and static content was counted." });
  } else if (mode === "migrate") {
    const migrated = await migrateStaticSyllabus(snapshot);
    report.actions.push({ status: "ok", message: "Static syllabus content migrated idempotently.", migrated });
  } else if (mode === "rollback") {
    const deleted = await rollbackStaticSyllabus(snapshot);
    report.actions.push({ status: "ok", message: "Legacy static syllabus courses removed.", deleted });
  } else {
    report.actions.push({
      status: "planned",
      message: "Dry run only. Use --migrate with COLLEGE_ID set to import static syllabus content.",
    });
  }

  writeReport(report);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  writeReport({ mode, generatedAt: new Date().toISOString(), ok: false, error: error.message });
  console.error(error);
  process.exitCode = 1;
});
