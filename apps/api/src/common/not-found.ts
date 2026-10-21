import { NotFoundException } from '@nestjs/common';

/** Shared 404. The message does not name the missing route or resource. */
export function notFoundBody(): {
  statusCode: 404;
  error: 'not_found';
  message: 'Not found.';
} {
  return {
    statusCode: 404,
    error: 'not_found',
    message: 'Not found.',
  };
}

export function notFoundException(): NotFoundException {
  return new NotFoundException(notFoundBody());
}
