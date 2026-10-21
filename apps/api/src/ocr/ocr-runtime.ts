export const OCR_RUNTIME = Symbol('OCR_RUNTIME');

export interface OcrRuntime {
  enabled: boolean;
  /** Cap on jobs that hold a slot for one property. */
  jobsMax: number;
  /** Safety ceiling across every property. Defaults to 20 × jobsMax when omitted. */
  jobsGlobalMax?: number;
  jobTtlMs: number;
}

const TRUTHY = new Set(['1', 'true', 'yes', 'on']);

export function isOcrStubEnabled(value: string | undefined): boolean {
  if (value === undefined) {
    return false;
  }
  return TRUTHY.has(value.trim().toLowerCase());
}

function positiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') {
    return fallback;
  }
  if (!/^[1-9]\d*$/.test(value.trim())) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

export function loadOcrRuntime(env: NodeJS.ProcessEnv = process.env): OcrRuntime {
  return {
    enabled: isOcrStubEnabled(env.OCR_STUB_ENABLED),
    jobsMax: positiveInt(env.OCR_JOBS_MAX, 50),
    jobsGlobalMax: positiveInt(env.OCR_JOBS_GLOBAL_MAX, 1000),
    jobTtlMs: positiveInt(env.OCR_JOB_TTL_MS, 15 * 60 * 1000),
  };
}

export function ocrDisabledBody(): {
  statusCode: 501;
  module: 'ocr';
  message: string;
} {
  return {
    statusCode: 501,
    module: 'ocr',
    message:
      'Scaffold placeholder. OCR is disabled until OCR_STUB_ENABLED is set to 1, true, yes, or on.',
  };
}
