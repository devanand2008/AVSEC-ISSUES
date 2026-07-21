import { Module } from "@nestjs/common";
import { UsersController } from "./users.controller";
import { UsersService } from "./users.service";
import { ConversationsModule } from "../conversations/conversations.module";

@Module({ imports: [ConversationsModule], controllers: [UsersController], providers: [UsersService], exports: [UsersService] })
export class UsersModule {}
