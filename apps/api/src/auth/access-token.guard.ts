import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { ocrUnauthorized } from '../ocr/ocr-errors.js';
import { ACCESS_TOKEN_VERIFIER, verifyBearer, type AccessTokenVerifier } from './access-token.verifier.js';

interface RequestWithAuth {
  headers: Record<string, string | string[] | undefined>;
  accessToken?: { sub: string };
}

/**
 * Fail-closed access-token check. A missing, invalid, or expired token is 401.
 * The default verifier rejects every token. This API never mints one.
 */
@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(@Inject(ACCESS_TOKEN_VERIFIER) private readonly verifier: AccessTokenVerifier) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithAuth>();
    const header = request.headers.authorization ?? request.headers.Authorization;
    const verdict = verifyBearer(this.verifier, header);
    if (!verdict.ok) {
      throw ocrUnauthorized(verdict.error, verdict.message);
    }
    request.accessToken = { sub: verdict.sub };
    return true;
  }
}
