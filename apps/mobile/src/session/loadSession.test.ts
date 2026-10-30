import { TokenStoreUnavailableError, type TokenStore } from '../auth/tokenStore';
import { hydrateSession } from './loadSession';
import { readSession, readSessionSnapshot, resetSessionState, setSessionSignedIn } from './readSession';

function store(read: TokenStore['read'], clear = jest.fn(async () => undefined)): TokenStore {
  return {
    read,
    async save() {
      return undefined;
    },
    clear,
  };
}

describe('hydrateSession', () => {
  beforeEach(() => {
    resetSessionState();
  });

  it('does not sign the user out when SecureStore cannot be read', async () => {
    setSessionSignedIn();
    const clear = jest.fn(async () => undefined);
    await hydrateSession(
      store(async () => {
        throw new TokenStoreUnavailableError();
      }, clear),
      'ios',
    );
    expect(readSession()).toBe(true);
    expect(readSessionSnapshot()).toEqual({ signedIn: true, expired: false, unavailable: true });
    expect(clear).not.toHaveBeenCalled();
  });

  it('treats an empty store as signed out and does not mark it unavailable', async () => {
    await hydrateSession(store(async () => null), 'ios');
    expect(readSessionSnapshot()).toEqual({ signedIn: false, expired: false, unavailable: false });
  });

  it('does not read the store on web', async () => {
    const read = jest.fn(async () => ({ accessToken: 'a', refreshToken: 'b' }));
    await hydrateSession(store(read), 'web');
    expect(read).not.toHaveBeenCalled();
    expect(readSession()).toBe(false);
  });
});
