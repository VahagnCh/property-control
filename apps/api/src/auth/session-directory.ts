/** In-process session revocation. Access-token checks read this on every request. */
export class SessionDirectory {
  private readonly revoked = new Set<string>();

  revoke(sid: string): void {
    this.revoked.add(sid);
  }

  isRevoked(sid: string): boolean {
    return this.revoked.has(sid);
  }
}

export const SESSION_DIRECTORY = Symbol('SESSION_DIRECTORY');
export const AUTH_CLOCK = Symbol('AUTH_CLOCK');
export const AUTH_JWT = Symbol('AUTH_JWT');
