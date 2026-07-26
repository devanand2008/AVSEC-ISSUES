import { Module } from '@nestjs/common';
import { AdminLearnController, AdminSkillController, LearnController, LearnPortalController, SkillPortalController, StaffLearnController } from './learn.controller';
import { LearnService } from './learn.service';
import { PrismaService } from '../../database/prisma.service';

@Module({
  controllers: [LearnController, LearnPortalController, SkillPortalController, StaffLearnController, AdminLearnController, AdminSkillController],
  providers: [LearnService, PrismaService],
  exports: [LearnService],
})
export class LearnModule {}
