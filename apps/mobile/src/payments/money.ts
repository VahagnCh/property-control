const WIRE_AMOUNT = /^(\d+)(?:\.(\d{1,2}))?$/;
const INT32_MAX_CENTAVOS = 2147483647;

export type MoneyParseCode =
  | 'empty'
  | 'negative'
  | 'invalid'
  | 'too_many_decimals'
  | 'overflow'
  | 'currency';

/** Wire money is a decimal amount plus a currency code. MXN is the only code. */
export type WireMoney = {
  amount: string;
  currency: 'MXN';
};

export class MoneyParseError extends Error {
  readonly code: MoneyParseCode;

  constructor(code: MoneyParseCode) {
    super(code);
    this.name = 'MoneyParseError';
    this.code = code;
  }
}

/**
 * Wire decimal string ("1234.50") to integer centavos. Digit arithmetic only:
 * no Number(amount) * 100, so values like "0.10" stay exact.
 */
export function parseMxnToCentavos(wire: string): number {
  if (typeof wire !== 'string') {
    throw new MoneyParseError('invalid');
  }
  const trimmed = wire.trim();
  if (trimmed === '') {
    throw new MoneyParseError('empty');
  }
  if (trimmed.startsWith('-')) {
    throw new MoneyParseError('negative');
  }
  if (/^\d+\.\d{3,}$/.test(trimmed)) {
    throw new MoneyParseError('too_many_decimals');
  }
  const match = WIRE_AMOUNT.exec(trimmed);
  if (!match) {
    throw new MoneyParseError('invalid');
  }
  const whole = parseDigits(match[1] ?? '');
  const fraction = match[2] ?? '';
  const cents = parseDigits((fraction + '00').slice(0, 2));
  const centavos = whole * 100 + cents;
  if (!Number.isSafeInteger(centavos) || centavos > INT32_MAX_CENTAVOS) {
    throw new MoneyParseError('overflow');
  }
  return centavos;
}

export function formatWireAmount(centavos: number): string {
  assertCentavos(centavos);
  const whole = Math.trunc(centavos / 100);
  const fraction = centavos % 100;
  return `${whole}.${String(fraction).padStart(2, '0')}`;
}

export function formatWireMoney(centavos: number): WireMoney {
  return { amount: formatWireAmount(centavos), currency: 'MXN' };
}

/** Rejects any currency other than the exact code `MXN`, then parses the amount. */
export function parseWireMoney(wire: { amount?: string; currency?: string }): number {
  if (wire.currency !== 'MXN') {
    throw new MoneyParseError('currency');
  }
  return parseMxnToCentavos(wire.amount ?? '');
}

/** es-MX display. Separate from the wire value: "$1,234.50" is not "1234.50". */
export function formatMxnDisplay(centavos: number): string {
  const wire = formatWireAmount(centavos);
  const [whole, fraction] = wire.split('.');
  return `$${groupThousands(whole ?? '0')}.${fraction}`;
}

function assertCentavos(centavos: number): void {
  if (!Number.isInteger(centavos) || centavos < 0 || centavos > INT32_MAX_CENTAVOS) {
    throw new MoneyParseError('invalid');
  }
}

function parseDigits(digits: string): number {
  let value = 0;
  for (const char of digits) {
    const n = char.charCodeAt(0) - 48;
    if (n < 0 || n > 9) {
      throw new MoneyParseError('invalid');
    }
    value = value * 10 + n;
  }
  return value;
}

function groupThousands(whole: string): string {
  let grouped = '';
  for (let index = 0; index < whole.length; index += 1) {
    if (index > 0 && (whole.length - index) % 3 === 0) {
      grouped += ',';
    }
    grouped += whole[index];
  }
  return grouped;
}
