/**
 * There is no signed-in session in this client yet.
 * When auth lands, read it from expo-secure-store. Never from AsyncStorage.
 */
export function readSession(): boolean {
  return false;
}
