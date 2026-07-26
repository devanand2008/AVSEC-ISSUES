import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import PDFDocument from "pdfkit";
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
  type: "mcq" | "code";
  question: string;
  options?: string[];
  correct?: number;
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

@Injectable()
export class LearnService {
  constructor(private readonly prisma: PrismaService) {}

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
    } catch (error) {
      return {
        ok: false,
        service: "AVS Learn Portal",
        backend: "nestjs-postgres",
        database: "unavailable",
        message: error instanceof Error ? error.message : "Unknown database error",
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
      assessments: course.assessments.map((assessment) => this.publicAssessment(assessment)),
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
    return this.prisma.courseAssessment.create({
      data: {
        courseId,
        title: data.title.trim(),
        description: data.description?.trim() || null,
        type: data.type ?? "QUIZ",
        maxScore: data.maxScore ?? 100,
        passingScore: data.passingScore ?? 60,
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

  async runCode(_user: AuthPrincipal, data: RunLearningCodeDto) {
    const judge0Result = await this.runWithJudge0(data);
    if (judge0Result) return judge0Result;

    const language = {
      c: "c",
      cpp: "c++",
      java: "java",
      python: "python",
      javascript: "javascript",
      sql: "sqlite3",
    }[data.language];
    if (!language) throw new BadRequestException("Unsupported programming language.");

    const fileName = {
      c: "main.c",
      cpp: "main.cpp",
      java: "Main.java",
      python: "main.py",
      javascript: "main.js",
      sql: "main.sql",
    }[data.language];

    try {
      const response = await fetch("https://emkc.org/api/v2/piston/execute", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        signal: AbortSignal.timeout(20_000),
        body: JSON.stringify({
          language,
          version: "*",
          files: [{ name: fileName, content: data.sourceCode }],
          stdin: data.stdin ?? "",
          args: [],
          run_timeout: 10_000,
          compile_timeout: 15_000,
        }),
      });
      if (!response.ok) {
        throw new Error(`Compiler returned HTTP ${response.status}.`);
      }
      const result = (await response.json()) as {
        compile?: { stdout?: string; stderr?: string; code?: number };
        run?: { stdout?: string; stderr?: string; output?: string; code?: number; signal?: string | null };
      };
      const compileError = result.compile?.stderr?.trim() ?? "";
      const stdout = result.run?.stdout?.trim() ?? result.run?.output?.trim() ?? "";
      const stderr = result.run?.stderr?.trim() ?? "";
      return {
        ok: !compileError && (result.run?.code ?? 0) === 0,
        stdout,
        stderr: compileError || stderr,
        exitCode: result.run?.code ?? result.compile?.code ?? 0,
        signal: result.run?.signal ?? null,
        provider: "piston",
      };
    } catch (error) {
      return {
        ok: false,
        stdout: "",
        stderr: "The online compiler is temporarily unavailable. Your code is still saved in this lesson.",
        exitCode: null,
        signal: null,
        provider: "unavailable",
        detail: error instanceof Error ? error.message : "Compiler request failed.",
      };
    }
  }

  async getAssessments(user: AuthPrincipal, courseId?: string) {
    const courseWhere = await this.courseWhereForUser(user);
    const assessments = await this.prisma.courseAssessment.findMany({
      where: {
        ...(courseId ? { courseId } : {}),
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
    await this.assertAssessmentUnlocked(user, assessment);
    return {
      assessment: this.publicAssessment(assessment),
      attempt: {
        startedAt: new Date().toISOString(),
        mode: "server-graded",
      },
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
    await this.assertAssessmentUnlocked(user, assessment);
    const baseScore = this.gradeAssessment(assessment, data.answersJson);
    const practiceBonus =
      assessment.type === "EXAM"
        ? await this.practiceBonus(user.id, assessment.courseId)
        : 0;
    const score = Math.min(assessment.maxScore, baseScore + practiceBonus);
    const result = await this.prisma.assessmentResult.create({
      data: {
        studentId: user.id,
        courseId: assessment.courseId,
        assessmentId: assessment.id,
        score,
        passed: score >= assessment.passingScore,
        answersJson: data.answersJson as Prisma.InputJsonValue,
      },
    });
    const certificate =
      result.passed && assessment.type === "EXAM"
        ? await this.issueCertificate(user, assessment.courseId, result.id, result.score)
        : null;
    return {
      ...result,
      baseScore,
      practiceBonus,
      certificate,
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

  private publicAssessment<T extends { questionsJson: unknown }>(assessment: T) {
    const payload = this.assessmentPayload(assessment.questionsJson);
    const questions = payload.questions?.map(({ correct: _correct, expectedKeyword: _keyword, ...question }) => question);
    return {
      ...assessment,
      questionsJson: {
        ...payload,
        questions: questions ?? [],
      },
    };
  }

  private async runWithJudge0(data: RunLearningCodeDto) {
    const languageId = {
      c: 103,
      cpp: 105,
      java: 91,
      python: 100,
      javascript: 102,
      sql: 82,
    }[data.language];
    if (!languageId) return null;

    try {
      const response = await fetch(
        "https://ce.judge0.com/submissions?base64_encoded=true&wait=true",
        {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          signal: AbortSignal.timeout(20_000),
          body: JSON.stringify({
            language_id: languageId,
            source_code: Buffer.from(data.sourceCode, "utf8").toString("base64"),
            stdin: Buffer.from(data.stdin ?? "", "utf8").toString("base64"),
          }),
        },
      );
      if (!response.ok) return null;
      const result = (await response.json()) as {
        stdout?: string | null;
        stderr?: string | null;
        compile_output?: string | null;
        message?: string | null;
        status?: { id?: number; description?: string };
      };
      const decode = (value?: string | null) =>
        value ? Buffer.from(value, "base64").toString("utf8").trim() : "";
      const stdout = decode(result.stdout);
      const compileError = decode(result.compile_output);
      const stderr = decode(result.stderr) || decode(result.message);
      const accepted = result.status?.id === 3;
      return {
        ok: accepted,
        stdout,
        stderr: compileError || stderr,
        exitCode: accepted ? 0 : result.status?.id ?? 1,
        signal: null,
        provider: "judge0",
      };
    } catch {
      return null;
    }
  }

  private assessmentPayload(value: unknown): LearningAssessmentPayload {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const payload = value as LearningAssessmentPayload;
    return {
      ...payload,
      questions: Array.isArray(payload.questions) ? payload.questions : [],
    };
  }

  private gradeAssessment(
    assessment: { maxScore: number; questionsJson: unknown },
    answers: Record<string, string | number>,
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
      if (question.type === "mcq" && Number(answer) === question.correct) {
        earned += marks;
      }
      if (question.type === "code" && typeof answer === "string") {
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

  private certificatePdf(data: {
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
