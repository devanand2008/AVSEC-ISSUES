import "dotenv/config";
import { createHash } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../apps/api/src/generated/prisma/client";
import { COURSES, type ExamQuestion, type Lesson } from "../learn language/code-compass-main/src/lib/courses";
import { DEFAULT_DIGITAL_COURSES } from "../learn language/code-compass-main/src/data/default-digital-courses";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required.");

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString,
    max: Number(process.env.DATABASE_POOL_MAX || 20),
    connectionTimeoutMillis: Number(process.env.DATABASE_POOL_TIMEOUT || 30) * 1000,
  }),
});

const courses = [...COURSES, ...DEFAULT_DIGITAL_COURSES];

function avsText(value: string | undefined | null): string | null {
  if (!value) return null;
  return value
    .replace(/SL Institution Pro/gi, "AVS Learn Portal")
    .replace(/SL Institution/gi, "AVS Engineering College")
    .replace(/LS Institution/gi, "AVS Engineering College")
    .replace(/\bSLI\b/g, "AVS")
    .replace(/\bSL\b/g, "AVS");
}

function slug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function legacyKey(value: string): string {
  if (value.length <= 120) return value;
  const hash = createHash("sha256").update(value).digest("hex").slice(0, 20);
  return `${value.slice(0, 98)}:${hash}`;
}

function courseCode(id: string): string {
  return `AVSL-${id.toUpperCase().replace(/[^A-Z0-9]+/g, "-")}`.slice(0, 60);
}

function questionMarks(length: number): number[] {
  if (length <= 0) return [];
  const base = Math.floor(100 / length);
  const remainder = 100 - base * length;
  return Array.from({ length }, (_, index) => base + (index < remainder ? 1 : 0));
}

function quizQuestions(lesson: Lesson) {
  const marks = questionMarks(lesson.quiz.length);
  return lesson.quiz.map((question, index) => ({
    id: question.id,
    type: "mcq" as const,
    question: avsText(question.question) ?? question.question,
    options: question.options.map((option) => avsText(option) ?? option),
    correct: question.correct,
    marks: marks[index] ?? 0,
  }));
}

function examQuestions(questions: ExamQuestion[]) {
  return questions.map((question) => ({
    id: question.id,
    type: question.type,
    question: avsText(question.question) ?? question.question,
    options: question.options?.map((option) => avsText(option) ?? option),
    correct: question.correct,
    starterCode: avsText(question.starterCode),
    expectedKeyword: question.expectedKeyword,
    marks: question.marks,
  }));
}

async function upsertCourse(course: (typeof courses)[number], collegeId: string) {
  const catalogId = legacyKey(`catalog:${course.id}`);
  const existing = await prisma.course.findFirst({
    where: {
      collegeId,
      OR: [
        { legacyLearningId: catalogId },
        { legacyLearningId: `language:${course.id}` },
        { code: courseCode(course.id) },
      ],
    },
    select: { id: true },
  });
  const levels = [...new Set(course.lessons.map((lesson) => lesson.level))];
  const data = {
    legacyLearningId: catalogId,
    code: courseCode(course.id),
    title: avsText(course.title) ?? course.title,
    description: avsText(course.description),
    category: avsText(course.category),
    level: levels.join(" to ").slice(0, 60),
    programmingLanguage: course.monacoLang.slice(0, 40),
    status: "PUBLISHED" as const,
  };
  if (existing) {
    return prisma.course.update({ where: { id: existing.id }, data });
  }
  return prisma.course.create({ data: { ...data, collegeId } });
}

async function upsertModule(courseId: string, legacyCourseId: string, level: string, sortOrder: number) {
  const legacyLearningId = legacyKey(`catalog:${legacyCourseId}:module:${slug(level) || "course"}`);
  return prisma.courseModule.upsert({
    where: { legacyLearningId },
    create: {
      courseId,
      legacyLearningId,
      title: `${level} Learning Path`,
      description: `Structured ${level.toLowerCase()} lessons, practice, and assessment.`,
      sortOrder,
    },
    update: {
      courseId,
      title: `${level} Learning Path`,
      description: `Structured ${level.toLowerCase()} lessons, practice, and assessment.`,
      sortOrder,
    },
  });
}

