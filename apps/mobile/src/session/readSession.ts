/**
 * There is no signed-in session in this client yet.
 * When auth lands, read the flag from a subscription over `src/auth/tokenStore.ts`.
 * That module uses expo-secure-store. Never AsyncStorage.
 */
export function readSession(): boolean {
  return false;
}
