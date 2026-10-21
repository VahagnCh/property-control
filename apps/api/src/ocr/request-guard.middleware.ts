import { Inject, Injectable, type NestMiddleware } from '@nestjs/common';
import { json, urlencoded, type NextFunction, type Request, type Response } from 'express';
import { earlyRequestStatus } from '../common/path-safety.js';
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

  constructor(@Inject(OCR_RUNTIME) private readonly runtime: OcrRuntime) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const status = earlyRequestStatus(req.originalUrl ?? req.url, this.runtime.enabled);
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
