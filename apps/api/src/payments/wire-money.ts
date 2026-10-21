/**
 * API wire money. `amount` is a decimal string such as "1234.50", never a
 * JSON number or a float. `currency` is MXN only. The database stores the
 * same value as integer centavos (BIGINT). Convert only at the repository
 * boundary, with integer arithmetic, never through a float.
 */
export interface WireMoney {
  amount: string;
  currency: 'MXN';
}

export const WIRE_MONEY_EXAMPLE: WireMoney = {
  amount: '1234.50',
  currency: 'MXN',
};

const WIRE_AMOUNT = /^(?:0|[1-9]\d*)(?:\.(\d{2}))?$/;

/** Decimal pesos to integer centavos. Rejects anything that is not the wire form. */
export function wireAmountToCentavos(amount: string): bigint {
  const match = WIRE_AMOUNT.exec(amount);
  if (!match) {
    throw new Error('amount must be a decimal peso string such as "1234.50".');
  }
  const whole = amount.split('.')[0] ?? '0';
  const frac = match[1] ?? '00';
  return BigInt(whole) * 100n + BigInt(frac);
}

/** Integer centavos to the wire decimal. No float division. */
export function centavosToWireAmount(centavos: bigint): string {
  const negative = centavos < 0n;
  const abs = negative ? -centavos : centavos;
  const whole = abs / 100n;
  const frac = (abs % 100n).toString().padStart(2, '0');
  return `${negative ? '-' : ''}${whole.toString()}.${frac}`;
}

/**
 * BIGINT from Postgres or Prisma into the in-memory ledger's number.
 * The conversion is BigInt to a safe integer, not a decimal float parse.
 */
export function centavosToLedgerNumber(value: bigint | number | string | null): number | null {
  if (value === null) {
    return null;
  }
  const cents = typeof value === 'bigint' ? value : BigInt(value);
  if (cents > BigInt(Number.MAX_SAFE_INTEGER) || cents < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new Error('centavos do not fit a safe integer.');
  }
  return Number(cents);
}
