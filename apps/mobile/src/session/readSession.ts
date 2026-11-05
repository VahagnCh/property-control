/**
 * In-memory session flag. Tokens stay in expo-secure-store, never here and
 * never in AsyncStorage. Screens subscribe; they do not read the store.
 * A secure-store read failure sets `unavailable` and does not sign the user out.
 */

export type SessionSnapshot = {
  signedIn: boolean;
  expired: boolean;
  unavailable: boolean;
  /** False until the first secure-store read finishes. Not the sign-in screen. */
  hydrated: boolean;
  /** The store read did not finish. Sign-in is shown, with Reintentar, and no data. */
  hydrateTimedOut: boolean;
};

const INITIAL: SessionSnapshot = {
  signedIn: false,
  expired: false,
  unavailable: false,
  hydrated: false,
  hydrateTimedOut: false,
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
  publish({ signedIn: true, expired: false, unavailable: false, hydrated: true, hydrateTimedOut: false });
}

/** A refresh rejection cleared the store. This is the sign-in screen. */
export function setSessionExpired(): void {
  publish({ signedIn: false, expired: true, unavailable: false, hydrated: true, hydrateTimedOut: false });
}

/** A deliberate logout cleared the store. */
export function setSessionSignedOut(): void {
  publish({ signedIn: false, expired: false, unavailable: false, hydrated: true, hydrateTimedOut: false });
}

/**
 * The secure store could not be read. Keep `signedIn` as it was.
 * Callers must show the connecting retry state, not the sign-in screen.
 */
export function setSessionUnavailable(): void {
  publish({
    signedIn: snapshot.signedIn,
    expired: snapshot.expired,
    unavailable: true,
    hydrated: true,
    hydrateTimedOut: false,
  });
}

/** A successful read found no tokens. This is not a store failure. */
export function noteEmptyStore(): void {
  publish({ signedIn: false, expired: snapshot.expired, unavailable: false, hydrated: true, hydrateTimedOut: false });
}

/** The store read is still pending. Show sign-in and Reintentar, never property data. */
export function markHydrateTimedOut(): void {
  if (snapshot.hydrated) {
    return;
  }
  publish({ ...snapshot, hydrateTimedOut: true });
}

/** The store read finished without changing the signed-in flag. Used on web. */
export function markSessionHydrated(): void {
  if (snapshot.hydrated) {
    return;
  }
  publish({ ...snapshot, hydrated: true });
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
