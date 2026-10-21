import type { NextFunction, Request, Response } from 'express';

export const HSTS_HEADER = 'max-age=31536000';

/**
 * Production refuses a trusted hop that arrived as plain HTTP.
 * A missing X-Forwarded-Proto is left alone so a platform health check
 * that does not set the header can still reach /v1/health.
 * HSTS is set only on the HTTPS response.
 */
export function enforceHttps(req: Request, res: Response, next: NextFunction): void {
  if (process.env.NODE_ENV !== 'production') {
    next();
    return;
  }
  if (req.protocol === 'http') {
    res.status(403).json({
      statusCode: 403,
      error: 'https_required',
      message: 'HTTPS is required.',
    });
    return;
  }
  if (req.protocol === 'https') {
    res.setHeader('Strict-Transport-Security', HSTS_HEADER);
  }
  next();
}
