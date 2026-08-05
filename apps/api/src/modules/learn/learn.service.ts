import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import { PrismaService } from "../../database/prisma.service";
import type { AuthPrincipal } from "../../common/http/request-context";
import type { Prisma } from "../../generated/prisma/client";
import {
  CompleteLessonDto,
  CreateCourseAssessmentDto,
  CreateCourseDto,
  CreateCourseLessonDto,
  CreateCourseModuleDto,
  CreateCourseResourceDto,
  RecordLearningProgressDto,
  RunLearningCodeDto,
  SubmitAssessmentDto,
  UpdateCourseDto,
} from "./dto/course.dto";

type LearningQuestion = {
  id: string;
  type: "mcq" | "single_choice" | "multiple_choice" | "true_false" | "fill_blank" | "short_answer" | "code" | "code_output" | "programming_task";
  question: string;
  options?: string[];
  correct?: number | string | boolean | Array<number | string>;
  acceptedAnswers?: string[];
  explanation?: string;
  starterCode?: string;
  expectedKeyword?: string;
  marks: number;
};

type LearningAssessmentPayload = {
  scope?: "lesson" | "final";
  lessonId?: string;
  durationMinutes?: number;
  questions?: LearningQuestion[];
};

type CompilerResult = {
  ok: boolean;
  success: boolean;
  status: "ACCEPTED" | "WRONG_ANSWER" | "COMPILATION_ERROR" | "RUNTIME_ERROR" | "TIME_LIMIT_EXCEEDED" | "MEMORY_LIMIT_EXCEEDED" | "INTERNAL_ERROR";
  stdout: string;
  stderr: string;
  compileOutput: string;
  exitCode: number | null;
  signal: string | null;
  provider: string;
  executionTimeMs: number | null;
  memoryKb: number | null;
};

export const COMPILER_PROVIDER_TIMEOUTS_MS = {
  judge0: 6_000,
  judge0Attempts: 2,
  piston: 7_000,
  pistonAttempts: 2,
} as const;

@Injectable()
export class LearnService {
  private readonly logger = new Logger(LearnService.name);

  constructor(private readonly prisma: PrismaService, @Optional() private readonly config?: ConfigService) {}

  async health() {
    try {
      const [coursesAvailable, resourcesAvailable, assessmentsAvailable] =
        await Promise.all([
          this.prisma.course.count({ where: { status: "PUBLISHED" } }),
          this.prisma.courseResource.count(),
          this.prisma.courseAssessment.count(),
        ]);
      return {
        ok: true,
        service: "AVS Learn Portal",
        backend: "nestjs-postgres",
        database: "connected",
        coursesAvailable,
        resourcesAvailable,
        assessmentsAvailable,
        checkedAt: new Date().toISOString(),
      };
    } catch {
      return {
        ok: false,
        service: "AVS Learn Portal",
        backend: "nestjs-postgres",
        database: "unavailable",
        message: "The Learn database health check is unavailable.",
        checkedAt: new Date().toISOString(),
      };
    }
  }

  async dashboard(user: AuthPrincipal) {
    const [courses, subjects, progress, results] = await Promise.all([
      this.getCourses(user),
      this.getSubjects(user),
      this.getProgress(user),
      this.getResults(user),
    ]);
    const recentResources = await this.recentResources(user);
    return {
      user: {
        id: user.publicId,
        name: user.fullName,
        roles: user.roles,
      },
      totals: {
        courses: courses.length,
        subjects: subjects.length,
        completedLessons: progress.completedLessons,
        assessmentsTaken: results.length,
      },
      subjects,
      courses,
      progress,
      recentResources,
      results,
    };
  }

  async createCourse(user: AuthPrincipal, data: CreateCourseDto) {
    this.requireAuthor(user);
    return this.prisma.course.create({
      data: {
        ...data,
        collegeId: user.collegeId,
        code: data.code.trim().toUpperCase(),
        title: data.title.trim(),
        description: data.description?.trim() || null,
        thumbnailUrl: data.thumbnailUrl?.trim() || null,
      },
    });
  }

  async getCourses(user: AuthPrincipal, departmentId?: string, programmeId?: string) {
    const where = await this.courseWhereForUser(user, departmentId, programmeId);
    const courses = await this.prisma.course.findMany({
      where,
      include: {
        department: true,
        programme: true,
        modules: {
          select: {
            _count: { select: { lessons: true } },
          },
        },
        _count: {
          select: {
            modules: true,
            resources: true,
            assessments: true,
            studentProgress: { where: { studentId: user.id } },
          },
        },
      },
      orderBy: [{ status: "asc" }, { title: "asc" }],
    });
    return courses.map((course) => ({
      ...course,
      lessonCount: course.modules.reduce((total, module) => total + module._count.lessons, 0),
    }));
  }

