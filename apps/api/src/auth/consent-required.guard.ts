import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { CONSENT_GATE, type ConsentGate } from '../consent/consent.gate.js';
import { OCR_ERROR, ocrUnauthorized } from '../ocr/ocr-errors.js';

/**
 * Writes only. Reads do not use this guard.
 * A viewer is already 403 from the membership guard, which runs first.
 */
@Injectable()
export class ConsentRequiredGuard implements CanActivate {
  constructor(@Inject(CONSENT_GATE) private readonly consent: ConsentGate) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ accessToken?: { sub: string } }>();
    const userId = request.accessToken?.sub;
    if (!userId) {
      throw ocrUnauthorized(OCR_ERROR.tokenMissing, 'Missing access token.');
    }
    if (!(await this.consent.hasCurrent(userId))) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'consent_required',
        message: 'Accept the current aviso before this write.',
      });
    }
    return true;
  }
}
