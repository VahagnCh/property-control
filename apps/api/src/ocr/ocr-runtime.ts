export const OCR_RUNTIME = Symbol('OCR_RUNTIME');

/** Defaults used when OCR_CONFIDENCE_ALTA / OCR_CONFIDENCE_MEDIA are unset. */
export const DEFAULT_CONFIDENCE_BANDS = { alta: 0.9, media: 0.8 } as const;

export interface ConfidenceBands {
  alta: number;
  media: number;
}

export interface OcrRuntime {
  enabled: boolean;
  /** Cap on jobs that hold a slot for one property. */
  jobsMax: number;
  /** Safety ceiling across every property. Defaults to 20 × jobsMax when omitted. */
  jobsGlobalMax?: number;
  jobTtlMs: number;
  /** Alta and media cutoffs. Omitted means 0.90 and 0.80. */
  confidenceBands?: ConfidenceBands;
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

function unitInterval(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    return fallback;
  }
  return parsed;
}

export function resolveConfidenceBands(runtime: OcrRuntime): ConfidenceBands {
  const bands = runtime.confidenceBands;
  if (
    !bands ||
    !Number.isFinite(bands.alta) ||
    !Number.isFinite(bands.media) ||
    bands.alta < 0 ||
    bands.alta > 1 ||
    bands.media < 0 ||
    bands.media > 1
  ) {
    return { alta: DEFAULT_CONFIDENCE_BANDS.alta, media: DEFAULT_CONFIDENCE_BANDS.media };
  }
  return { alta: bands.alta, media: bands.media };
}

export function loadOcrRuntime(env: NodeJS.ProcessEnv = process.env): OcrRuntime {
  return {
    enabled: isOcrStubEnabled(env.OCR_STUB_ENABLED),
    jobsMax: positiveInt(env.OCR_JOBS_MAX, 50),
    jobsGlobalMax: positiveInt(env.OCR_JOBS_GLOBAL_MAX, 1000),
    jobTtlMs: positiveInt(env.OCR_JOB_TTL_MS, 15 * 60 * 1000),
    confidenceBands: {
      alta: unitInterval(env.OCR_CONFIDENCE_ALTA, DEFAULT_CONFIDENCE_BANDS.alta),
      media: unitInterval(env.OCR_CONFIDENCE_MEDIA, DEFAULT_CONFIDENCE_BANDS.media),
    },
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
