import { createAppApiClient } from '../api/createAppClient';
import type { ApiClient } from '../api/client';

let singleton: ApiClient | null = null;

/**
 * The signed-in shell shares one client so a retry keeps its idempotency key.
 * Jest renders the shell without a network, so this returns null there.
 * Pending keys still live only in that process: killing the app drops them.
 */
export function liveAppClient(): ApiClient | null {
  if (process.env.JEST_WORKER_ID) {
    return null;
  }
  singleton ??= createAppApiClient();
  return singleton;
}
