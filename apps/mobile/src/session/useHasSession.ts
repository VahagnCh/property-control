import { useState } from 'react';
import { readSession } from './readSession';

/**
 * Session flag for this mount.
 * TODO: subscribe here when a session subscription exists.
 * The flag will come from src/auth/tokenStore.ts (expo-secure-store). Never AsyncStorage.
 * There is no session subscription yet, so this reads once and does not call readSession on every render.
 */
export function useHasSession(): boolean {
  const [hasSession] = useState(() => readSession());
  return hasSession;
}
