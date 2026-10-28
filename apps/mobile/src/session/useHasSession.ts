import { useState } from 'react';
import { readSession } from './readSession';

/**
 * Session flag for this mount.
 * TODO: when auth lands, subscribe to the session here and update state.
 * Read it from expo-secure-store. Never from AsyncStorage.
 * There is no session subscription yet, so this reads once and does not call readSession on every render.
 */
export function useHasSession(): boolean {
  const [hasSession] = useState(() => readSession());
  return hasSession;
}
