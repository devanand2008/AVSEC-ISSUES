import { Controller, Get, Post, Body, Param, Put, Query, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { LearnService } from './learn.service';
import { CreateCourseDto, UpdateCourseDto } from './dto/course.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { AuthenticatedRequest } from '../../common/http/request-context';

@ApiTags('Learn Portal')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('learn/courses')
export class LearnController {
  constructor(private readonly learnService: LearnService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new course' })
  async createCourse(@Req() req: AuthenticatedRequest, @Body() data: CreateCourseDto) {
    const collegeId = req.user.collegeId;
    return this.learnService.createCourse(collegeId, data);
  }

  @Get()
  @ApiOperation({ summary: 'Get all courses' })
  async getCourses(
    @Req() req: AuthenticatedRequest,
    @Query('departmentId') departmentId?: string,
    @Query('programmeId') programmeId?: string,
  ) {
    const collegeId = req.user.collegeId;
    return this.learnService.getCourses(collegeId, departmentId, programmeId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a course by ID with modules and lessons' })
  async getCourseById(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    const collegeId = req.user.collegeId;
    return this.learnService.getCourseById(collegeId, id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a course' })
  async updateCourse(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() data: UpdateCourseDto) {
    const collegeId = req.user.collegeId;
    return this.learnService.updateCourse(collegeId, id, data);
  }
}
