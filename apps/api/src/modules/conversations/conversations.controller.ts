import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, StreamableFile } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Permissions } from "../../common/decorators/permissions.decorator";
import type { AuthPrincipal } from "../../common/http/request-context";
import { CurrentRequestId } from "../../common/decorators/request-id.decorator";
import { ConversationsService } from "./conversations.service";
import { ConversationPreferenceDto, CreateDirectConversationDto, CreateGroupConversationDto, EditMessageDto, MessageBackupDto, ModerateMessageReportDto, ReactionDto, ReportMessageDto, SendMessageDto, UpdateConversationDto } from "./dto/conversation.dto";

@ApiTags("conversations")
@Controller()
export class ConversationsController {
  constructor(private readonly conversations: ConversationsService) {}
  @Permissions("conversations.read") @Get("conversations") list(@CurrentUser() user: AuthPrincipal, @Query("search") search = "") { return this.conversations.list(user, search.trim()); }
  @Permissions("conversations.manage_official") @Post("conversations") createGroup(@CurrentUser() user: AuthPrincipal, @Body() input: CreateGroupConversationDto, @CurrentRequestId() requestId: string) { return this.conversations.createGroup(user, input, requestId); }
  @Permissions("conversations.create_direct") @Post("conversations/direct") create(@CurrentUser() user: AuthPrincipal, @Body() input: CreateDirectConversationDto) { return this.conversations.createDirect(user, input); }
  @Permissions("conversations.create_direct") @Get("conversations/contacts") contacts(@CurrentUser() user: AuthPrincipal, @Query("search") search = "") { return this.conversations.contacts(user, search.trim()); }
  @Permissions("conversations.manage_official") @Post("conversations/sync-official") syncOfficial(@CurrentUser() user: AuthPrincipal) { return this.conversations.syncOfficial(user); }
  @Permissions("conversations.read") @Get("conversations/:id") get(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string) { return this.conversations.get(user, id); }
  @Permissions("conversations.manage_official") @Patch("conversations/:id") updateConversation(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string, @Body() input: UpdateConversationDto, @CurrentRequestId() requestId: string) { return this.conversations.updateConversation(user, id, input, requestId); }
  @Permissions("conversations.read") @Get("conversations/:id/messages") messages(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string, @Query("before") before?: string, @Query("cursor") cursor?: string) { return this.conversations.messages(user, id, before ? new Date(before) : undefined, cursor); }
  @Permissions("messages.send") @Post("conversations/:id/messages") send(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string, @Body() input: SendMessageDto) { return this.conversations.send(user, id, input); }
  @Permissions("conversations.read") @Post("conversations/:id/read") read(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string) { return this.conversations.markRead(user, id); }
  @Permissions("messages.edit_own") @Patch("messages/:id") edit(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string, @Body() input: EditMessageDto) { return this.conversations.edit(user, id, input); }
  @Permissions("messages.delete_own") @Delete("messages/:id") @HttpCode(HttpStatus.NO_CONTENT) remove(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string, @Query("scope") scope = "everyone") { return this.conversations.remove(user, id, scope !== "self"); }
  @Permissions("conversations.read") @Post("messages/:id/read") readMessage(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string) { return this.conversations.readMessage(user, id); }
  @Permissions("messages.send") @Post("messages/:id/retry") retryMessage(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string) { return this.conversations.retry(user, id); }
  @Permissions("conversations.read") @Post("messages/:id/star") star(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string) { return this.conversations.star(user, id); }
  @Permissions("conversations.read") @Delete("messages/:id/star") @HttpCode(HttpStatus.NO_CONTENT) unstar(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string) { return this.conversations.unstar(user, id); }
  @Permissions("conversations.manage_official") @Post("messages/:id/pin") pin(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string) { return this.conversations.pinMessage(user, id, true); }
  @Permissions("conversations.manage_official") @Delete("messages/:id/pin") unpin(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string) { return this.conversations.pinMessage(user, id, false); }
  @Permissions("messages.react") @Post("messages/:id/reactions") react(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string, @Body() input: ReactionDto) { return this.conversations.react(user, id, input.emoji); }
  @Permissions("messages.react") @Delete("messages/:id/reactions/:emoji") @HttpCode(HttpStatus.NO_CONTENT) unreact(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string, @Param("emoji") emoji: string) { return this.conversations.unreact(user, id, emoji); }
  @Permissions("messages.report") @Post("messages/:id/report") report(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string, @Body() input: ReportMessageDto) { return this.conversations.report(user, id, input.reason); }
  @Permissions("messages.moderate_reported") @Get("message-reports") reports(@CurrentUser() user: AuthPrincipal, @Query("status") status = "OPEN") { return this.conversations.reports(user, status); }
  @Permissions("messages.moderate_reported") @Patch("message-reports/:id") moderate(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string, @Body() input: ModerateMessageReportDto, @CurrentRequestId() requestId: string) { return this.conversations.moderateReport(user, id, input, requestId); }
  @Permissions("conversations.read") @Patch("conversations/:id/preferences") preferences(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string, @Body() input: ConversationPreferenceDto) { return this.conversations.preferences(user, id, input); }
  @Permissions("conversations.read") @Get("conversations/:id/search") search(@CurrentUser() user: AuthPrincipal, @Param("id", ParseUUIDPipe) id: string, @Query("q") query: string) { return this.conversations.search(user, id, query?.trim() ?? ""); }
  @Permissions("messages.backup") @Post("messages/backup/export") async backup(@CurrentUser() user: AuthPrincipal, @Body() input: MessageBackupDto, @CurrentRequestId() requestId: string) {
    const backup = await this.conversations.encryptedBackup(user, input.currentPassword, requestId);
    return new StreamableFile(backup.content, {
      type: "application/json",
      disposition: `attachment; filename="${backup.fileName}"`,
      length: backup.content.length,
    });
  }
}
