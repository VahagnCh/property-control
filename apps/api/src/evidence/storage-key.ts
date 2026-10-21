import { randomUUID } from 'node:crypto';

/** Trust rev f.5: `{env}/evidence/{uuid}` and `{env}/documents/{uuid}`. */
export const STORAGE_ENVS = ['staging', 'prod'] as const;

export type StorageEnv = (typeof STORAGE_ENVS)[number];

const UUID_V4 = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';

export const EVIDENCE_SOURCE_KEY_SQL = `^(staging|prod)/evidence/${UUID_V4}$`;
export const DOCUMENT_SOURCE_KEY_SQL = `^(staging|prod)/documents/${UUID_V4}$`;

export const EVIDENCE_SOURCE_KEY = new RegExp(EVIDENCE_SOURCE_KEY_SQL);
export const DOCUMENT_SOURCE_KEY = new RegExp(DOCUMENT_SOURCE_KEY_SQL);

export function storageEnvFromConfig(env: NodeJS.ProcessEnv): StorageEnv {
  const value = env.OBJECT_STORAGE_ENV?.trim() ?? '';
  if (value === 'staging' || value === 'prod') {
    return value;
  }
  throw new Error('OBJECT_STORAGE_ENV must be staging or prod.');
}

export function evidenceSourceKey(envName: StorageEnv, uuid: string = randomUUID()): string {
  return `${envName}/evidence/${uuid}`;
}

export function documentSourceKey(envName: StorageEnv, uuid: string = randomUUID()): string {
  return `${envName}/documents/${uuid}`;
}

/** True only for the new shape. An old `properties/...` key is false. */
export function isAcceptedSourceKey(key: string): boolean {
  return EVIDENCE_SOURCE_KEY.test(key) || DOCUMENT_SOURCE_KEY.test(key);
}