async function upsertLesson(
  course: (typeof courses)[number],
  courseId: string,
  moduleId: string,
  lesson: Lesson,
  sortOrder: number,
) {
  const legacyLearningId = legacyKey(`catalog:${course.id}:lesson:${lesson.id}`);
  const lessonData = {
    moduleId,
    title: avsText(lesson.title) ?? lesson.title,
    content: avsText(lesson.content),
    videoUrl: lesson.videoUrl || null,
    level: lesson.level,
    lessonType: lesson.lessonType || "theory",
    durationMinutes: lesson.durationMinutes || 20,
    exampleCode: avsText(lesson.example),
    programmingLanguage: lesson.language || course.monacoLang,
    practiceJson: {
      instruction: avsText(lesson.assessment?.instruction),
      starterCode: avsText(lesson.assessment?.starterCode),
      marks: lesson.assessment?.marks ?? 20,
    },
    sortOrder,
  };
  const storedLesson = await prisma.courseLesson.upsert({
    where: { legacyLearningId },
    create: { ...lessonData, legacyLearningId },
    update: lessonData,
  });

  if (lesson.quiz.length) {
    const assessmentId = legacyKey(`catalog:${course.id}:lesson:${lesson.id}:quiz`);
    await prisma.courseAssessment.upsert({
      where: { legacyLearningId: assessmentId },
      create: {
        courseId,
        legacyLearningId: assessmentId,
        title: `${lesson.title} Quiz`,
        description: "Lesson knowledge check",
        type: "QUIZ",
        maxScore: 100,
        passingScore: 60,
        questionsJson: {
          scope: "lesson",
          lessonId: storedLesson.id,
          durationMinutes: 10,
          questions: quizQuestions(lesson),
        },
      },
      update: {
        courseId,
        title: `${lesson.title} Quiz`,
        description: "Lesson knowledge check",
        type: "QUIZ",
        maxScore: 100,
        passingScore: 60,
        questionsJson: {
          scope: "lesson",
          lessonId: storedLesson.id,
          durationMinutes: 10,
          questions: quizQuestions(lesson),
        },
      },
    });
  }

  if (lesson.assessment?.instruction) {
    const assessmentId = legacyKey(`catalog:${course.id}:lesson:${lesson.id}:practice`);
    const marks = lesson.assessment.marks || 20;
    await prisma.courseAssessment.upsert({
      where: { legacyLearningId: assessmentId },
      create: {
        courseId,
        legacyLearningId: assessmentId,
        title: `${lesson.title} Practice`,
        description: avsText(lesson.assessment.instruction),
        type: course.monacoLang === "text" ? "ASSIGNMENT" : "CODING",
        maxScore: marks,
        passingScore: Math.ceil(marks * 0.6),
        questionsJson: {
          scope: "lesson",
          lessonId: storedLesson.id,
          durationMinutes: 20,
          questions: [
            {
              id: `${lesson.id}-practice`,
              type: "code",
              question: avsText(lesson.assessment.instruction),
              starterCode: avsText(lesson.assessment.starterCode),
              expectedKeyword: lesson.assessment.expectedKeyword,
              marks,
            },
          ],
        },
      },
      update: {
        courseId,
        title: `${lesson.title} Practice`,
        description: avsText(lesson.assessment.instruction),
        type: course.monacoLang === "text" ? "ASSIGNMENT" : "CODING",
        maxScore: marks,
        passingScore: Math.ceil(marks * 0.6),
        questionsJson: {
          scope: "lesson",
          lessonId: storedLesson.id,
          durationMinutes: 20,
          questions: [
            {
              id: `${lesson.id}-practice`,
              type: "code",
              question: avsText(lesson.assessment.instruction),
              starterCode: avsText(lesson.assessment.starterCode),
              expectedKeyword: lesson.assessment.expectedKeyword,
              marks,
            },
          ],
        },
      },
    });
  }
}

async function upsertFinalExam(course: (typeof courses)[number], courseId: string) {
  const legacyLearningId = legacyKey(`catalog:${course.id}:final-exam`);
  const questions = examQuestions(course.exam);
  return prisma.courseAssessment.upsert({
    where: { legacyLearningId },
    create: {
      courseId,
      legacyLearningId,
      title: `${course.title} Certification Exam`,
      description: "Final 100-mark certification exam. Pass mark: 60.",
      type: "EXAM",
      maxScore: 100,
      passingScore: 60,
      questionsJson: { scope: "final", durationMinutes: 30, questions },
    },
    update: {
      courseId,
      title: `${course.title} Certification Exam`,
      description: "Final 100-mark certification exam. Pass mark: 60.",
      type: "EXAM",
      maxScore: 100,
      passingScore: 60,
      questionsJson: { scope: "final", durationMinutes: 30, questions },
    },
  });
}

async function main() {
  const collegeCode = process.env.DEVELOPMENT_COLLEGE_CODE || process.env.COLLEGE_CODE || "6201";
  const college = await prisma.college.findUnique({
    where: { code: collegeCode },
    select: { id: true, name: true },
  });
  if (!college) throw new Error(`College ${collegeCode} was not found.`);

  let lessonCount = 0;
  let assessmentCount = 0;
  for (const course of courses) {
    const storedCourse = await upsertCourse(course, college.id);
    const levels = [...new Set(course.lessons.map((lesson) => lesson.level))];
    const modules = new Map<string, { id: string }>();
    for (const [index, level] of levels.entries()) {
      modules.set(level, await upsertModule(storedCourse.id, course.id, level, index));
    }
    for (const [index, lesson] of course.lessons.entries()) {
      const module = modules.get(lesson.level);
      if (!module) throw new Error(`Module missing for ${course.id}/${lesson.id}.`);
      await upsertLesson(course, storedCourse.id, module.id, lesson, index);
      lessonCount += 1;
      assessmentCount += lesson.quiz.length ? 1 : 0;
      assessmentCount += lesson.assessment?.instruction ? 1 : 0;
    }
    await upsertFinalExam(course, storedCourse.id);
    assessmentCount += 1;
    console.log(`Migrated ${course.title}: ${course.lessons.length} lessons.`);
  }

  console.log(
    JSON.stringify(
      {
        college: college.name,
        courses: courses.length,
        lessons: lessonCount,
        assessments: assessmentCount,
        source: "legacy AVS Learn catalog",
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