  async getCourseById(user: AuthPrincipal, courseId: string) {
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
      include: {
        resources: { orderBy: [{ type: "asc" }, { title: "asc" }] },
        modules: {
          include: {
            lessons: {
              orderBy: { sortOrder: 'asc' },
            },
            resources: { orderBy: [{ type: "asc" }, { title: "asc" }] },
          },
          orderBy: { sortOrder: 'asc' },
        },
        assessments: { orderBy: [{ type: "asc" }, { title: "asc" }] },
        studentProgress: { where: { studentId: user.id } },
        assessmentResults: { where: { studentId: user.id } },
      },
    });

    if (!course || course.collegeId !== user.collegeId || !(await this.canReadCourse(user, course))) {
      throw new NotFoundException('Course not found');
    }

    return {
      ...course,
      assessments: course.assessments
        .filter((assessment) => this.canAuthor(user) || assessment.status === "PUBLISHED")
        .map((assessment) => this.publicAssessment(assessment)),
    };
  }

  async getSubjects(user: AuthPrincipal) {
    const where = await this.subjectWhere(user);
    const subjects = await this.prisma.subject.findMany({
      where,
      include: {
        semester: {
          include: {
            programme: { include: { department: true } },
          },
        },
        facultyAssignments: {
          where: { isActive: true },
          include: { faculty: { select: { publicId: true, fullName: true, email: true } }, section: true },
        },
      },
      orderBy: [{ semester: { number: "asc" } }, { code: "asc" }],
    });
    const courses = await this.getCourses(user);
    return subjects.map((subject) => ({
      ...subject,
      availableCourses: courses.filter((course) => this.courseMatchesSubject(course, subject)),
    }));
  }

  async getSubjectById(user: AuthPrincipal, subjectId: string) {
    const subject = await this.prisma.subject.findFirst({
      where: { id: subjectId, AND: [await this.subjectWhere(user)] },
      include: {
        semester: {
          include: {
            programme: { include: { department: true } },
          },
        },
        facultyAssignments: {
          where: { isActive: true },
          include: { faculty: { select: { publicId: true, fullName: true, email: true } }, section: true },
        },
      },
    });
    if (!subject) throw new NotFoundException("Subject not found");
    const courses = await this.getCourses(user, subject.semester.programme.departmentId, subject.semester.programmeId);
    return {
      ...subject,
      availableCourses: courses.filter((course) => this.courseMatchesSubject(course, subject)),
    };
  }

  async getSubjectResources(user: AuthPrincipal, subjectId: string) {
    const subject = await this.getSubjectById(user, subjectId);
    const courseIds = subject.availableCourses.map((course) => course.id);
    const courseResources = courseIds.length
      ? await this.prisma.courseResource.findMany({
          where: { courseId: { in: courseIds } },
          include: {
            course: { select: { id: true, code: true, title: true } },
            module: true,
          },
          orderBy: [{ type: "asc" }, { title: "asc" }],
        })
      : [];
    const subjectResources = await this.prisma.subjectResource.findMany({
      where: {
        subjectId,
        archivedAt: null,
        ...(await this.subjectResourceVisibilityWhere(user)),
      },
      include: {
        uploadedBy: { select: { publicId: true, fullName: true } },
        targetSections: {
          include: { section: { select: { id: true, code: true, name: true } } },
        },
        _count: { select: { views: true } },
      },
      orderBy: [{ publishAt: "desc" }, { createdAt: "desc" }],
    });
    return {
      courseResources,
      subjectResources: subjectResources.map((resource) =>
        this.publicSubjectResource(resource),
      ),
    };
  }

  async getModelPapers(user: AuthPrincipal, subjectId?: string) {
    const subjectWhere = await this.subjectWhere(user);
    const papers = await this.prisma.modelQuestionPaper.findMany({
      where: {
        ...(subjectId ? { subjectId } : {}),
        subject: subjectWhere,
        archivedAt: null,
        ...(await this.subjectResourceVisibilityWhere(user)),
      },
      include: {
        subject: {
          select: {
            id: true,
            code: true,
            name: true,
            semester: { select: { number: true } },
          },
        },
        uploadedBy: { select: { publicId: true, fullName: true } },
        targetSections: {
          include: { section: { select: { id: true, code: true, name: true } } },
        },
      },
      orderBy: [{ publishAt: "desc" }, { createdAt: "desc" }],
    });
    const now = new Date();
    return papers.map((paper) => {
      const {
        storageKey: _storageKey,
        answerKeyStorageKey: _answerKeyStorageKey,
        sha256: _sha256,
        ...safePaper
      } = paper;
      return {
        ...safePaper,
        fileSize: paper.fileSize.toString(),
        answerKeyAvailable:
          Boolean(paper.answerKeyStorageKey) &&
          Boolean(
            paper.answerKeyReleaseAt && paper.answerKeyReleaseAt <= now,
          ),
      };
    });
  }

  async getSyllabus(user: AuthPrincipal, courseId?: string) {
    if (courseId) {
      const course = await this.getCourseById(user, courseId);
      return {
        courseId: course.id,
        code: course.code,
        title: course.title,
        modules: course.modules.map((module) => ({
          id: module.id,
          title: module.title,
          description: module.description,
          sortOrder: module.sortOrder,
          lessons: module.lessons,
          resources: module.resources,
        })),
      };
    }
    const courses = await this.getCourses(user);
    return courses.map((course) => ({
      courseId: course.id,
      code: course.code,
      title: course.title,
      status: course.status,
      moduleCount: course._count.modules,
      resourceCount: course._count.resources,
      assessmentCount: course._count.assessments,
    }));
  }

  async getModuleById(user: AuthPrincipal, moduleId: string) {
    const courseWhere = await this.courseWhereForUser(user);
    const module = await this.prisma.courseModule.findFirst({
      where: {
        id: moduleId,
        course: courseWhere,
      },
      include: {
        course: { select: { id: true, code: true, title: true, status: true } },
        lessons: { orderBy: { sortOrder: "asc" } },
        resources: { orderBy: [{ type: "asc" }, { title: "asc" }] },
      },
    });
    if (!module) throw new NotFoundException("Course module not found");
    return module;
  }

  async getLessonById(user: AuthPrincipal, lessonId: string) {
    const courseWhere = await this.courseWhereForUser(user);
    const lesson = await this.prisma.courseLesson.findFirst({
      where: {
        id: lessonId,
        module: {
          course: courseWhere,
        },
      },
      include: {
        module: { include: { course: { select: { id: true, code: true, title: true, status: true } } } },
        progress: { where: { studentId: user.id } },
      },
    });
    if (!lesson) throw new NotFoundException("Course lesson not found");
    return lesson;
  }

  async updateCourse(user: AuthPrincipal, courseId: string, data: UpdateCourseDto) {
    await this.requireCourseForAuthor(user, courseId);

    return this.prisma.course.update({
      where: { id: courseId },
      data: {
        ...(data.title !== undefined ? { title: data.title.trim() } : {}),
        ...(data.description !== undefined
          ? { description: data.description?.trim() || null }
          : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.thumbnailUrl !== undefined
          ? { thumbnailUrl: data.thumbnailUrl?.trim() || null }
          : {}),
      },
    });
  }

  async createModule(
    user: AuthPrincipal,
    courseId: string,
    data: CreateCourseModuleDto,
  ) {
    await this.requireCourseForAuthor(user, courseId);
    return this.prisma.courseModule.create({
      data: {
        courseId,
        title: data.title.trim(),
        description: data.description?.trim() || null,
        sortOrder: data.sortOrder ?? 0,
      },
    });
  }

  async createLesson(
    user: AuthPrincipal,
    courseId: string,
    moduleId: string,
    data: CreateCourseLessonDto,
  ) {
    const module = await this.prisma.courseModule.findFirst({
      where: { id: moduleId, courseId, course: { collegeId: user.collegeId } },
      select: { id: true },
    });
    if (!module) throw new NotFoundException("Course module not found");
    this.requireAuthor(user);
    return this.prisma.courseLesson.create({
      data: {
        moduleId,
        title: data.title.trim(),
        content: data.content?.trim() || null,
        videoUrl: data.videoUrl?.trim() || null,
        sortOrder: data.sortOrder ?? 0,
      },
    });
  }

  async createResource(
    user: AuthPrincipal,
    courseId: string,
    data: CreateCourseResourceDto,
  ) {
    await this.requireCourseForAuthor(user, courseId);
    if (data.moduleId) {
      const module = await this.prisma.courseModule.findFirst({
        where: { id: data.moduleId, courseId },
        select: { id: true },
      });
      if (!module) throw new NotFoundException("Course module not found");
    }
    return this.prisma.courseResource.create({
      data: {
        courseId,
        moduleId: data.moduleId,
        title: data.title.trim(),
        description: data.description?.trim() || null,
        type: data.type,
        url: data.url.trim(),
        uploadedById: user.id,
      },
    });
  }

  async createAssessment(
    user: AuthPrincipal,
    courseId: string,
    data: CreateCourseAssessmentDto,
  ) {
    await this.requireCourseForAuthor(user, courseId);
    const payload = this.assessmentPayload(data.questionsJson);
    this.validateAssessmentQuestions(payload.questions ?? [], data.status === "PUBLISHED");
    const questionCount = data.questionCount ?? Math.max(5, payload.questions?.length ?? 0);
    const maxScore = data.maxScore ?? 100;
    const passPercentage = data.passPercentage ?? (data.passingScore !== undefined ? Math.ceil((data.passingScore / maxScore) * 100) : 60);
    const passingScore = data.passingScore ?? Math.ceil(maxScore * passPercentage / 100);
    if (passingScore > maxScore) throw new BadRequestException("Passing score cannot exceed the maximum score.");
    if (data.passPercentage !== undefined && data.passingScore !== undefined && passingScore !== Math.ceil(maxScore * passPercentage / 100)) {
      throw new BadRequestException("Passing score and pass percentage must describe the same threshold.");
    }
    if (data.status === "PUBLISHED" && (!payload.questions || payload.questions.length < questionCount)) {
      throw new BadRequestException(`Add at least ${questionCount} valid questions before publishing this assessment.`);
    }
    const ids = payload.questions?.map((question) => question.id.trim()).filter(Boolean) ?? [];
    if (ids.length !== new Set(ids).size) throw new BadRequestException("Assessment question IDs must be unique.");
    return this.prisma.courseAssessment.create({
      data: {
        courseId,
        title: data.title.trim(),
        description: data.description?.trim() || null,
        type: data.type ?? "QUIZ",
        maxScore,
        passingScore,
        instructions: data.instructions?.trim() || null,
        questionCount,
        passPercentage,
        timeLimitMinutes: data.timeLimitMinutes,
        maximumAttempts: data.maximumAttempts ?? 3,
        shuffleQuestions: data.shuffleQuestions ?? false,
        shuffleOptions: data.shuffleOptions ?? false,
        showCorrectAnswers: data.showCorrectAnswers ?? false,
        showExplanations: data.showExplanations ?? true,
        status: data.status ?? "DRAFT",
        questionsJson: data.questionsJson as Prisma.InputJsonValue,
      },
    });
  }

  async getProgress(user: AuthPrincipal, courseId?: string) {
    const courseWhere = await this.courseWhereForUser(user);
    const progress = await this.prisma.studentProgress.findMany({
      where: {
        studentId: user.id,
        ...(courseId ? { courseId } : {}),
        course: courseWhere,
      },
      include: {
        course: { select: { id: true, code: true, title: true } },
        lesson: { select: { id: true, title: true, moduleId: true } },
      },
      orderBy: { completedAt: "desc" },
    });
    const lessonCount = courseId
      ? await this.prisma.courseLesson.count({
          where: { module: { courseId, course: { collegeId: user.collegeId } } },
        })
      : 0;
    return {
      completedLessons: progress.length,
      totalLessons: lessonCount,
      percent: lessonCount ? Math.round((progress.length / lessonCount) * 100) : null,
      items: progress,
    };
  }

  async recordProgress(user: AuthPrincipal, data: RecordLearningProgressDto) {
    return this.completeLesson(user, data.courseId, data.lessonId, { completed: data.completed });
  }

  async getBookmarks(user: AuthPrincipal) {
    const courseWhere = await this.courseWhereForUser(user);
    return this.prisma.learningBookmark.findMany({
      where: {
        studentId: user.id,
        lesson: { module: { course: courseWhere } },
      },
      include: {
        lesson: {
          select: {
            id: true,
            title: true,
            module: {
              select: {
                id: true,
                title: true,
                course: { select: { id: true, code: true, title: true } },
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async toggleBookmark(user: AuthPrincipal, lessonId: string) {
    const courseWhere = await this.courseWhereForUser(user);
    const lesson = await this.prisma.courseLesson.findFirst({
      where: { id: lessonId, module: { course: courseWhere } },
      select: { id: true },
    });
    if (!lesson) throw new NotFoundException("Course lesson not found");

    const existing = await this.prisma.learningBookmark.findUnique({
      where: { studentId_lessonId: { studentId: user.id, lessonId } },
      select: { id: true },
    });
    if (existing) {
      await this.prisma.learningBookmark.delete({ where: { id: existing.id } });
      return { bookmarked: false };
    }
    const bookmark = await this.prisma.learningBookmark.create({
      data: { studentId: user.id, lessonId },
    });
    return { bookmarked: true, createdAt: bookmark.createdAt };
  }

  async runCode(user: AuthPrincipal, data: RunLearningCodeDto) {
    const startedAt = Date.now();
    const judge0Result = await this.runWithJudge0(data);
    if (judge0Result) return this.recordCompilerExecution(user, data, judge0Result, startedAt);

    const language = {
      c: "c",
      cpp: "c++",
      java: "java",
      python: "python",
      javascript: "javascript",
    }[data.language];
    if (!language) throw new BadRequestException("Unsupported programming language.");

    const fileName = {
      c: "main.c",
      cpp: "main.cpp",
      java: "Main.java",
      python: "main.py",
      javascript: "main.js",
    }[data.language];

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const response = await fetch("https://emkc.org/api/v2/piston/execute", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
          },
          signal: AbortSignal.timeout(
            COMPILER_PROVIDER_TIMEOUTS_MS.piston,
          ),
          body: JSON.stringify({
            language,
            version: "*",
            files: [{ name: fileName, content: data.sourceCode }],
            stdin: data.stdin ?? "",
            args: [],
            run_timeout: 7_000,
            compile_timeout: 8_000,
          }),
        });
        if (!response.ok) {
          if (
            attempt < 2 &&
            (response.status === 408 ||
              response.status === 429 ||
              response.status >= 500)
          ) {
            continue;
          }
          break;
        }
        const result = (await response.json()) as {
          compile?: { stdout?: string; stderr?: string; code?: number };
          run?: {
            stdout?: string;
            stderr?: string;
            output?: string;
            code?: number;
            signal?: string | null;
          };
        };
        const compileOutput = this.normalizedOutput(result.compile?.stderr);
        const stdout = this.normalizedOutput(result.run?.stdout ?? result.run?.output);
        const stderr = this.normalizedOutput(result.run?.stderr);
        const success = !compileOutput && !stderr && (result.run?.code ?? 0) === 0;
        const compilerResult: CompilerResult = {
          ok: success,
          success,
          status: compileOutput ? "COMPILATION_ERROR" : success ? "ACCEPTED" : "RUNTIME_ERROR",
          stdout,
          stderr,
          compileOutput,
          exitCode: result.run?.code ?? result.compile?.code ?? 0,
          signal: result.run?.signal ?? null,
          provider: "piston",
          executionTimeMs: Date.now() - startedAt,
          memoryKb: null,
        };
        return this.recordCompilerExecution(user, data, compilerResult, startedAt);
      } catch {
        if (attempt >= 2) break;
      }
    }
    return this.recordCompilerExecution(user, data, {
      ok: false,
      success: false,
      status: "INTERNAL_ERROR",
      stdout: "",
      stderr:
        "The online compiler is temporarily unavailable. Your code is still saved in this lesson.",
      compileOutput: "",
      exitCode: null,
      signal: null,
      provider: "unavailable",
      executionTimeMs: Date.now() - startedAt,
      memoryKb: null,
    }, startedAt);
  }

  async getAssessments(user: AuthPrincipal, courseId?: string) {
    const courseWhere = await this.courseWhereForUser(user);
    const assessments = await this.prisma.courseAssessment.findMany({
      where: {
        ...(courseId ? { courseId } : {}),
        status: "PUBLISHED",
        course: courseWhere,
      },
      include: {
        course: { select: { id: true, code: true, title: true } },
        results: { where: { studentId: user.id }, orderBy: { completedAt: "desc" }, take: 1 },
      },
      orderBy: [{ type: "asc" }, { title: "asc" }],
    });
    return assessments.map((assessment) => this.publicAssessment(assessment));
  }

  async startAssessment(user: AuthPrincipal, assessmentId: string) {
    const courseWhere = await this.courseWhereForUser(user);
    const assessment = await this.prisma.courseAssessment.findFirst({
      where: {
        id: assessmentId,
        course: courseWhere,
      },
      include: { course: { select: { id: true, code: true, title: true } } },
    });
    if (!assessment) throw new NotFoundException("Assessment not found");
    if (assessment.status !== "PUBLISHED") throw new BadRequestException("This assessment is not published.");
    await this.assertAssessmentUnlocked(user, assessment);
    const now = new Date();
    const current = await this.prisma.assessmentAttempt.findFirst({ where: { studentId: user.id, assessmentId, status: "IN_PROGRESS", OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }, orderBy: { startedAt: "desc" } });
    if (current) {
      const order = this.assessmentOrder(current.questionOrder);
      return { assessment: this.publicAssessment(assessment, order.questionIds, order.optionOrders), attempt: current };
    }
    await this.prisma.assessmentAttempt.updateMany({ where: { studentId: user.id, assessmentId, status: "IN_PROGRESS", expiresAt: { lte: now } }, data: { status: "EXPIRED" } });
    const usedAttempts = await this.prisma.assessmentAttempt.count({ where: { studentId: user.id, assessmentId } });
    if (usedAttempts >= assessment.maximumAttempts) throw new BadRequestException(`Maximum attempts reached (${assessment.maximumAttempts}).`);
    const payload = this.assessmentPayload(assessment.questionsJson);
    let questionIds = (payload.questions ?? []).map((question) => question.id);
    if (assessment.shuffleQuestions) questionIds = this.shuffled(questionIds);
    questionIds = questionIds.slice(0, Math.min(assessment.questionCount, questionIds.length));
    if (!questionIds.length) throw new BadRequestException("This assessment has no published questions.");
    const optionOrders = assessment.shuffleOptions ? Object.fromEntries((payload.questions ?? []).filter((question) => questionIds.includes(question.id) && question.options?.length).map((question) => [question.id, this.shuffled(question.options!.map((_option, index) => index))])) : {};
    const storedOrder: Prisma.InputJsonValue = Object.keys(optionOrders).length ? { questionIds, optionOrders } : questionIds;
    let attempt;
    try {
      attempt = await this.prisma.assessmentAttempt.create({ data: { studentId: user.id, courseId: assessment.courseId, assessmentId, attemptNumber: usedAttempts + 1, questionOrder: storedOrder, expiresAt: assessment.timeLimitMinutes ? new Date(now.getTime() + assessment.timeLimitMinutes * 60_000) : null } });
    } catch (error) {
      if ((error as { code?: string }).code !== "P2002") throw error;
      attempt = await this.prisma.assessmentAttempt.findFirst({ where: { studentId: user.id, assessmentId, status: "IN_PROGRESS", OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }, orderBy: { startedAt: "desc" } });
      if (!attempt) throw new BadRequestException("Another assessment attempt was started. Refresh and continue that attempt.");
    }
    return {
      assessment: this.publicAssessment(assessment, questionIds, optionOrders),
      attempt: { ...attempt, mode: "server-graded" },
    };
  }

  async submitAssessment(user: AuthPrincipal, assessmentId: string, data: SubmitAssessmentDto) {
    const courseWhere = await this.courseWhereForUser(user);
    const assessment = await this.prisma.courseAssessment.findFirst({
      where: {
        id: assessmentId,
        course: courseWhere,
      },
      include: { course: { select: { id: true, code: true, title: true } } },
    });
    if (!assessment) throw new NotFoundException("Assessment not found");
    if (assessment.status !== "PUBLISHED") throw new BadRequestException("This assessment is not published.");
    await this.assertAssessmentUnlocked(user, assessment);
    const attempt = await this.prisma.assessmentAttempt.findFirst({ where: { ...(data.attemptId ? { id: data.attemptId } : {}), studentId: user.id, assessmentId, status: "IN_PROGRESS" }, orderBy: { startedAt: "desc" } });
    if (!attempt) throw new BadRequestException("Start a new assessment attempt before submitting answers.");
    if (attempt.expiresAt && attempt.expiresAt < new Date()) {
      await this.prisma.assessmentAttempt.update({ where: { id: attempt.id }, data: { status: "EXPIRED" } });
      throw new BadRequestException("The assessment time limit has expired.");
    }
    const order = this.assessmentOrder(attempt.questionOrder);
    const payload = this.assessmentPayload(assessment.questionsJson);
    const selectedAssessment = { ...assessment, questionsJson: { ...payload, questions: this.orderedQuestions(payload.questions ?? [], order.questionIds, order.optionOrders) } };
    const baseScore = this.gradeAssessment(selectedAssessment, data.answersJson);
    const practiceBonus =
      assessment.type === "EXAM"
        ? await this.practiceBonus(user.id, assessment.courseId)
        : 0;
    const score = Math.min(assessment.maxScore, baseScore + practiceBonus);
    const result = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.assessmentAttempt.updateMany({ where: { id: attempt.id, status: "IN_PROGRESS" }, data: { status: "SUBMITTED", answersJson: data.answersJson as Prisma.InputJsonValue, submittedAt: new Date() } });
      if (claimed.count !== 1) throw new BadRequestException("This assessment attempt has already been submitted.");
      return tx.assessmentResult.create({ data: {
        studentId: user.id,
        courseId: assessment.courseId,
        assessmentId: assessment.id,
        attemptId: attempt.id,
        score,
        passed: score >= assessment.passingScore,
        answersJson: data.answersJson as Prisma.InputJsonValue,
      } });
    });
    const certificate =
      result.passed && assessment.type === "EXAM"
        ? await this.issueCertificate(user, assessment.courseId, result.id, result.score)
        : null;
    const review = this.assessmentPayload(selectedAssessment.questionsJson).questions?.map((question) => ({
      id: question.id,
      question: question.question,
      submittedAnswer: data.answersJson[question.id],
      ...(assessment.showCorrectAnswers ? { correctAnswer: question.correct } : {}),
      ...(assessment.showExplanations && question.explanation ? { explanation: question.explanation } : {}),
    })) ?? [];
    return {
      ...result,
      baseScore,
      practiceBonus,
      certificate,
      review,
    };
  }

  async getResults(user: AuthPrincipal) {
    return this.prisma.assessmentResult.findMany({
      where: {
        studentId: user.id,
        course: { collegeId: user.collegeId },
      },
      include: {
        course: { select: { id: true, code: true, title: true } },
        assessment: { select: { id: true, title: true, type: true, maxScore: true, passingScore: true } },
      },
      orderBy: { completedAt: "desc" },
    });
  }

  async getCertificates(user: AuthPrincipal) {
    const items = await this.prisma.learningCertificate.findMany({
      where: {
        studentId: user.id,
        course: { collegeId: user.collegeId },
      },
      include: {
        course: { select: { id: true, code: true, title: true } },
      },
      orderBy: { issuedAt: "desc" },
    });
    const courses = await this.prisma.course.findMany({
      where: {
        collegeId: user.collegeId,
        status: "PUBLISHED",
        modules: { some: {} },
      },
      include: {
        modules: { include: { lessons: true } },
        studentProgress: { where: { studentId: user.id } },
        assessments: { include: { results: { where: { studentId: user.id } } } },
      },
      orderBy: { title: "asc" },
    });
    const eligible = courses.filter((course) => {
      const lessonIds = course.modules.flatMap((module) => module.lessons.map((lesson) => lesson.id));
      const completedLessons = new Set(course.studentProgress.map((item) => item.lessonId));
      const allLessonsDone = lessonIds.length > 0 && lessonIds.every((lessonId) => completedLessons.has(lessonId));
      const finalAssessments = course.assessments.filter((assessment) => assessment.type === "EXAM");
      const finalPassed = finalAssessments.some((assessment) =>
        assessment.results.some((result) => result.passed),
      );
      return allLessonsDone && finalPassed;
    });
    return {
      items,
      eligibleCourses: eligible.map((course) => ({
        courseId: course.id,
        code: course.code,
        title: course.title,
        eligibleSince: new Date().toISOString(),
      })),
      message: items.length
        ? "Your AVS Learn certificates are ready to download."
        : "Complete every lesson and pass the final exam with at least 60 marks to earn a certificate.",
    };
  }

  async downloadCertificate(user: AuthPrincipal, certificateId: string) {
    const certificate = await this.prisma.learningCertificate.findFirst({
      where: {
        id: certificateId,
        studentId: user.id,
        course: { collegeId: user.collegeId },
      },
      include: {
        course: { select: { title: true, code: true } },
      },
    });
    if (!certificate) throw new NotFoundException("Certificate not found");
    const college = await this.prisma.college.findUnique({
      where: { id: user.collegeId },
      select: { name: true },
    });
    return this.certificatePdf({
      collegeName: college?.name ?? "AVS Engineering College",
      studentName: user.fullName,
      courseTitle: certificate.course.title,
      courseCode: certificate.course.code,
      score: certificate.score,
      certificateNumber: certificate.certificateNumber,
      issuedAt: certificate.issuedAt,
    });
  }

  async verifyCertificate(certificateNumber: string) {
    const normalized = certificateNumber.trim().toUpperCase();
    if (!/^[A-Z0-9-]{4,60}$/.test(normalized)) throw new NotFoundException("Certificate not found");
    const certificate = await this.prisma.learningCertificate.findUnique({
      where: { certificateNumber: normalized },
      include: { course: { select: { code: true, title: true, college: { select: { name: true } } } } },
    });
    if (!certificate) throw new NotFoundException("Certificate not found");
    const student = await this.prisma.user.findUnique({ where: { id: certificate.studentId }, select: { fullName: true } });
    return { valid: true, certificateNumber: certificate.certificateNumber, studentName: student?.fullName ?? "AVS learner", course: certificate.course, score: certificate.score, issuedAt: certificate.issuedAt };
  }

  async adminDashboard(user: AuthPrincipal) {
    this.requireAdmin(user);
    const [courses, modules, lessons, resources, assessments, progressEvents, results] =
      await Promise.all([
        this.prisma.course.count({ where: { collegeId: user.collegeId } }),
        this.prisma.courseModule.count({ where: { course: { collegeId: user.collegeId } } }),
        this.prisma.courseLesson.count({ where: { module: { course: { collegeId: user.collegeId } } } }),
        this.prisma.courseResource.count({ where: { course: { collegeId: user.collegeId } } }),
        this.prisma.courseAssessment.count({ where: { course: { collegeId: user.collegeId } } }),
        this.prisma.studentProgress.count({ where: { course: { collegeId: user.collegeId } } }),
        this.prisma.assessmentResult.count({ where: { course: { collegeId: user.collegeId } } }),
      ]);
    return { courses, modules, lessons, resources, assessments, progressEvents, results };
  }

  async adminResources(user: AuthPrincipal) {
    this.requireAdmin(user);
    return this.prisma.courseResource.findMany({
      where: { course: { collegeId: user.collegeId } },
      include: { course: { select: { id: true, code: true, title: true } }, module: true },
      orderBy: { createdAt: "desc" },
      take: 250,
    });
  }

  async adminSubjectResources(user: AuthPrincipal) {
    this.requireAdmin(user);
    const resources = await this.prisma.subjectResource.findMany({
      where: {
        subject: {
          semester: { programme: { collegeId: user.collegeId } },
        },
      },
      include: {
        subject: {
          select: {
            id: true,
            code: true,
            name: true,
            semester: {
              select: {
                number: true,
                programme: {
                  select: {
                    name: true,
                    department: { select: { code: true, name: true } },
                  },
                },
              },
            },
          },
        },
        uploadedBy: { select: { publicId: true, fullName: true } },
        targetSections: {
          include: { section: { select: { id: true, code: true, name: true } } },
        },
        _count: { select: { views: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 500,
    });
    return resources.map((resource) => this.publicSubjectResource(resource));
  }

  async setSubjectResourceStatus(
    user: AuthPrincipal,
    resourceId: string,
    status: "PUBLISHED" | "DRAFT" | "ARCHIVED",
  ) {
    this.requireAdmin(user);
    const resource = await this.prisma.subjectResource.findFirst({
      where: {
        id: resourceId,
        subject: {
          semester: { programme: { collegeId: user.collegeId } },
        },
      },
      select: { id: true },
    });
    if (!resource) throw new NotFoundException("Subject resource not found");
    const updated = await this.prisma.subjectResource.update({
      where: { id: resourceId },
      data: {
        status,
        archivedAt: status === "ARCHIVED" ? new Date() : null,
        ...(status === "PUBLISHED" ? { publishAt: new Date() } : {}),
      },
    });
    return this.publicSubjectResource(updated);
  }

  async setModelPaperStatus(
    user: AuthPrincipal,
    paperId: string,
    status: "PUBLISHED" | "DRAFT" | "ARCHIVED",
  ) {
    this.requireAdmin(user);
    const paper = await this.prisma.modelQuestionPaper.findFirst({
      where: {
        id: paperId,
        subject: {
          semester: { programme: { collegeId: user.collegeId } },
        },
      },
      select: { id: true },
    });
    if (!paper) throw new NotFoundException("Model question paper not found");
    const updated = await this.prisma.modelQuestionPaper.update({
      where: { id: paperId },
      data: {
        status,
        archivedAt: status === "ARCHIVED" ? new Date() : null,
        ...(status === "PUBLISHED" ? { publishAt: new Date() } : {}),
      },
    });
    const {
      storageKey: _storageKey,
      answerKeyStorageKey: _answerKeyStorageKey,
      sha256: _sha256,
      ...safePaper
    } = updated;
    return { ...safePaper, fileSize: updated.fileSize.toString() };
  }

  async adminReports(user: AuthPrincipal) {
    this.requireAdmin(user);
    const courses = await this.prisma.course.findMany({
      where: { collegeId: user.collegeId },
      include: {
        _count: {
          select: { modules: true, resources: true, assessments: true, studentProgress: true, assessmentResults: true },
        },
      },
      orderBy: { title: "asc" },
    });
    return { courses };
  }

  async courseAssignments(user: AuthPrincipal) {
    this.requireAdmin(user);
    return this.prisma.facultySubjectAssignment.findMany({
      where: {
        isActive: true,
        subject: { semester: { programme: { department: { collegeId: user.collegeId } } } },
      },
      include: {
        faculty: { select: { publicId: true, fullName: true, email: true } },
        subject: { include: { semester: { include: { programme: { include: { department: true } } } } } },
        section: true,
      },
      orderBy: [{ subject: { code: "asc" } }, { section: { code: "asc" } }],
    });
  }

  async completeLesson(
    user: AuthPrincipal,
    courseId: string,
    lessonId: string,
    data: CompleteLessonDto,
  ) {
    const courseWhere = await this.courseWhereForUser(user);
    const course = await this.prisma.course.findFirst({
      where: {
        ...courseWhere,
        id: courseId,
        modules: { some: { lessons: { some: { id: lessonId } } } },
      },
      select: { id: true },
    });
    if (!course) throw new NotFoundException("Course lesson not found");
    if (data.completed === false) {
      await this.prisma.studentProgress.deleteMany({
        where: { studentId: user.id, courseId, lessonId },
      });
      return { completed: false };
    }
    const progress = await this.prisma.studentProgress.upsert({
      where: { studentId_lessonId: { studentId: user.id, lessonId } },
      create: { studentId: user.id, courseId, lessonId },
      update: { completedAt: new Date() },
    });
    return { completed: true, completedAt: progress.completedAt };
  }

  private publicAssessment<T extends { questionsJson: unknown; showCorrectAnswers?: boolean; showExplanations?: boolean }>(assessment: T, questionOrder?: string[], optionOrders: Record<string, number[]> = {}) {
    const payload = this.assessmentPayload(assessment.questionsJson);
    const selected = this.orderedQuestions(payload.questions ?? [], questionOrder, optionOrders);
    const questions = selected.map(({ correct: _correct, expectedKeyword: _keyword, acceptedAnswers: _answers, explanation: _explanation, ...question }) => question);
    return {
      ...assessment,
      questionsJson: {
        ...payload,
        questions: questions ?? [],
      },
    };
  }

  private jsonStringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  }

  private assessmentOrder(value: unknown): { questionIds: string[]; optionOrders: Record<string, number[]> } {
    if (Array.isArray(value)) return { questionIds: this.jsonStringArray(value), optionOrders: {} };
    if (!value || typeof value !== "object") return { questionIds: [], optionOrders: {} };
    const stored = value as { questionIds?: unknown; optionOrders?: unknown };
    const optionOrders = stored.optionOrders && typeof stored.optionOrders === "object" && !Array.isArray(stored.optionOrders)
      ? Object.fromEntries(Object.entries(stored.optionOrders).filter((entry): entry is [string, number[]] => Array.isArray(entry[1]) && entry[1].every(Number.isInteger)))
      : {};
    return { questionIds: this.jsonStringArray(stored.questionIds), optionOrders };
  }

  private orderedQuestions(questions: LearningQuestion[], questionIds?: string[], optionOrders: Record<string, number[]> = {}): LearningQuestion[] {
    const order = questionIds ? new Map(questionIds.map((id, index) => [id, index])) : null;
    const selected = order ? questions.filter((question) => order.has(question.id)).sort((a, b) => order.get(a.id)! - order.get(b.id)!) : questions;
    return selected.map((question) => {
      const optionOrder = optionOrders[question.id];
      if (!optionOrder?.length || !question.options?.length || optionOrder.length !== question.options.length) return question;
      const remap = (value: number | string) => typeof value === "number" ? optionOrder.indexOf(value) : value;
      return {
        ...question,
        options: optionOrder.map((index) => question.options![index]!),
        correct: Array.isArray(question.correct) ? question.correct.map(remap) : typeof question.correct === "number" ? remap(question.correct) : question.correct,
      };
    });
  }

  private shuffled<T>(items: T[]): T[] {
    const result = [...items];
    for (let index = result.length - 1; index > 0; index -= 1) {
      const swap = randomBytes(4).readUInt32BE(0) % (index + 1);
      const current = result[index]!;
      result[index] = result[swap]!;
      result[swap] = current;
    }
    return result;
  }

  private async runWithJudge0(data: RunLearningCodeDto) {
    const languageId = {
      c: 103,
      cpp: 105,
      java: 91,
      python: 100,
      javascript: 102,
    }[data.language];
    if (!languageId) return null;

    for (
      let attempt = 1;
      attempt <= COMPILER_PROVIDER_TIMEOUTS_MS.judge0Attempts;
      attempt += 1
    ) {
      try {
        const response = await fetch(
          "https://ce.judge0.com/submissions?base64_encoded=true&wait=true",
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              accept: "application/json",
            },
            signal: AbortSignal.timeout(
              COMPILER_PROVIDER_TIMEOUTS_MS.judge0,
            ),
            body: JSON.stringify({
              language_id: languageId,
              source_code: Buffer.from(data.sourceCode, "utf8").toString(
                "base64",
              ),
              stdin: Buffer.from(data.stdin ?? "", "utf8").toString(
                "base64",
              ),
            }),
          },
        );
        if (!response.ok) {
          const transient =
            response.status === 408 ||
            response.status === 429 ||
            response.status >= 500;
          if (
            transient &&
            attempt < COMPILER_PROVIDER_TIMEOUTS_MS.judge0Attempts
          ) {
            continue;
          }
          return null;
        }
        const result = (await response.json()) as {
          stdout?: string | null;
          stderr?: string | null;
          compile_output?: string | null;
          message?: string | null;
          time?: string | null;
          memory?: number | null;
          status?: { id?: number; description?: string };
        };
        const decode = (value?: string | null) =>
          value
            ? this.normalizedOutput(Buffer.from(value, "base64").toString("utf8"))
            : "";
        const stdout = decode(result.stdout);
        const compileError = decode(result.compile_output);
        const stderr = decode(result.stderr) || decode(result.message);
        const status = this.judge0Status(result.status?.id);
        const accepted = status === "ACCEPTED";
        return {
          ok: accepted,
          success: accepted,
          status,
          stdout,
          stderr,
          compileOutput: compileError,
          exitCode: accepted ? 0 : result.status?.id ?? 1,
          signal: null,
          provider: "judge0",
          executionTimeMs: result.time ? Math.round(Number(result.time) * 1000) : null,
          memoryKb: result.memory ?? null,
        } satisfies CompilerResult;
      } catch {
        if (
          attempt >= COMPILER_PROVIDER_TIMEOUTS_MS.judge0Attempts
        ) {
          return null;
        }
      }
    }
    return null;
  }

  private judge0Status(statusId?: number): CompilerResult["status"] {
    if (statusId === 3) return "ACCEPTED";
    if (statusId === 4) return "WRONG_ANSWER";
    if (statusId === 5) return "TIME_LIMIT_EXCEEDED";
    if (statusId === 6) return "COMPILATION_ERROR";
    if (statusId === 12) return "MEMORY_LIMIT_EXCEEDED";
    if (statusId && statusId >= 7 && statusId <= 12) return "RUNTIME_ERROR";
    return "INTERNAL_ERROR";
  }

  private normalizedOutput(value?: string | null): string {
    return (value ?? "").replace(/\r\n?/g, "\n").slice(0, 100_000);
  }

  private async recordCompilerExecution(user: AuthPrincipal, data: RunLearningCodeDto, result: CompilerResult, startedAt: number): Promise<CompilerResult> {
    const executionTimeMs = result.executionTimeMs ?? Date.now() - startedAt;
    const response = { ...result, executionTimeMs };
    try {
      await this.prisma.compilerExecution.create({ data: {
        collegeId: user.collegeId,
        userId: user.id,
        language: data.language,
        sourceHash: createHash("sha256").update(data.sourceCode).digest("hex"),
        sourceLength: data.sourceCode.length,
        stdinLength: data.stdin?.length ?? 0,
        status: result.status,
        stdout: result.stdout || null,
        stderr: result.stderr || null,
        compileOutput: result.compileOutput || null,
        executionTimeMs,
        memoryKb: result.memoryKb,
        provider: result.provider,
        completedAt: new Date(),
      } });
    } catch {
      this.logger.error("Compiler execution audit persistence failed.");
    }
    return response;
  }

  private assessmentPayload(value: unknown): LearningAssessmentPayload {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const payload = value as LearningAssessmentPayload;
    return {
      ...payload,
      questions: Array.isArray(payload.questions) ? payload.questions : [],
    };
  }

  private validateAssessmentQuestions(questions: LearningQuestion[], required: boolean): void {
    if (questions.length > 200) throw new BadRequestException("An assessment can contain at most 200 questions.");
    if (required && !questions.length) throw new BadRequestException("A published assessment must contain questions.");
    const supported = new Set<LearningQuestion["type"]>(["mcq", "single_choice", "multiple_choice", "true_false", "fill_blank", "short_answer", "code", "code_output", "programming_task"]);
    const ids = new Set<string>();
    for (const [index, question] of questions.entries()) {
      const label = `Question ${index + 1}`;
      if (!question || typeof question !== "object") throw new BadRequestException(`${label} is invalid.`);
      if (typeof question.id !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(question.id)) throw new BadRequestException(`${label} must have a safe unique ID.`);
      if (ids.has(question.id)) throw new BadRequestException("Assessment question IDs must be unique.");
      ids.add(question.id);
      if (!supported.has(question.type)) throw new BadRequestException(`${label} has an unsupported question type.`);
      if (typeof question.question !== "string" || question.question.trim().length < 3 || question.question.length > 2_000) throw new BadRequestException(`${label} must contain a question between 3 and 2,000 characters.`);
      if (!Number.isInteger(question.marks) || question.marks < 1 || question.marks > 1_000) throw new BadRequestException(`${label} must have marks between 1 and 1,000.`);
      if (question.explanation !== undefined && (typeof question.explanation !== "string" || question.explanation.length > 4_000)) throw new BadRequestException(`${label} has an invalid explanation.`);
      if (["mcq", "single_choice", "multiple_choice"].includes(question.type)) {
        const options = question.options;
        if (!Array.isArray(options) || options.length < 2 || options.length > 20 || options.some((option) => typeof option !== "string" || !option.trim() || option.length > 500)) {
          throw new BadRequestException(`${label} must have between 2 and 20 valid options.`);
        }
        if (question.type === "multiple_choice") {
          const correct = Array.isArray(question.correct) ? question.correct : [];
          if (!correct.length || correct.some((value) => !Number.isInteger(value) || Number(value) < 0 || Number(value) >= options.length) || new Set(correct.map(Number)).size !== correct.length) {
            throw new BadRequestException(`${label} must have valid unique correct option indexes.`);
          }
        } else if (!Number.isInteger(question.correct) || Number(question.correct) < 0 || Number(question.correct) >= options.length) {
          throw new BadRequestException(`${label} must have a valid correct option index.`);
        }
      }
      if (question.type === "true_false" && ![true, false, "true", "false"].includes(question.correct as boolean | string)) {
        throw new BadRequestException(`${label} must have a true or false answer.`);
      }
      if (["fill_blank", "short_answer", "code_output"].includes(question.type)) {
        const answers = question.acceptedAnswers?.filter((answer) => typeof answer === "string" && answer.trim()) ?? [];
        if (!answers.length && (typeof question.correct !== "string" || !question.correct.trim())) throw new BadRequestException(`${label} must have at least one accepted answer.`);
        if (answers.length > 50 || answers.some((answer) => answer.length > 1_000)) throw new BadRequestException(`${label} has too many or oversized accepted answers.`);
      }
      if (["code", "programming_task"].includes(question.type) && (typeof question.expectedKeyword !== "string" || !question.expectedKeyword.trim() || question.expectedKeyword.length > 200)) {
        throw new BadRequestException(`${label} must define a bounded server-side expected keyword.`);
      }
    }
  }

  private gradeAssessment(
    assessment: { maxScore: number; questionsJson: unknown },
    answers: Record<string, string | number | string[] | number[]>,
  ): number {
    const questions = this.assessmentPayload(assessment.questionsJson).questions ?? [];
    if (!questions.length) {
      throw new BadRequestException("This assessment has no published questions.");
    }

    let earned = 0;
    let available = 0;
    for (const question of questions) {
      const marks = Number.isFinite(question.marks) && question.marks > 0 ? question.marks : 0;
      available += marks;
      const answer = answers[question.id];
      if (["mcq", "single_choice"].includes(question.type) && String(answer) === String(question.correct)) {
        earned += marks;
      }
      if (question.type === "multiple_choice" && Array.isArray(answer) && Array.isArray(question.correct)) {
        const actual = answer.map(String).sort().join("|");
        const expected = question.correct.map(String).sort().join("|");
        if (actual === expected) earned += marks;
      }
      if (question.type === "true_false" && String(answer).toLowerCase() === String(question.correct).toLowerCase()) earned += marks;
      if (["fill_blank", "short_answer", "code_output"].includes(question.type) && typeof answer === "string") {
        const accepted = question.acceptedAnswers?.length ? question.acceptedAnswers : [String(question.correct ?? "")];
        if (accepted.some((expected) => expected.trim().toLowerCase() === answer.trim().toLowerCase())) earned += marks;
      }
      if (["code", "programming_task"].includes(question.type) && typeof answer === "string") {
        const source = answer.trim().toLowerCase();
        const keyword = question.expectedKeyword?.trim().toLowerCase() ?? "";
        const starterLength = question.starterCode?.trim().length ?? 0;
        if (source.length > starterLength + 5 && (!keyword || source.includes(keyword))) {
          earned += marks;
        }
      }
    }
    if (available <= 0) throw new BadRequestException("This assessment has no scorable questions.");
    return Math.min(assessment.maxScore, Math.round((earned / available) * assessment.maxScore));
  }

  private async assertAssessmentUnlocked(
    user: AuthPrincipal,
    assessment: { type: string; courseId: string },
  ) {
    if (assessment.type !== "EXAM") return;
    const [totalLessons, completedLessons] = await Promise.all([
      this.prisma.courseLesson.count({ where: { module: { courseId: assessment.courseId } } }),
      this.prisma.studentProgress.count({
        where: { studentId: user.id, courseId: assessment.courseId },
      }),
    ]);
    if (!totalLessons || completedLessons < totalLessons) {
      throw new BadRequestException(
        `Complete all ${totalLessons} course lessons before starting the final exam.`,
      );
    }
  }

  private async practiceBonus(studentId: string, courseId: string): Promise<number> {
    const results = await this.prisma.assessmentResult.findMany({
      where: {
        studentId,
        courseId,
        assessment: { type: { in: ["CODING", "ASSIGNMENT"] } },
      },
      include: {
        assessment: { select: { id: true, maxScore: true } },
      },
      orderBy: { completedAt: "desc" },
    });
    const latest = new Map<string, { score: number; maxScore: number }>();
    for (const result of results) {
      if (!latest.has(result.assessment.id)) {
        latest.set(result.assessment.id, {
          score: result.score,
          maxScore: result.assessment.maxScore,
        });
      }
    }
    if (!latest.size) return 0;
    const average = [...latest.values()].reduce(
      (total, result) => total + result.score / Math.max(1, result.maxScore),
      0,
    ) / latest.size;
    return Math.round(average * 10);
  }

  private async issueCertificate(
    user: AuthPrincipal,
    courseId: string,
    assessmentResultId: string,
    score: number,
  ) {
    const existing = await this.prisma.learningCertificate.findUnique({
      where: { studentId_courseId: { studentId: user.id, courseId } },
      include: { course: { select: { id: true, code: true, title: true } } },
    });
    if (existing) return existing;
    const certificateNumber = `AVSL-${new Date().getFullYear()}-${randomBytes(5)
      .toString("hex")
      .toUpperCase()}`;
    return this.prisma.learningCertificate.create({
      data: {
        certificateNumber,
        studentId: user.id,
        courseId,
        assessmentResultId,
        score,
      },
      include: { course: { select: { id: true, code: true, title: true } } },
    });
  }

  private async certificatePdf(data: {
    collegeName: string;
    studentName: string;
    courseTitle: string;
    courseCode: string;
    score: number;
    certificateNumber: string;
    issuedAt: Date;
  }): Promise<Buffer> {
    const webUrl = this.config?.get<string>("WEB_URL", "http://localhost:3000")?.replace(/\/$/, "") ?? "http://localhost:3000";
    const verificationUrl = `${webUrl}/certificates/verify/${encodeURIComponent(data.certificateNumber)}`;
    const [logo, building, qr] = await Promise.all([
      this.certificateLogo(webUrl),
      this.certificateImage(this.config?.get<string>("AVS_CERTIFICATE_BUILDING_URL", "https://avsenggcollege.ac.in/NewsEvents/uploads/hero/01-campus-life.jpg") ?? "https://avsenggcollege.ac.in/NewsEvents/uploads/hero/01-campus-life.jpg"),
      QRCode.toBuffer(verificationUrl, { errorCorrectionLevel: "M", margin: 1, width: 220 }),
    ]);
    return new Promise((resolvePdf, reject) => {
      const document = new PDFDocument({ size: "A4", layout: "landscape", margin: 42 });
      const chunks: Buffer[] = [];
      document.on("data", (chunk: Buffer) => chunks.push(chunk));
      document.on("end", () => resolvePdf(Buffer.concat(chunks)));
      document.on("error", reject);
      const width = document.page.width;
      const height = document.page.height;

      if (building) {
        document.save().opacity(0.13).image(building, 30, 30, { fit: [width - 60, height - 60], align: "center", valign: "center" }).restore();
      }
      document.roundedRect(22, 22, width - 44, height - 44, 8).lineWidth(4).strokeColor("#0b3d91").stroke();
      document.roundedRect(34, 34, width - 68, height - 68, 6).lineWidth(1.5).strokeColor("#d4a017").stroke();
      if (logo) document.image(logo, 58, 52, { fit: [82, 82], align: "center", valign: "center" });
      document.fillColor("#0b3d91").font("Helvetica-Bold").fontSize(21).text(data.collegeName, 145, 64, { align: "center", width: width - 290 });
      document.fillColor("#596579").font("Helvetica").fontSize(11).text("AVS LEARN PORTAL · CERTIFICATE OF ACHIEVEMENT", 145, 96, { align: "center", width: width - 290 });
      document.moveTo(150, 124).lineTo(width - 150, 124).lineWidth(1).strokeColor("#d4a017").stroke();
      document.fillColor("#172554").font("Helvetica-Bold").fontSize(32).text("Certificate of Completion", 80, 150, { align: "center", width: width - 160 });
      document.fillColor("#475569").font("Helvetica").fontSize(13).text("This certificate is proudly presented to", 80, 211, { align: "center", width: width - 160 });
      document.fillColor("#0b3d91").font("Helvetica-Bold").fontSize(27).text(data.studentName, 80, 243, { align: "center", width: width - 160 });
      document.fillColor("#334155").font("Helvetica").fontSize(14).text("for successfully completing", 80, 291, { align: "center", width: width - 160 });
      document.fillColor("#172554").font("Helvetica-Bold").fontSize(21).text(data.courseTitle, 100, 322, { align: "center", width: width - 200 });
      document.fillColor("#334155").font("Helvetica").fontSize(12).text(`${data.courseCode}  ·  Final score ${data.score}/100  ·  Issued ${data.issuedAt.toLocaleDateString("en-IN")}`, 100, 360, { align: "center", width: width - 200 });
      document.moveTo(94, 438).lineTo(260, 438).strokeColor("#64748b").stroke().fillColor("#334155").fontSize(10).text("Course Coordinator", 94, 445, { align: "center", width: 166 });
      document.moveTo(width - 330, 438).lineTo(width - 164, 438).strokeColor("#64748b").stroke().fillColor("#334155").fontSize(10).text("Principal / Authorised Signatory", width - 330, 445, { align: "center", width: 166 });
      document.image(qr, width - 136, height - 132, { width: 72, height: 72 });
      document.fillColor("#475569").fontSize(9).text(`Certificate ID: ${data.certificateNumber}`, 60, height - 77, { width: width - 220 });
      document.fillColor("#64748b").fontSize(8).text("Scan the QR code or open the verification page to confirm authenticity.", 60, height - 60, { width: width - 220 });
      document.end();
    });
  }

  private async certificateLogo(webUrl: string): Promise<Buffer | null> {
    for (const path of [resolve(process.cwd(), "apps/web/public/images/avs-logo.png"), resolve(process.cwd(), "../web/public/images/avs-logo.png")]) {
      try { return await readFile(path); } catch { /* try packaged or hosted asset */ }
    }
    return this.certificateImage(`${webUrl}/images/avs-logo.png`);
  }

  private async certificateImage(url: string): Promise<Buffer | null> {
    try {
      const maximumBytes = 8 * 1024 * 1024;
      const response = await fetch(url, { signal: AbortSignal.timeout(8_000), headers: { accept: "image/png,image/jpeg" } });
      const contentType = response.headers.get("content-type") ?? "";
      const contentLength = Number(response.headers.get("content-length") ?? 0);
      if (!response.ok || !["image/png", "image/jpeg"].some((type) => contentType.toLowerCase().startsWith(type)) || contentLength > maximumBytes || !response.body) return null;
      const reader = response.body.getReader();
      const chunks: Buffer[] = [];
      let total = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maximumBytes) {
          await reader.cancel();
          return null;
        }
        chunks.push(Buffer.from(value));
      }
      return total > 0 ? Buffer.concat(chunks, total) : null;
    } catch { return null; }
  }

  private certificatePdfLegacy(data: {
    collegeName: string;
    studentName: string;
    courseTitle: string;
    courseCode: string;
    score: number;
    certificateNumber: string;
    issuedAt: Date;
  }): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const document = new PDFDocument({ size: "A4", layout: "landscape", margin: 48 });
      const chunks: Buffer[] = [];
      document.on("data", (chunk: Buffer) => chunks.push(chunk));
      document.on("end", () => resolve(Buffer.concat(chunks)));
      document.on("error", reject);

      const pageWidth = document.page.width;
      const pageHeight = document.page.height;
      document
        .rect(24, 24, pageWidth - 48, pageHeight - 48)
        .lineWidth(3)
        .strokeColor("#0b3d91")
        .stroke();
      document
        .rect(34, 34, pageWidth - 68, pageHeight - 68)
        .lineWidth(1)
        .strokeColor("#d4a017")
        .stroke();
      document
        .fillColor("#0b3d91")
        .font("Helvetica-Bold")
        .fontSize(22)
        .text(data.collegeName, 60, 76, { align: "center", width: pageWidth - 120 });
      document
        .fillColor("#596579")
        .font("Helvetica")
        .fontSize(12)
        .text("AVS Learn Portal", 60, 110, { align: "center", width: pageWidth - 120 });
      document
        .fillColor("#172554")
        .font("Helvetica-Bold")
        .fontSize(34)
        .text("Certificate of Completion", 60, 154, { align: "center", width: pageWidth - 120 });
      document
        .fillColor("#596579")
        .font("Helvetica")
        .fontSize(14)
        .text("This certificate is presented to", 60, 218, { align: "center", width: pageWidth - 120 });
      document
        .fillColor("#0b3d91")
        .font("Helvetica-Bold")
        .fontSize(28)
        .text(data.studentName, 60, 250, { align: "center", width: pageWidth - 120 });
      document
        .fillColor("#334155")
        .font("Helvetica")
        .fontSize(15)
        .text("for successfully completing", 60, 302, { align: "center", width: pageWidth - 120 });
      document
        .fillColor("#172554")
        .font("Helvetica-Bold")
        .fontSize(22)
        .text(data.courseTitle, 60, 334, { align: "center", width: pageWidth - 120 });
      document
        .fillColor("#334155")
        .font("Helvetica")
        .fontSize(13)
        .text(
          `${data.courseCode}  |  Final score: ${data.score}/100  |  Issued: ${data.issuedAt.toLocaleDateString("en-IN")}`,
          60,
          384,
          { align: "center", width: pageWidth - 120 },
        );
      document
        .fillColor("#596579")
        .fontSize(10)
        .text(`Certificate ID: ${data.certificateNumber}`, 60, pageHeight - 90, {
          align: "center",
          width: pageWidth - 120,
        });
      document.end();
    });
  }

  private async recentResources(user: AuthPrincipal) {
    const courseWhere = await this.courseWhereForUser(user);
    return this.prisma.courseResource.findMany({
      where: { course: courseWhere },
      include: { course: { select: { id: true, code: true, title: true } }, module: true },
      orderBy: { createdAt: "desc" },
      take: 10,
    });
  }

  private async subjectResourceVisibilityWhere(user: AuthPrincipal) {
    if (this.canAuthor(user)) return {};
    const now = new Date();
    if (!user.roles.includes("STUDENT"))
      return {
        status: "PUBLISHED",
        publishAt: { lte: now },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      };
    const profile = await this.prisma.studentProfile.findUnique({
      where: { userId: user.id },
      select: {
        sectionId: true,
        user: { select: { profileCompletionStatus: true } },
      },
    });
    if (!profile || profile.user.profileCompletionStatus !== "VERIFIED")
      return { id: "__no_verified_student_profile__" };
    return {
      status: "PUBLISHED",
      publishAt: { lte: now },
      AND: [
        { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
        {
          OR: [
            { targetSections: { none: {} } },
            { targetSections: { some: { sectionId: profile.sectionId } } },
          ],
        },
      ],
    };
  }

  private publicSubjectResource<
    T extends { fileSize: bigint; storageKey: string; sha256: string },
  >(resource: T) {
    const {
      storageKey: _storageKey,
      sha256: _sha256,
      ...safeResource
    } = resource;
    return { ...safeResource, fileSize: resource.fileSize.toString() };
  }

  private async courseWhereForUser(
    user: AuthPrincipal,
    departmentId?: string,
    programmeId?: string,
  ): Promise<Prisma.CourseWhereInput> {
    const base: Prisma.CourseWhereInput = {
      collegeId: user.collegeId,
      ...(departmentId ? { departmentId } : {}),
      ...(programmeId ? { programmeId } : {}),
    };
    if (this.canAuthor(user)) return base;
    const published: Prisma.CourseWhereInput = { ...base, status: "PUBLISHED" };
    if (!user.roles.includes("STUDENT")) return published;
    const profile = await this.prisma.studentProfile.findUnique({
      where: { userId: user.id },
      select: { departmentId: true, programmeId: true },
    });
    if (!profile) return { id: "__no_student_profile__" };
    return {
      ...published,
      OR: [
        { programmeId: profile.programmeId },
        { departmentId: profile.departmentId, programmeId: null },
        { departmentId: null, programmeId: null },
      ],
    };
  }

  private async canReadCourse(
    user: AuthPrincipal,
    course: { status: string; departmentId: string | null; programmeId: string | null },
  ): Promise<boolean> {
    if (this.canAuthor(user)) return true;
    if (course.status !== "PUBLISHED") return false;
    if (!user.roles.includes("STUDENT")) return true;
    const profile = await this.prisma.studentProfile.findUnique({
      where: { userId: user.id },
      select: { departmentId: true, programmeId: true },
    });
    if (!profile) return false;
    return (
      course.programmeId === profile.programmeId ||
      (course.programmeId === null && course.departmentId === profile.departmentId) ||
      (course.programmeId === null && course.departmentId === null)
    );
  }

  private async subjectWhere(user: AuthPrincipal): Promise<Prisma.SubjectWhereInput> {
    const collegeWhere: Prisma.SubjectWhereInput = {
      semester: { programme: { department: { collegeId: user.collegeId } } },
      isActive: true,
    };
    if (user.roles.includes("STUDENT")) {
      const profile = await this.prisma.studentProfile.findUnique({
        where: { userId: user.id },
        select: { section: { select: { semesterId: true } } },
      });
      if (!profile) return { id: "__no_student_profile__" };
      return { ...collegeWhere, semesterId: profile.section.semesterId };
    }
    if (user.roles.includes("FACULTY")) {
      return {
        ...collegeWhere,
        facultyAssignments: { some: { facultyId: user.id, isActive: true } },
      };
    }
    if (user.roles.includes("HOD")) {
      const profile = await this.prisma.staffProfile.findUnique({
        where: { userId: user.id },
        select: { departmentId: true },
      });
      if (profile?.departmentId) {
        return {
          ...collegeWhere,
          semester: { programme: { departmentId: profile.departmentId } },
        };
      }
    }
    return collegeWhere;
  }

  private courseMatchesSubject(course: { code: string; title: string; departmentId?: string | null; programmeId?: string | null }, subject: { code: string; name: string; semester: { programmeId: string; programme: { departmentId: string } } }) {
    const courseCode = course.code.toLowerCase();
    const courseTitle = course.title.toLowerCase();
    const subjectCode = subject.code.toLowerCase();
    const subjectName = subject.name.toLowerCase();
    return (
      course.programmeId === subject.semester.programmeId ||
      course.departmentId === subject.semester.programme.departmentId ||
      courseCode.includes(subjectCode) ||
      courseTitle.includes(subjectName) ||
      subjectName.includes(courseTitle)
    );
  }

  private async requireCourseForAuthor(user: AuthPrincipal, courseId: string) {
    this.requireAuthor(user);
    const course = await this.prisma.course.findFirst({
      where: { id: courseId, collegeId: user.collegeId },
      select: { id: true },
    });
    if (!course) throw new NotFoundException("Course not found");
  }

  private requireAuthor(user: AuthPrincipal): void {
    if (!this.canAuthor(user)) {
      throw new ForbiddenException("You do not have permission to manage Learn courses.");
    }
  }

  private requireAdmin(user: AuthPrincipal): void {
    if (!this.canAdmin(user)) {
      throw new ForbiddenException("You do not have permission to manage Learn administration.");
    }
  }

  private canAuthor(user: AuthPrincipal): boolean {
    return user.roles.some((role) =>
      [
        "SUPER_ADMIN",
        "MAIN_ADMIN",
        "PRINCIPAL",
        "VICE_PRINCIPAL",
        "HOD",
        "CLASS_COORDINATOR",
        "FACULTY",
      ].includes(role),
    );
  }

  private canAdmin(user: AuthPrincipal): boolean {
    return user.roles.some((role) =>
      ["SUPER_ADMIN", "MAIN_ADMIN", "PRINCIPAL", "VICE_PRINCIPAL"].includes(role),
    );
  }
}
