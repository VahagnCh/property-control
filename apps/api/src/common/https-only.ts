import type { NextFunction, Request, Response } from 'express';

/** One year. A shorter max-age is raised to this floor. */
export const HSTS_MIN_MAX_AGE = 31_536_000;

/**
 * HSTS for the response. includeSubDomains stays off for an onrender.com
 * hostname. Turn HSTS_INCLUDE_SUBDOMAINS on for duerecord.mx only after every
 * subdomain is HTTPS-only. HSTS_PRELOAD is added only together with
 * includeSubDomains, and only after that is verified.
 */
export function hstsHeader(env: NodeJS.ProcessEnv = process.env): string {
  const parsed = Number(env.HSTS_MAX_AGE);
  const requested = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : HSTS_MIN_MAX_AGE;
  const maxAge = Math.max(requested, HSTS_MIN_MAX_AGE);
  const include = env.HSTS_INCLUDE_SUBDOMAINS === 'true';
  const preload = include && env.HSTS_PRELOAD === 'true';
  let header = `max-age=${maxAge}`;
  if (include) {
    header += '; includeSubDomains';
  }
  if (preload) {
    header += '; preload';
  }
  return header;
}

/**
 * Production requires the rightmost X-Forwarded-Proto value to be https.
 * A missing header is http once trust proxy is on, so only an exact
 * GET /v1/health is exempt, and that response carries no HSTS.
 */
export function enforceHttps(req: Request, res: Response, next: NextFunction): void {
  if (process.env.NODE_ENV !== 'production') {
    next();
    return;
  }
  const proto = rightmostProto(req);
  if (proto === undefined) {
    if (isExactHealth(req)) {
      next();
      return;
    }
    rejectHttp(res);
    return;
  }
  if (proto.toLowerCase() !== 'https') {
    rejectHttp(res);
    return;
  }
  res.setHeader('Strict-Transport-Security', hstsHeader());
  next();
}

function rightmostProto(req: Request): string | undefined {
  const raw = req.headers['x-forwarded-proto'];
  if (raw === undefined) {
    return undefined;
  }
  const value = Array.isArray(raw) ? raw.join(',') : raw;
  const parts = value.split(',').map((part) => part.trim()).filter(Boolean);
  return parts.length === 0 ? undefined : parts[parts.length - 1];
}

function isExactHealth(req: Request): boolean {
  return req.method === 'GET' && req.path === '/v1/health';
}

function rejectHttp(res: Response): void {
  res.status(403).json({
    statusCode: 403,
    error: 'https_required',
    message: 'HTTPS is required.',
  });
}
