import { Module } from '@nestjs/common';
import { LearnController } from './learn.controller';
import { LearnService } from './learn.service';
import { PrismaService } from '../../database/prisma.service';

@Module({
  controllers: [LearnController],
  providers: [LearnService, PrismaService],
  exports: [LearnService],
})
export class LearnModule {}
