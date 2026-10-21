import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ACCESS_TOKEN_VERIFIER, type AccessTokenVerifier } from './access-token.verifier.js';

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
    const value = Array.isArray(header) ? header[0] : header;
    if (!value || !value.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing access token.');
    }
    const token = value.slice('Bearer '.length).trim();
    if (!token) {
      throw new UnauthorizedException('Missing access token.');
    }
    const verdict = this.verifier.verify(token);
    if (verdict === 'expired') {
      throw new UnauthorizedException('Expired access token.');
    }
    if (!verdict || verdict === 'invalid' || typeof verdict.sub !== 'string' || verdict.sub.length === 0) {
      throw new UnauthorizedException('Invalid access token.');
    }
    request.accessToken = { sub: verdict.sub };
    return true;
  }
}
