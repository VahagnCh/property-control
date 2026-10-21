import { Inject, Injectable, type NestMiddleware } from '@nestjs/common';
import { json, urlencoded, type NextFunction, type Request, type Response } from 'express';
import { ACCESS_TOKEN_VERIFIER, verifyBearer, type AccessTokenVerifier } from '../auth/access-token.verifier.js';
import { earlyRequestStatus, isOcrPath, pathOnly } from '../common/path-safety.js';
import { OCR_RUNTIME, ocrDisabledBody, type OcrRuntime } from './ocr-runtime.js';

const JSON_LIMIT = '32kb';

interface ParserError {
  type?: string;
  status?: number;
}

@Injectable()
export class RequestGuardMiddleware implements NestMiddleware {
  private readonly jsonParser = json({ limit: JSON_LIMIT });
  private readonly formParser = urlencoded({ extended: false, limit: JSON_LIMIT });

  constructor(
    @Inject(OCR_RUNTIME) private readonly runtime: OcrRuntime,
    @Inject(ACCESS_TOKEN_VERIFIER) private readonly verifier: AccessTokenVerifier,
  ) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const url = pathOnly(req.originalUrl ?? req.url);
    if (isOcrPath(url) && this.runtime.enabled) {
      const verdict = verifyBearer(this.verifier, req.headers.authorization);
      if (!verdict.ok) {
        req.resume();
        res.status(401).json({ statusCode: 401, message: verdict.message });
        return;
      }
    }
    const status = earlyRequestStatus(url, this.runtime.enabled);
    if (status === 501) {
      req.resume();
      res.status(501).json(ocrDisabledBody());
      return;
    }
    if (status === 400) {
      req.resume();
      res.status(400).json({
        statusCode: 400,
        message: 'Invalid path parameter.',
      });
      return;
    }
    this.jsonParser(req, res, (error?: unknown) => {
      if (error) {
        writeParseError(res, error);
        return;
      }
      this.formParser(req, res, (formError?: unknown) => {
        if (formError) {
          writeParseError(res, formError);
          return;
        }
        next();
      });
    });
  }
}

function writeParseError(res: Response, error: unknown): void {
  const parserError = error as ParserError;
  const tooLarge = parserError.type === 'entity.too.large' || parserError.status === 413;
  const status = tooLarge ? 413 : 400;
  if (res.headersSent) {
    return;
  }
  res.status(status).json({
    statusCode: status,
    message: tooLarge ? 'Payload too large.' : 'Invalid JSON payload.',
  });
}
