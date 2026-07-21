import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CreateCourseDto, UpdateCourseDto } from './dto/course.dto';

@Injectable()
export class LearnService {
  constructor(private readonly prisma: PrismaService) {}

  async createCourse(collegeId: string, data: CreateCourseDto) {
    return this.prisma.course.create({
      data: {
        ...data,
        collegeId,
      },
    });
  }

  async getCourses(collegeId: string, departmentId?: string, programmeId?: string) {
    return this.prisma.course.findMany({
      where: {
        collegeId,
        ...(departmentId && { departmentId }),
        ...(programmeId && { programmeId }),
      },
      include: {
        department: true,
        programme: true,
      },
    });
  }

  async getCourseById(collegeId: string, courseId: string) {
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
      include: {
        modules: {
          include: {
            lessons: {
              orderBy: { sortOrder: 'asc' },
            },
            resources: true,
          },
          orderBy: { sortOrder: 'asc' },
        },
        assessments: true,
      },
    });

    if (!course || course.collegeId !== collegeId) {
      throw new NotFoundException('Course not found');
    }

    return course;
  }

  async updateCourse(collegeId: string, courseId: string, data: UpdateCourseDto) {
    const course = await this.prisma.course.findUnique({ where: { id: courseId } });
    
    if (!course || course.collegeId !== collegeId) {
      throw new NotFoundException('Course not found');
    }

    return this.prisma.course.update({
      where: { id: courseId },
      data,
    });
  }
}
