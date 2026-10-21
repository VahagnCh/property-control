export interface MxAmountParse {
  /** Present only when one value is confident. Ambiguous input leaves this null. */
  canonical: string | null;
  lowConfidence: boolean;
}

export interface MxDateParse {
  canonical: string | null;
  lowConfidence: boolean;
  precision: 'day' | 'month';
}

const MONTHS: Record<string, number> = {
  ene: 1,
  enero: 1,
  jan: 1,
  january: 1,
  feb: 2,
  febrero: 2,
  february: 2,
  mar: 3,
  marzo: 3,
  march: 3,
  abr: 4,
  abril: 4,
  apr: 4,
  april: 4,
  may: 5,
  mayo: 5,
  jun: 6,
  junio: 6,
  june: 6,
  jul: 7,
  julio: 7,
  july: 7,
  ago: 8,
  agosto: 8,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  septiembre: 9,
  setiembre: 9,
  september: 9,
  oct: 10,
  octubre: 10,
  october: 10,
  nov: 11,
  noviembre: 11,
  november: 11,
  dic: 12,
  diciembre: 12,
  dec: 12,
  december: 12,
};

export function canonicalizeMxText(value: string): string {
  return value.normalize('NFC');
}

export function mxTextsEquivalent(left: string, right: string): boolean {
  return canonicalizeMxText(left) === canonicalizeMxText(right);
}

export function parseMxAmount(input: string): MxAmountParse | null {
  const compact = input
    .trim()
    .replace(/MXN/gi, '')
    .replace(/\$/g, '')
    .replace(/[\s\u00A0]/g, '');
  if (!compact || !/^[\d.,]+$/.test(compact)) {
    return null;
  }

  const lastDot = compact.lastIndexOf('.');
  const lastComma = compact.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    if (lastComma > lastDot) {
      return confidentDecimal(compact.replace(/\./g, '').replace(',', '.'));
    }
    return confidentDecimal(compact.replace(/,/g, ''));
  }
  if (lastComma >= 0) {
    const parts = compact.split(',');
    if (parts.length === 2 && parts[1] && parts[1].length <= 2 && /^\d+$/.test(parts[0] ?? '')) {
      return confidentDecimal(`${parts[0]}.${(parts[1] ?? '').padEnd(2, '0')}`);
    }
    if (
      parts.every(
        (part, index) =>
          /^\d+$/.test(part) && (index === 0 ? part.length >= 1 && part.length <= 3 : part.length === 3),
      )
    ) {
      return confidentInteger(parts.join(''));
    }
    return { canonical: null, lowConfidence: true };
  }
  if (lastDot >= 0) {
    const parts = compact.split('.');
    if (parts.length === 2 && parts[1]?.length === 3 && /^\d{1,3}$/.test(parts[0] ?? '')) {
      return { canonical: null, lowConfidence: true };
    }
    if (parts.length === 2 && parts[1] && parts[1].length <= 2) {
      return confidentDecimal(`${parts[0]}.${parts[1].padEnd(2, '0')}`);
    }
    return { canonical: null, lowConfidence: true };
  }
  if (/^\d+$/.test(compact)) {
    return confidentInteger(compact);
  }
  return null;
}

export function parseMxDate(input: string): MxDateParse | null {
  const source = input.trim().toLowerCase().normalize('NFC');
  const numeric = source.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (numeric) {
    const iso = calendarIso(Number(numeric[3]), Number(numeric[2]), Number(numeric[1]));
    return iso ? { canonical: iso, lowConfidence: false, precision: 'day' } : null;
  }
  const longForm = source.match(/^(\d{1,2}) de ([a-záéíóúñ]+) de (\d{4})$/);
  if (longForm) {
    const month = MONTHS[longForm[2] ?? ''];
    if (!month) {
      return null;
    }
    const iso = calendarIso(Number(longForm[3]), month, Number(longForm[1]));
    return iso ? { canonical: iso, lowConfidence: false, precision: 'day' } : null;
  }
  const monthYear = source.match(/^([a-záéíóúñ]+)(?: de)? (\d{4})$/);
  if (monthYear) {
    const month = MONTHS[monthYear[1] ?? ''];
    if (!month) {
      return null;
    }
    const iso = calendarIso(Number(monthYear[2]), month, 1);
    return iso ? { canonical: iso, lowConfidence: true, precision: 'month' } : null;
  }
  return null;
}

function confidentDecimal(numeric: string): MxAmountParse {
  if (!/^\d+\.\d{1,2}$/.test(numeric)) {
    return { canonical: null, lowConfidence: true };
  }
  const [whole, frac] = numeric.split('.');
  return {
    canonical: `${stripLeadingZeros(whole ?? '0')}.${(frac ?? '').padEnd(2, '0')}`,
    lowConfidence: false,
  };
}

function confidentInteger(digits: string): MxAmountParse {
  return { canonical: stripLeadingZeros(digits), lowConfidence: false };
}

function stripLeadingZeros(digits: string): string {
  const stripped = digits.replace(/^0+(?=\d)/, '');
  return stripped.length === 0 ? '0' : stripped;
}

function calendarIso(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  const monthText = String(month).padStart(2, '0');
  const dayText = String(day).padStart(2, '0');
  return `${year}-${monthText}-${dayText}`;
}
