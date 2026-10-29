import { Body, Controller, Delete, Get, Headers, Inject, Module, Patch, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AccessTokenGuard } from '../auth/access-token.guard.js';
import { AuthModule } from '../auth/auth.module.js';
import { ConsentRequiredGuard } from '../auth/consent-required.guard.js';
import { PropertyMembershipGuard } from '../auth/property-membership.guard.js';
import { pathOnly } from '../common/path-safety.js';
import { scaffoldList, scaffoldNotReady } from '../common/scaffold.response.js';
import { RecordsModule } from '../writes/records.module.js';
import { RecordsService } from '../writes/records.service.js';

@Controller('properties/:propertyId/obligations')
export class ObligationsController {
  constructor(@Inject(RecordsService) private readonly records: RecordsService) {}

  @Get()
  @UseGuards(AccessTokenGuard, PropertyMembershipGuard)
  list(@Req() request: Authed) {
    return this.records.listObligations(propertyId(request));
  }

  @Post()
  @UseGuards(AccessTokenGuard, PropertyMembershipGuard, ConsentRequiredGuard)
  create(
    @Req() request: Authed,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    return reply(
      res,
      this.records.createObligation(subject(request), propertyId(request), idempotencyKey, routeOf(request), body),
    );
  }

  @Get(':obligationId')
  @UseGuards(AccessTokenGuard, PropertyMembershipGuard)
  getOne(@Req() request: Authed) {
    return this.records.getObligation(propertyId(request), idParam(request, 'obligationId'));
  }

  @Patch(':obligationId')
  @UseGuards(AccessTokenGuard, PropertyMembershipGuard, ConsentRequiredGuard)
  update(
    @Req() request: Authed,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    return reply(
      res,
      this.records.updateObligation(
        subject(request),
        propertyId(request),
        idParam(request, 'obligationId'),
        idempotencyKey,
        routeOf(request),
        body,
      ),
    );
  }

  @Delete(':obligationId')
  remove(): never {
    return scaffoldNotReady('obligations');
  }

  @Post(':obligationId/resume')
  resume(): never {
    return scaffoldNotReady('obligations');
  }

  @Post(':obligationId/unarchive')
  unarchive(): never {
    return scaffoldNotReady('obligations');
  }

  @Get(':obligationId/period-outcomes')
  listPeriodOutcomes() {
    return scaffoldList('obligation-period-outcomes');
  }

  @Post(':obligationId/period-outcomes')
  markPeriod(): never {
    return scaffoldNotReady('obligation-period-outcomes');
  }
}

@Module({
  imports: [AuthModule, RecordsModule],
  controllers: [ObligationsController],
})
export class ObligationsModule {}

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

function idParam(request: Authed, name: string): string {
  const value = request.params?.[name];
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
