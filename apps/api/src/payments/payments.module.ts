import { Body, Controller, Get, Headers, Inject, Module, Patch, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AccessTokenGuard } from '../auth/access-token.guard.js';
import { AuthModule } from '../auth/auth.module.js';
import { ConsentRequiredGuard } from '../auth/consent-required.guard.js';
import { PropertyMembershipGuard } from '../auth/property-membership.guard.js';
import { pathOnly } from '../common/path-safety.js';
import { scaffoldNotReady } from '../common/scaffold.response.js';
import { RecordsModule } from '../writes/records.module.js';
import { RecordsService } from '../writes/records.service.js';

/**
 * Payment routes record a payment the member already made.
 * A correction is POST :paymentId/void, which stays a stub. There is no DELETE.
 * amount on the wire is a decimal peso string plus currency MXN, never a float.
 * The database stores integer centavos. This does not move money.
 */
@Controller('properties/:propertyId/payments')
export class PaymentsController {
  constructor(@Inject(RecordsService) private readonly records: RecordsService) {}

  @Get()
  @UseGuards(AccessTokenGuard, PropertyMembershipGuard)
  list(@Req() request: Authed) {
    return this.records.listPayments(propertyId(request));
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
      this.records.createPayment(subject(request), propertyId(request), idempotencyKey, routeOf(request), body),
    );
  }

  @Get(':paymentId')
  @UseGuards(AccessTokenGuard, PropertyMembershipGuard)
  getOne(@Req() request: Authed) {
    return this.records.getPayment(propertyId(request), idParam(request, 'paymentId'));
  }

  @Patch(':paymentId')
  @UseGuards(AccessTokenGuard, PropertyMembershipGuard, ConsentRequiredGuard)
  update(
    @Req() request: Authed,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    return reply(
      res,
      this.records.updatePayment(
        subject(request),
        propertyId(request),
        idParam(request, 'paymentId'),
        idempotencyKey,
        routeOf(request),
        body,
      ),
    );
  }

  @Post(':paymentId/void')
  voidPayment(): never {
    return scaffoldNotReady('payments');
  }
}

@Module({
  imports: [AuthModule, RecordsModule],
  controllers: [PaymentsController],
})
export class PaymentsModule {}

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
