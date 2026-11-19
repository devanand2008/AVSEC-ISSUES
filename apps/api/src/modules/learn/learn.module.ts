import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { AdminLearnController, AdminSkillController, LearnController, LearnPortalController, SkillPortalController, StaffLearnController } from './learn.controller';
import { LearnService } from './learn.service';

@Module({
  imports: [DatabaseModule],
  controllers: [LearnController, LearnPortalController, SkillPortalController, StaffLearnController, AdminLearnController, AdminSkillController],
  providers: [LearnService],
  exports: [LearnService],
})
export class LearnModule {}
