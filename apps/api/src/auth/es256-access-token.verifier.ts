import { verifyAccessToken, type AuthJwtConfig, type AuthJwtMaterial, type AuthJwtPublicKey } from './access-jwt.js';
import type { AccessTokenVerdict, AccessTokenVerifier } from './access-token.verifier.js';
import type { SessionDirectory } from './session-directory.js';

export class Es256AccessTokenVerifier implements AccessTokenVerifier {
  private readonly publicKeys: AuthJwtPublicKey[];

  constructor(
    keys: AuthJwtConfig | AuthJwtMaterial,
    private readonly sessions: SessionDirectory,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.publicKeys = 'publicKeys' in keys ? keys.publicKeys : [keys];
  }

  async verify(token: string): Promise<AccessTokenVerdict> {
    const result = verifyAccessToken(this.publicKeys, token, this.now());
    if (!result.ok) {
      return result.reason;
    }
    if (await this.sessions.isRevoked(result.claims.sid)) {
      return 'invalid';
    }
    return { sub: result.claims.sub, sid: result.claims.sid };
  }
}
