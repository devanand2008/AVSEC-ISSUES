import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { ConfigService } from "@nestjs/config";
import type { Request, Response } from "express";
import { Throttle } from "@nestjs/throttler";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Public } from "../../common/decorators/public.decorator";
import type {
  AuthPrincipal,
  RequestWithId,
} from "../../common/http/request-context";
import { AuthService } from "./auth.service";
import { ChangePasswordDto } from "./dto/change-password.dto";
import { LoginDto } from "./dto/login.dto";
import { ForgotPasswordDto, ResetPasswordDto } from "./dto/password-reset.dto";

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Post("login")
  @Throttle({
    default: {
      limit: () => Number(process.env.LOGIN_RATE_LIMIT_MAX ?? 10),
      ttl: () => Number(process.env.LOGIN_RATE_LIMIT_TTL_MS ?? 60_000),
    },
  })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Authenticate and create a rotating session" })
  async login(
    @Body() input: LoginDto,
    @Req() request: RequestWithId,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.login(input, this.metadata(request));
    this.setCookies(response, result.tokens);
    return { user: result.user };
  }

  @Public()
  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() request: RequestWithId,
    @Res({ passthrough: true }) response: Response,
  ) {
    try {
      this.assertCsrf(request);
      const cookies = request.cookies as Record<string, string> | undefined;
      const tokens = await this.auth.refresh(
        cookies?.college_refresh,
        this.metadata(request),
      );
      this.setCookies(response, tokens);
      return { refreshed: true };
    } catch (error) {
      this.clearCookies(response);
      throw error;
    }
  }

  @Public()
  @Post("logout")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiCookieAuth()
  async logout(
    @Req() request: RequestWithId,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const cookies = request.cookies as Record<string, string> | undefined;
    await this.auth.revokeSessionFromRefreshToken(
      cookies?.college_refresh,
      "USER_LOGOUT",
      this.metadata(request),
    );
    this.clearCookies(response);
  }

  @Get("me")
  me(@CurrentUser() user: AuthPrincipal) {
    return {
      id: user.publicId,
      fullName: user.fullName,
      email: user.email,
      status: user.status,
      mustChangePassword: user.mustChangePassword,
      firstLoginCompletedAt: user.firstLoginCompletedAt,
      roles: user.roles,
      permissions: user.permissions,
    };
  }

  @Post("change-password")
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @Body() input: ChangePasswordDto,
    @CurrentUser() user: AuthPrincipal,
    @Req() request: RequestWithId,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.changePassword(
      user.id,
      input.currentPassword,
      input.newPassword,
      user.sessionId,
      this.metadata(request),
    );
    this.setCookies(response, result.tokens);
    return { user: result.user };
  }

  @Get("sessions")
  sessions(@CurrentUser() user: AuthPrincipal) {
    return this.auth.listSessions(user.id, user.sessionId);
  }

  @Post("sessions/:id/revoke")
  @HttpCode(HttpStatus.NO_CONTENT)
  revokeOwnSession(
    @CurrentUser() user: AuthPrincipal,
    @Param("id", ParseUUIDPipe) sessionId: string,
    @Req() request: RequestWithId,
  ) {
    return this.auth.revokeOwnSession(
      user.id,
      sessionId,
      user.sessionId,
      this.metadata(request),
    );
  }

  @Post("sessions/revoke-others")
  @HttpCode(HttpStatus.OK)
  revokeOtherSessions(
    @CurrentUser() user: AuthPrincipal,
    @Req() request: RequestWithId,
  ) {
    return this.auth.revokeOtherSessions(
      user.id,
      user.sessionId,
      this.metadata(request),
    );
  }

  @Public()
  @Post("forgot-password")
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.ACCEPTED)
  forgotPassword(
    @Body() input: ForgotPasswordDto,
    @Req() request: RequestWithId,
  ) {
    return this.auth.forgotPassword(input.identifier, this.metadata(request));
  }

  @Public()
  @Post("reset-password")
  @HttpCode(HttpStatus.NO_CONTENT)
  resetPassword(
    @Body() input: ResetPasswordDto,
    @Req() request: RequestWithId,
  ) {
    return this.auth.resetPassword(
      input.token,
      input.newPassword,
      this.metadata(request),
    );
  }

  private setCookies(
    response: Response,
    tokens: {
      accessToken: string;
      refreshToken: string;
      csrfToken: string;
      accessExpiresInSeconds: number;
      refreshExpiresInSeconds: number;
    },
  ): void {
    const base = this.cookieBase();
    response.cookie("college_access", tokens.accessToken, {
      ...base,
      httpOnly: true,
      maxAge: tokens.accessExpiresInSeconds * 1000,
      path: "/",
    });
    response.cookie("college_refresh", tokens.refreshToken, {
      ...base,
      httpOnly: true,
      maxAge: tokens.refreshExpiresInSeconds * 1000,
      path: this.authCookiePath(),
    });
    response.cookie("college_csrf", tokens.csrfToken, {
      ...base,
      httpOnly: false,
      maxAge: tokens.refreshExpiresInSeconds * 1000,
      path: "/",
    });
  }

  private clearCookies(response: Response): void {
    response.clearCookie("college_access", { ...this.cookieBase(), path: "/" });
    response.clearCookie("college_refresh", {
      ...this.cookieBase(),
      path: this.authCookiePath(),
    });
    response.clearCookie("college_csrf", { ...this.cookieBase(), path: "/" });
  }

  private cookieBase() {
    const domain = this.config.get<string>("COOKIE_DOMAIN");
    return {
      secure: this.config.get<boolean>("COOKIE_SECURE", false),
      sameSite: this.config.get<"lax" | "strict" | "none">(
        "COOKIE_SAME_SITE",
        "lax",
      ),
      ...(domain ? { domain } : {}),
    } as const;
  }

  private authCookiePath(): string {
    const prefix = this.config
      .get<string>("API_PREFIX", "api/v1")
      .replace(/^\/+|\/+$/g, "");
    return `/${prefix}/auth`;
  }

  private assertCsrf(request: Request): void {
    const cookies = request.cookies as Record<string, string> | undefined;
    const header = request.header("x-csrf-token");
    if (!header || !cookies?.college_csrf || header !== cookies.college_csrf) {
      throw new ForbiddenException("CSRF validation failed.");
    }
  }

  private metadata(request: RequestWithId) {
    return {
      requestId: request.id,
      ipAddress: request.ip,
      userAgent: request.header("user-agent"),
    };
  }
}
