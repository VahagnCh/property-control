import { ArgumentsHost, Catch, ExceptionFilter, NotFoundException } from '@nestjs/common';
import type { Response } from 'express';
import { notFoundBody } from './not-found.js';

/** Rewrites every 404, including Nest's unknown-route body, to `notFoundBody()`. */
@Catch(NotFoundException)
export class NotFoundFilter implements ExceptionFilter {
  catch(_exception: NotFoundException, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    response.status(404).json(notFoundBody());
  }
}
