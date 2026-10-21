import { CanActivate, HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { OCR_RUNTIME, ocrDisabledBody, type OcrRuntime } from './ocr-runtime.js';

/** OCR routes only. When the flag is off, return 501 before param and body pipes. */
@Injectable()
export class OcrEnabledGuard implements CanActivate {
  constructor(@Inject(OCR_RUNTIME) private readonly runtime: OcrRuntime) {}

  canActivate(): boolean {
    if (this.runtime.enabled) {
      return true;
    }
    throw new HttpException(ocrDisabledBody(), HttpStatus.NOT_IMPLEMENTED);
  }
}
