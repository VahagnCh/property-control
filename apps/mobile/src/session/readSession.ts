/**
 * In-memory session flag. Tokens stay in expo-secure-store, never here and
 * never in AsyncStorage. Screens subscribe; they do not read the store.
 * A secure-store read failure sets `unavailable` and does not sign the user out.
 */

export type SessionSnapshot = {
  signedIn: boolean;
  expired: boolean;
  unavailable: boolean;
};

const INITIAL: SessionSnapshot = {
  signedIn: false,
  expired: false,
  unavailable: false,
};

let snapshot: SessionSnapshot = { ...INITIAL };
const listeners = new Set<() => void>();

export function readSession(): boolean {
  return snapshot.signedIn;
}

export function readSessionSnapshot(): SessionSnapshot {
  return { ...snapshot };
}

export function subscribeSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setSessionSignedIn(): void {
  publish({ signedIn: true, expired: false, unavailable: false });
}

/** A refresh rejection cleared the store. This is the sign-in screen. */
export function setSessionExpired(): void {
  publish({ signedIn: false, expired: true, unavailable: false });
}

/** A deliberate logout cleared the store. */
export function setSessionSignedOut(): void {
  publish({ signedIn: false, expired: false, unavailable: false });
}

/**
 * The secure store could not be read. Keep `signedIn` as it was.
 * Callers must show the connecting retry state, not the sign-in screen.
 */
export function setSessionUnavailable(): void {
  publish({ signedIn: snapshot.signedIn, expired: snapshot.expired, unavailable: true });
}

/** A successful read found no tokens. This is not a store failure. */
export function noteEmptyStore(): void {
  publish({ signedIn: false, expired: snapshot.expired, unavailable: false });
}

export function resetSessionState(): void {
  publish({ ...INITIAL });
}

function publish(next: SessionSnapshot): void {
  snapshot = next;
  for (const listener of [...listeners]) {
    listener();
  }
}
