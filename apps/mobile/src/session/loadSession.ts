import { Platform } from 'react-native';
import { TokenStoreUnavailableError, secureTokenStore, type TokenStore } from '../auth/tokenStore';
import { noteEmptyStore, setSessionSignedIn, setSessionUnavailable } from './readSession';

/**
 * Reads the secure store once into the in-memory flag.
 * A read error never signs the user out and never means "show sign-in".
 * Web does not read the store: real sign-in is off there.
 */
export async function hydrateSession(
  store: TokenStore = secureTokenStore,
  os: string = Platform.OS,
): Promise<void> {
  if (os === 'web') {
    return;
  }
  try {
    const tokens = await store.read();
    if (tokens) {
      setSessionSignedIn();
      return;
    }
    noteEmptyStore();
  } catch (error) {
    if (error instanceof TokenStoreUnavailableError || error instanceof Error) {
      setSessionUnavailable();
    }
  }
}
