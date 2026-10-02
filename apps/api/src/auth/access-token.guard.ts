import { CanActivate, Injectable, UnauthorizedException } from '@nestjs/common';

/**
 * Fail-closed placeholder for Trust access JWTs.
 * Not registered on routes in this scaffold, so the process can boot and the
 * stub routes can be called. When it is attached, every request is rejected
 * until JWKS validation exists. This API does not mint access or refresh tokens.
 */
@Injectable()
export class AccessTokenGuard implements CanActivate {
  canActivate(): boolean {
    throw new UnauthorizedException(
      'Access token validation is not implemented. Trust mints tokens; this API only validates them.',
    );
  }
}
