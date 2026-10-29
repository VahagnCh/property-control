import { verifyAccessToken, type AuthJwtConfig } from './access-jwt.js';
import type { AccessTokenVerdict, AccessTokenVerifier } from './access-token.verifier.js';
import type { SessionDirectory } from './session-directory.js';

export class Es256AccessTokenVerifier implements AccessTokenVerifier {
  constructor(
    private readonly config: AuthJwtConfig,
    private readonly sessions: SessionDirectory,
    private readonly now: () => Date = () => new Date(),
  ) {}

  verify(token: string): AccessTokenVerdict {
    const result = verifyAccessToken(this.config, token, this.now());
    if (!result.ok) {
      return result.reason;
    }
    if (this.sessions.isRevoked(result.claims.sid)) {
      return 'invalid';
    }
    return { sub: result.claims.sub, sid: result.claims.sid };
  }
}
