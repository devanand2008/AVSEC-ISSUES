import { Module } from "@nestjs/common";
import { ConversationsController } from "./conversations.controller";
import { ConversationsService } from "./conversations.service";
import { RealtimeGateway } from "./realtime.gateway";
import { JwtModule } from "@nestjs/jwt";
import { AuditModule } from "../audit/audit.module";
import { OfficialGroupsService } from "./official-groups.service";
import { BroadcastController } from "./broadcast.controller";
import { BroadcastService } from "./broadcast.service";

@Module({ imports: [JwtModule.register({}), AuditModule], controllers: [ConversationsController, BroadcastController], providers: [ConversationsService, RealtimeGateway, OfficialGroupsService, BroadcastService], exports: [OfficialGroupsService] })
export class ConversationsModule {}
