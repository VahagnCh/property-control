/**
 * S3-compatible object storage settings. No provider SDK is imported.
 * Upload routes stay unimplemented; this only reads configuration.
 */
export interface ObjectStorageConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

const TRUTHY = new Set(['1', 'true', 'yes', 'on']);

export function loadObjectStorageConfig(env: NodeJS.ProcessEnv): ObjectStorageConfig | undefined {
  const endpoint = env.OBJECT_STORAGE_ENDPOINT?.trim() ?? '';
  const region = env.OBJECT_STORAGE_REGION?.trim() ?? '';
  const bucket = env.OBJECT_STORAGE_BUCKET?.trim() ?? '';
  const accessKeyId = env.OBJECT_STORAGE_ACCESS_KEY_ID?.trim() ?? '';
  const secretAccessKey = env.OBJECT_STORAGE_SECRET_ACCESS_KEY?.trim() ?? '';
  if (!endpoint && !region && !bucket && !accessKeyId && !secretAccessKey) {
    return undefined;
  }
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new Error('OBJECT_STORAGE_ENDPOINT must be an http(s) URL.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('OBJECT_STORAGE_ENDPOINT must be an http(s) URL.');
  }
  if (!region || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error(
      'OBJECT_STORAGE_REGION, OBJECT_STORAGE_BUCKET, OBJECT_STORAGE_ACCESS_KEY_ID, and OBJECT_STORAGE_SECRET_ACCESS_KEY are required with an endpoint.',
    );
  }
  const force = env.OBJECT_STORAGE_FORCE_PATH_STYLE?.trim().toLowerCase() ?? '';
  return {
    endpoint,
    region,
    bucket,
    accessKeyId,
    secretAccessKey,
    forcePathStyle: TRUTHY.has(force),
  };
}
