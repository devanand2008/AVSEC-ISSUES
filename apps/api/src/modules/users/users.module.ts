import { Module } from "@nestjs/common";
import { UsersController } from "./users.controller";
import { UsersService } from "./users.service";
import { ConversationsModule } from "../conversations/conversations.module";
import { AcademicModule } from "../academic/academic.module";

@Module({ imports: [ConversationsModule, AcademicModule], controllers: [UsersController], providers: [UsersService], exports: [UsersService] })
export class UsersModule {}
