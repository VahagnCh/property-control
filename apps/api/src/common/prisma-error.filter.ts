import { Catch, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';

/**
 * Prisma errors include the rejected row. Respond with a fixed body and do not
 * log that message.
 */
@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaErrorFilter implements ExceptionFilter {
  catch(exception: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    if (response.headersSent) {
      return;
    }
    if (exception.code === 'P2002') {
      response.status(409).json({
        statusCode: 409,
        error: 'idempotency_key_reused',
        message: 'This idempotency key was already used with a different request.',
      });
      return;
    }
    response.status(500).json({
      statusCode: 500,
      error: 'persistence_failed',
      message: 'The request could not be stored.',
    });
  }
}
