import { useEffect, useState } from 'react';
import { readSession, readSessionSnapshot, subscribeSession, type SessionSnapshot } from './readSession';

/**
 * Live session flag. The value updates when the in-memory session changes.
 * It does not read again on an ordinary rerender, and it does not touch AsyncStorage.
 */
export function useHasSession(): boolean {
  const [hasSession, setHasSession] = useState(() => readSession());
  useEffect(() => subscribeSession(() => setHasSession(readSession())), []);
  return hasSession;
}

export function useSessionSnapshot(): SessionSnapshot {
  const [current, setCurrent] = useState(() => readSessionSnapshot());
  useEffect(() => subscribeSession(() => setCurrent(readSessionSnapshot())), []);
  return current;
}
