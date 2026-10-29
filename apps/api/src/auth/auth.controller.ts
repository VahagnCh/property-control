import { Body, Controller, Get, Headers, Inject, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AccessTokenGuard } from './access-token.guard.js';
import { AuthService, type AuthHttpResult } from './auth.service.js';

@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Post('code')
  async code(
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const email = body && typeof body === 'object' ? (body as { email?: unknown }).email : undefined;
    writeAuthResult(
      response,
      await this.auth.requestCode({
        email,
        idempotencyKey,
        ip: request.ip || 'unknown',
      }),
    );
  }

  @Post('verify')
  async verify(@Body() body: unknown, @Req() request: Request, @Res() response: Response): Promise<void> {
    const record = body && typeof body === 'object' ? (body as { email?: unknown; code?: unknown }) : {};
    writeAuthResult(
      response,
      await this.auth.verifyCode({
        email: record.email,
        code: record.code,
        ip: request.ip || 'unknown',
      }),
    );
  }

  @Post('refresh')
  async refresh(@Body() body: unknown, @Res() response: Response): Promise<void> {
    const refreshToken =
      body && typeof body === 'object' ? (body as { refreshToken?: unknown }).refreshToken : undefined;
    writeAuthResult(response, await this.auth.refresh({ refreshToken }));
  }

  @Post('logout')
  @UseGuards(AccessTokenGuard)
  async logout(
    @Req() request: { accessToken?: { sid?: string } },
    @Res() response: Response,
  ): Promise<void> {
    writeAuthResult(response, await this.auth.logout(request.accessToken?.sid));
  }

  @Get('session')
  @UseGuards(AccessTokenGuard)
  session(@Req() request: { accessToken?: { sub: string; sid?: string } }): { sub?: string; sid?: string } {
    return { sub: request.accessToken?.sub, sid: request.accessToken?.sid };
  }
}

function writeAuthResult(response: Response, result: AuthHttpResult): void {
  if (result.retryAfterSeconds) {
    response.setHeader('Retry-After', String(result.retryAfterSeconds));
  }
  if (result.status === 204) {
    response.status(204).end();
    return;
  }
  response.status(result.status).json(result.body);
}
