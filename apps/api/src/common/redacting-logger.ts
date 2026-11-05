import { ConsoleLogger } from '@nestjs/common';
import { redactForLog } from './log-redaction.js';

/** Nest's logger, with every message passed through redactForLog first. */
export class RedactingLogger extends ConsoleLogger {
  override log(message: unknown, ...optionalParams: unknown[]): void {
    super.log(redactUnknown(message), ...optionalParams.map(redactUnknown));
  }

  override error(message: unknown, ...optionalParams: unknown[]): void {
    super.error(redactUnknown(message), ...optionalParams.map(redactUnknown));
  }

  override warn(message: unknown, ...optionalParams: unknown[]): void {
    super.warn(redactUnknown(message), ...optionalParams.map(redactUnknown));
  }

  override debug(message: unknown, ...optionalParams: unknown[]): void {
    super.debug(redactUnknown(message), ...optionalParams.map(redactUnknown));
  }

  override verbose(message: unknown, ...optionalParams: unknown[]): void {
    super.verbose(redactUnknown(message), ...optionalParams.map(redactUnknown));
  }

  override fatal(message: unknown, ...optionalParams: unknown[]): void {
    super.fatal(redactUnknown(message), ...optionalParams.map(redactUnknown));
  }
}

function redactUnknown(value: unknown): unknown {
  if (typeof value === 'string') {
    return redactForLog(value);
  }
  if (value instanceof Error) {
    const redacted = new Error(redactForLog(value.message));
    redacted.name = value.name;
    redacted.stack = value.stack ? redactForLog(value.stack) : undefined;
    return redacted;
  }
  return value;
}
