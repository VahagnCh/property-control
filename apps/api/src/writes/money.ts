import { UnprocessableEntityException } from '@nestjs/common';
import { wireAmountToCentavos } from '../payments/wire-money.js';

/** EC-2.1. Above this many centavos the amount is rejected. */
export const MAX_CENTAVOS = 2_147_483_647n;

/**
 * Positive peso string to integer centavos. Zero, negatives, more than two
 * fraction digits, JSON numbers, and values above {@link MAX_CENTAVOS} are 422.
 * The conversion uses BigInt, never a float.
 */
export function parsePositiveCentavos(amount: unknown): bigint {
  if (typeof amount !== 'string') {
    throw amountInvalid();
  }
  let cents: bigint;
  try {
    cents = wireAmountToCentavos(amount);
  } catch {
    throw amountInvalid();
  }
  if (cents <= 0n || cents > MAX_CENTAVOS) {
    throw amountInvalid();
  }
  return cents;
}

function amountInvalid(): UnprocessableEntityException {
  return new UnprocessableEntityException({
    statusCode: 422,
    error: 'amount_invalid',
    message: 'amount must be a positive decimal peso string with at most two fraction digits.',
  });
}
