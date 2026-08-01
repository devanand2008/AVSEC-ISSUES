import {
  Body,
  Controller,
  Get,
  HttpException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Permissions } from "../../common/decorators/permissions.decorator";
import type { AuthPrincipal, AuthenticatedRequest } from "../../common/http/request-context";
import { AiChatService } from "./ai-chat.service";
import {
  AiFeedbackDto,
  CreateAiConversationDto,
  StreamAiChatDto,
  UpdateAiConversationDto,
  UpdateAiUserSettingDto,
} from "./dto/ai.dto";

@ApiTags("AVS Bot")
@ApiBearerAuth()
@Permissions("ai.use")
@Controller("ai")
export class AiController {
  constructor(private readonly chat: AiChatService) {}

  @Get("health")
  health(@CurrentUser() user: AuthPrincipal) {
    return this.chat.health(user);
  }

  @Get("suggested-questions")
  suggestedQuestions(@CurrentUser() user: AuthPrincipal) {
    return { questions: this.chat.suggestedQuestions(user) };
  }

  @Post("conversations")
  createConversation(
    @CurrentUser() user: AuthPrincipal,
    @Body() input: CreateAiConversationDto,
  ) {
    return this.chat.createConversation(user, input);
  }

  @Get("conversations")
  conversations(
    @CurrentUser() user: AuthPrincipal,
    @Query("includeArchived") includeArchived?: string,
  ) {
    return this.chat.listConversations(user, includeArchived === "true");
  }

  @Get("conversations/:conversationId/messages")
  messages(
    @CurrentUser() user: AuthPrincipal,
    @Param("conversationId", ParseUUIDPipe) conversationId: string,
  ) {
    return this.chat.messages(user, conversationId);
  }

  @Patch("conversations/:conversationId")
  updateConversation(
    @CurrentUser() user: AuthPrincipal,
    @Param("conversationId", ParseUUIDPipe) conversationId: string,
    @Body() input: UpdateAiConversationDto,
  ) {
    return this.chat.updateConversation(user, conversationId, input);
  }

  @Get("settings")
  settings(@CurrentUser() user: AuthPrincipal) {
    return this.chat.settings(user);
  }

  @Patch("settings")
  updateSettings(
    @CurrentUser() user: AuthPrincipal,
    @Body() input: UpdateAiUserSettingDto,
  ) {
    return this.chat.updateSettings(user, input);
  }

  @Post("feedback")
  feedback(
    @CurrentUser() user: AuthPrincipal,
    @Body() input: AiFeedbackDto,
  ) {
    return this.chat.feedback(user, input);
  }

  @Post("messages/:messageId/cancel")
  cancel(
    @CurrentUser() user: AuthPrincipal,
    @Param("messageId", ParseUUIDPipe) messageId: string,
  ) {
    return this.chat.cancel(user, messageId);
  }

  @Post("chat/stream")
  async stream(
    @Req() request: AuthenticatedRequest & Request,
    @Res() response: Response,
    @Body() input: StreamAiChatDto,
  ): Promise<void> {
    response.status(200);
    response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    response.setHeader("Cache-Control", "no-cache, no-transform");
    response.setHeader("Connection", "keep-alive");
    response.setHeader("X-Accel-Buffering", "no");
    response.flushHeaders();
    const disconnect = new AbortController();
    const abort = () => disconnect.abort();
    request.once("aborted", abort);
    try {
      for await (const event of this.chat.chat(request.user, input, {
        requestId: request.id,
        signal: disconnect.signal,
      })) {
        if (disconnect.signal.aborted) break;
        response.write(
          `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`,
        );
      }
    } catch (error) {
      const message =
        error instanceof HttpException
          ? error.message
          : "AVS Bot could not start this request.";
      response.write(
        `event: error\ndata: ${JSON.stringify({ code: "request_failed", message })}\n\n`,
      );
    } finally {
      request.off("aborted", abort);
      response.end();
    }
  }
}

