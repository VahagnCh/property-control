import { Body, Controller, Delete, Get, Headers, Inject, Module, Patch, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AccessTokenGuard } from '../auth/access-token.guard.js';
import { AuthModule } from '../auth/auth.module.js';
import { ConsentRequiredGuard } from '../auth/consent-required.guard.js';
import { PropertyMembershipGuard } from '../auth/property-membership.guard.js';
import { scaffoldNotReady } from '../common/scaffold.response.js';
import { pathOnly } from '../common/path-safety.js';
import { RecordsModule } from '../writes/records.module.js';
import { RecordsService } from '../writes/records.service.js';

/**
 * Property JSON uses PropertyResponse. timezone is an IANA string on every
 * response and defaults to America/Mexico_City when the write body omits it.
 * Delete stays a stub. Create, list, get, and update persist.
 */
@Controller('properties')
export class PropertiesController {
  constructor(@Inject(RecordsService) private readonly records: RecordsService) {}

  @Get()
  @UseGuards(AccessTokenGuard)
  list(@Req() request: Authed) {
    return this.records.listProperties(subject(request));
  }

  @Post()
  @UseGuards(AccessTokenGuard, ConsentRequiredGuard)
  create(
    @Req() request: Authed,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    return reply(res, this.records.createProperty(subject(request), idempotencyKey, routeOf(request), body));
  }

  @Get(':propertyId')
  @UseGuards(AccessTokenGuard, PropertyMembershipGuard)
  getOne(@Req() request: Authed) {
    return this.records.getProperty(propertyId(request));
  }

  @Patch(':propertyId')
  @UseGuards(AccessTokenGuard, PropertyMembershipGuard, ConsentRequiredGuard)
  update(
    @Req() request: Authed,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    return reply(
      res,
      this.records.updateProperty(subject(request), propertyId(request), idempotencyKey, routeOf(request), body),
    );
  }

  @Delete(':propertyId')
  remove(): never {
    return scaffoldNotReady('properties');
  }
}

@Module({
  imports: [AuthModule, RecordsModule],
  controllers: [PropertiesController],
})
export class PropertiesModule {}

interface Authed {
  accessToken?: { sub: string };
  params?: Record<string, unknown>;
  method?: string;
  originalUrl?: string;
  url?: string;
}

function subject(request: Authed): string {
  return request.accessToken?.sub ?? '';
}

function propertyId(request: Authed): string {
  const value = request.params?.propertyId;
  return typeof value === 'string' ? value : '';
}

function routeOf(request: Authed): string {
  return `${request.method ?? 'POST'} ${pathOnly(request.originalUrl ?? request.url ?? '')}`;
}

async function reply(res: Response, pending: Promise<{ status: number; body: unknown }>): Promise<unknown> {
  const result = await pending;
  res.status(result.status);
  return result.body;
}
