import { Body, Controller, Get, Header, Param, Patch, Post, Put, Query, Req, StreamableFile, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { LearnService } from "./learn.service";
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
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { PermissionsGuard } from "../../common/guards/permissions.guard";
import type { AuthenticatedRequest } from "../../common/http/request-context";
import { Public } from "../../common/decorators/public.decorator";

@ApiTags('Learn Portal')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('learn/courses')
export class LearnController {
  constructor(private readonly learnService: LearnService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new course' })
  async createCourse(@Req() req: AuthenticatedRequest, @Body() data: CreateCourseDto) {
    return this.learnService.createCourse(req.user, data);
  }

  @Get()
  @ApiOperation({ summary: 'Get all courses' })
  async getCourses(
    @Req() req: AuthenticatedRequest,
    @Query('departmentId') departmentId?: string,
    @Query('programmeId') programmeId?: string,
  ) {
    return this.learnService.getCourses(req.user, departmentId, programmeId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a course by ID with modules and lessons' })
  async getCourseById(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.learnService.getCourseById(req.user, id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a course' })
  async updateCourse(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() data: UpdateCourseDto) {
    return this.learnService.updateCourse(req.user, id, data);
  }

  @Post(":id/modules")
  @ApiOperation({ summary: "Create a module inside a course" })
  async createModule(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() data: CreateCourseModuleDto,
  ) {
    return this.learnService.createModule(req.user, id, data);
  }

  @Post(":id/modules/:moduleId/lessons")
  @ApiOperation({ summary: "Create a lesson inside a module" })
  async createLesson(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Param("moduleId") moduleId: string,
    @Body() data: CreateCourseLessonDto,
  ) {
    return this.learnService.createLesson(req.user, id, moduleId, data);
  }

  @Post(":id/resources")
  @ApiOperation({ summary: "Attach a resource to a course or module" })
  async createResource(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() data: CreateCourseResourceDto,
  ) {
    return this.learnService.createResource(req.user, id, data);
  }

  @Post(":id/assessments")
  @ApiOperation({ summary: "Create a course assessment" })
  async createAssessment(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() data: CreateCourseAssessmentDto,
  ) {
    return this.learnService.createAssessment(req.user, id, data);
  }

  @Post(":id/lessons/:lessonId/progress")
  @ApiOperation({ summary: "Mark or unmark a lesson as completed" })
  async completeLesson(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Param("lessonId") lessonId: string,
    @Body() data: CompleteLessonDto,
  ) {
    return this.learnService.completeLesson(req.user, id, lessonId, data);
  }
}

@ApiTags("Learn Portal")
@Controller("learn")
export class LearnPortalController {
  constructor(private readonly learnService: LearnService) {}

  @Public()
  @Get("health")
  @ApiOperation({ summary: "Check Learn portal integration health" })
  async health() {
    return this.learnService.health();
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @ApiBearerAuth()
  @Get("dashboard")
  @ApiOperation({ summary: "Get the current user's Learn dashboard" })
  async dashboard(@Req() req: AuthenticatedRequest) {
    return this.learnService.dashboard(req.user);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @ApiBearerAuth()
  @Get("subjects")
  @ApiOperation({ summary: "Get Learn subjects for the current user" })
  async subjects(@Req() req: AuthenticatedRequest) {
    return this.learnService.getSubjects(req.user);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @ApiBearerAuth()
  @Get("subjects/:subjectId")
  @ApiOperation({ summary: "Get a subject with related Learn courses" })
  async subject(@Req() req: AuthenticatedRequest, @Param("subjectId") subjectId: string) {
    return this.learnService.getSubjectById(req.user, subjectId);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @ApiBearerAuth()
  @Get("subjects/:subjectId/resources")
  @ApiOperation({ summary: "Get resources related to a subject" })
  async subjectResources(@Req() req: AuthenticatedRequest, @Param("subjectId") subjectId: string) {
    return this.learnService.getSubjectResources(req.user, subjectId);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @ApiBearerAuth()
  @Get("model-papers")
  @ApiOperation({ summary: "Get published model question papers" })
  async modelPapers(
    @Req() req: AuthenticatedRequest,
    @Query("subjectId") subjectId?: string,
  ) {
    return this.learnService.getModelPapers(req.user, subjectId);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @ApiBearerAuth()
  @Get("syllabus")
  @ApiOperation({ summary: "Get course syllabus for the current user" })
  async syllabus(@Req() req: AuthenticatedRequest, @Query("courseId") courseId?: string) {
    return this.learnService.getSyllabus(req.user, courseId);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @ApiBearerAuth()
  @Get("modules/:moduleId")
  @ApiOperation({ summary: "Get a Learn module by ID" })
  async module(@Req() req: AuthenticatedRequest, @Param("moduleId") moduleId: string) {
    return this.learnService.getModuleById(req.user, moduleId);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @ApiBearerAuth()
  @Get("lessons/:lessonId")
  @ApiOperation({ summary: "Get a Learn lesson by ID" })
  async lesson(@Req() req: AuthenticatedRequest, @Param("lessonId") lessonId: string) {
    return this.learnService.getLessonById(req.user, lessonId);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @ApiBearerAuth()
  @Get("progress")
  @ApiOperation({ summary: "Get current user's learning progress" })
  async progress(@Req() req: AuthenticatedRequest, @Query("courseId") courseId?: string) {
    return this.learnService.getProgress(req.user, courseId);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @ApiBearerAuth()
  @Post("progress")
  @ApiOperation({ summary: "Record current user's lesson progress" })
  async recordProgress(@Req() req: AuthenticatedRequest, @Body() data: RecordLearningProgressDto) {
    return this.learnService.recordProgress(req.user, data);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @ApiBearerAuth()
  @Get("bookmarks")
  @ApiOperation({ summary: "Get current user's bookmarked lessons" })
  async bookmarks(@Req() req: AuthenticatedRequest) {
    return this.learnService.getBookmarks(req.user);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @ApiBearerAuth()
  @Post("bookmarks/:lessonId/toggle")
  @ApiOperation({ summary: "Add or remove a lesson bookmark" })
  async toggleBookmark(@Req() req: AuthenticatedRequest, @Param("lessonId") lessonId: string) {
    return this.learnService.toggleBookmark(req.user, lessonId);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @ApiBearerAuth()
  @Post("compiler/run")
  @ApiOperation({ summary: "Compile and run programming practice code" })
  async runCode(@Req() req: AuthenticatedRequest, @Body() data: RunLearningCodeDto) {
    return this.learnService.runCode(req.user, data);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @ApiBearerAuth()
  @Get("assessments")
  @ApiOperation({ summary: "Get assessments available to the current user" })
  async assessments(@Req() req: AuthenticatedRequest, @Query("courseId") courseId?: string) {
    return this.learnService.getAssessments(req.user, courseId);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @ApiBearerAuth()
  @Post("assessments/:assessmentId/start")
  @ApiOperation({ summary: "Start an assessment attempt" })
  async startAssessment(@Req() req: AuthenticatedRequest, @Param("assessmentId") assessmentId: string) {
    return this.learnService.startAssessment(req.user, assessmentId);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @ApiBearerAuth()
  @Post("assessments/:assessmentId/submit")
  @ApiOperation({ summary: "Submit an assessment result" })
  async submitAssessment(
    @Req() req: AuthenticatedRequest,
    @Param("assessmentId") assessmentId: string,
    @Body() data: SubmitAssessmentDto,
  ) {
    return this.learnService.submitAssessment(req.user, assessmentId, data);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @ApiBearerAuth()
  @Get("results")
  @ApiOperation({ summary: "Get current user's assessment results" })
  async results(@Req() req: AuthenticatedRequest) {
    return this.learnService.getResults(req.user);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @ApiBearerAuth()
  @Get("certificates")
  @ApiOperation({ summary: "Get current user's certificates" })
  async certificates(@Req() req: AuthenticatedRequest) {
    return this.learnService.getCertificates(req.user);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @ApiBearerAuth()
  @Get("certificates/:certificateId/download")
  @Header("Content-Type", "application/pdf")
  @Header("Content-Disposition", 'attachment; filename="avs-learn-certificate.pdf"')
  @ApiOperation({ summary: "Download an issued AVS Learn certificate" })
  async downloadCertificate(
    @Req() req: AuthenticatedRequest,
    @Param("certificateId") certificateId: string,
  ) {
    return new StreamableFile(await this.learnService.downloadCertificate(req.user, certificateId));
  }
}

@ApiTags("AVS Skill Portal")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller("skill")
export class SkillPortalController {
  constructor(private readonly learnService: LearnService) {}

  @Get("dashboard")
  dashboard(@Req() req: AuthenticatedRequest) {
    return this.learnService.dashboard(req.user);
  }

  @Get("courses")
  courses(@Req() req: AuthenticatedRequest) {
    return this.learnService.getCourses(req.user);
  }

  @Get("courses/:courseId")
  course(
    @Req() req: AuthenticatedRequest,
    @Param("courseId") courseId: string,
  ) {
    return this.learnService.getCourseById(req.user, courseId);
  }

  @Get("lessons/:lessonId")
  lesson(
    @Req() req: AuthenticatedRequest,
    @Param("lessonId") lessonId: string,
  ) {
    return this.learnService.getLessonById(req.user, lessonId);
  }

  @Get("progress")
  progress(
    @Req() req: AuthenticatedRequest,
    @Query("courseId") courseId?: string,
  ) {
    return this.learnService.getProgress(req.user, courseId);
  }

  @Post("progress")
  recordProgress(
    @Req() req: AuthenticatedRequest,
    @Body() data: RecordLearningProgressDto,
  ) {
    return this.learnService.recordProgress(req.user, data);
  }

  @Get("assessments")
  assessments(
    @Req() req: AuthenticatedRequest,
    @Query("courseId") courseId?: string,
  ) {
    return this.learnService.getAssessments(req.user, courseId);
  }

  @Post("assessments/:assessmentId/submit")
  submitAssessment(
    @Req() req: AuthenticatedRequest,
    @Param("assessmentId") assessmentId: string,
    @Body() data: SubmitAssessmentDto,
  ) {
    return this.learnService.submitAssessment(req.user, assessmentId, data);
  }

  @Get("certificates")
  certificates(@Req() req: AuthenticatedRequest) {
    return this.learnService.getCertificates(req.user);
  }
}

@ApiTags("Admin AVS Skill Portal")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller("admin/skill")
export class AdminSkillController {
  constructor(private readonly learnService: LearnService) {}

  @Get("courses")
  courses(@Req() req: AuthenticatedRequest) {
    return this.learnService.getCourses(req.user);
  }

  @Post("courses")
  createCourse(
    @Req() req: AuthenticatedRequest,
    @Body() data: CreateCourseDto,
  ) {
    return this.learnService.createCourse(req.user, data);
  }

  @Patch("courses/:courseId")
  updateCourse(
    @Req() req: AuthenticatedRequest,
    @Param("courseId") courseId: string,
    @Body() data: UpdateCourseDto,
  ) {
    return this.learnService.updateCourse(req.user, courseId, data);
  }

  @Post("courses/:courseId/publish")
  publish(
    @Req() req: AuthenticatedRequest,
    @Param("courseId") courseId: string,
  ) {
    return this.learnService.updateCourse(req.user, courseId, {
      status: "PUBLISHED",
    });
  }

  @Post("courses/:courseId/unpublish")
  unpublish(
    @Req() req: AuthenticatedRequest,
    @Param("courseId") courseId: string,
  ) {
    return this.learnService.updateCourse(req.user, courseId, {
      status: "UNPUBLISHED",
    });
  }

  @Post("courses/:courseId/archive")
  archive(
    @Req() req: AuthenticatedRequest,
    @Param("courseId") courseId: string,
  ) {
    return this.learnService.updateCourse(req.user, courseId, {
      status: "ARCHIVED",
    });
  }

  @Post("courses/:courseId/restore")
  restore(
    @Req() req: AuthenticatedRequest,
    @Param("courseId") courseId: string,
  ) {
    return this.learnService.updateCourse(req.user, courseId, {
      status: "DRAFT",
    });
  }

  @Get("reports")
  reports(@Req() req: AuthenticatedRequest) {
    return this.learnService.adminReports(req.user);
  }
}

@ApiTags("Staff Learn")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller("staff/learn")
export class StaffLearnController {
  constructor(private readonly learnService: LearnService) {}

  @Get("dashboard")
  async dashboard(@Req() req: AuthenticatedRequest) {
    return this.learnService.dashboard(req.user);
  }

  @Get("subjects")
  async subjects(@Req() req: AuthenticatedRequest) {
    return this.learnService.getSubjects(req.user);
  }

  @Get("subjects/:subjectId/resources")
  resources(
    @Req() req: AuthenticatedRequest,
    @Param("subjectId") subjectId: string,
  ) {
    return this.learnService.getSubjectResources(req.user, subjectId);
  }

  @Get("model-papers")
  modelPapers(
    @Req() req: AuthenticatedRequest,
    @Query("subjectId") subjectId?: string,
  ) {
    return this.learnService.getModelPapers(req.user, subjectId);
  }

  @Post("courses/:courseId/resources")
  async createResource(
    @Req() req: AuthenticatedRequest,
    @Param("courseId") courseId: string,
    @Body() data: CreateCourseResourceDto,
  ) {
    return this.learnService.createResource(req.user, courseId, data);
  }

  @Post("courses/:courseId/assessments")
  async createAssessment(
    @Req() req: AuthenticatedRequest,
    @Param("courseId") courseId: string,
    @Body() data: CreateCourseAssessmentDto,
  ) {
    return this.learnService.createAssessment(req.user, courseId, data);
  }
}

@ApiTags("Admin Learn")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller("admin/learn")
export class AdminLearnController {
  constructor(private readonly learnService: LearnService) {}

  @Get("dashboard")
  async dashboard(@Req() req: AuthenticatedRequest) {
    return this.learnService.adminDashboard(req.user);
  }

  @Get("resources")
  async resources(@Req() req: AuthenticatedRequest) {
    return this.learnService.adminResources(req.user);
  }

  @Get("subject-resources")
  async subjectResources(@Req() req: AuthenticatedRequest) {
    return this.learnService.adminSubjectResources(req.user);
  }

  @Post("subject-resources/:resourceId/publish")
  publishSubjectResource(
    @Req() req: AuthenticatedRequest,
    @Param("resourceId") resourceId: string,
  ) {
    return this.learnService.setSubjectResourceStatus(
      req.user,
      resourceId,
      "PUBLISHED",
    );
  }

  @Post("subject-resources/:resourceId/archive")
  archiveSubjectResource(
    @Req() req: AuthenticatedRequest,
    @Param("resourceId") resourceId: string,
  ) {
    return this.learnService.setSubjectResourceStatus(
      req.user,
      resourceId,
      "ARCHIVED",
    );
  }

  @Post("model-papers/:paperId/publish")
  publishModelPaper(
    @Req() req: AuthenticatedRequest,
    @Param("paperId") paperId: string,
  ) {
    return this.learnService.setModelPaperStatus(
      req.user,
      paperId,
      "PUBLISHED",
    );
  }

  @Post("model-papers/:paperId/archive")
  archiveModelPaper(
    @Req() req: AuthenticatedRequest,
    @Param("paperId") paperId: string,
  ) {
    return this.learnService.setModelPaperStatus(
      req.user,
      paperId,
      "ARCHIVED",
    );
  }

  @Get("reports")
  async reports(@Req() req: AuthenticatedRequest) {
    return this.learnService.adminReports(req.user);
  }

  @Get("course-assignments")
  async courseAssignments(@Req() req: AuthenticatedRequest) {
    return this.learnService.courseAssignments(req.user);
  }
}
