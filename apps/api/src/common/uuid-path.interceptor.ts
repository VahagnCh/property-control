import {
  BadRequestException,
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { type Observable } from 'rxjs';
import { isOcrPath, isTraversal, isUuid, pathOnly } from './path-safety.js';

/**
 * Rejects non-UUID id params on scaffold routes.
 * OCR paths are skipped: the flag guard returns 501 before this runs when
 * OCR is off, and the OCR middleware/membership guard own OCR path checks.
 */
@Injectable()
export class UuidPathInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<{
      originalUrl?: string;
      url?: string;
      params?: Record<string, unknown>;
    }>();
    const url = pathOnly(request.originalUrl ?? request.url ?? '');
    if (!isOcrPath(url)) {
      if (isTraversal(url)) {
        throw new BadRequestException('Invalid path parameter.');
      }
      for (const [name, value] of Object.entries(request.params ?? {})) {
        if (!name.endsWith('Id')) {
          continue;
        }
        if (typeof value !== 'string' || !isUuid(value) || isTraversal(value)) {
          throw new BadRequestException('Invalid path parameter.');
        }
      }
    }
    return next.handle();
  }
}
