import { formatIsoDate, lastDayOfMonth, parseIsoDate } from '../common/property-calendar.js';

export type ScheduleCadence =
  | 'monthly'
  | 'bimonthly'
  | 'quarterly'
  | 'semiannual'
  | 'annual'
  | 'custom'
  | 'irregular';

const STEPS: Record<Exclude<ScheduleCadence, 'custom' | 'irregular'>, number> = {
  monthly: 1,
  bimonthly: 2,
  quarterly: 3,
  semiannual: 6,
  annual: 12,
};

export function dueDateAt(anchorIso: string, dueDay: number, periodIndex: number): string {
  const anchor = parseIsoDate(anchorIso);
  if (!anchor || dueDay < 1 || dueDay > 31 || !Number.isInteger(periodIndex)) {
    throw new Error('Invalid schedule.');
  }
  const monthIndex = anchor.year * 12 + (anchor.month - 1) + periodIndex;
  const year = Math.floor(monthIndex / 12);
  const month = (monthIndex % 12) + 1;
  const day = Math.min(dueDay, lastDayOfMonth(year, month));
  return formatIsoDate(year, month, day);
}

export function periodIndexOf(anchorIso: string, dueIso: string): number {
  const anchor = parseIsoDate(anchorIso);
  const due = parseIsoDate(dueIso);
  if (!anchor || !due) {
    throw new Error('Invalid schedule.');
  }
  return due.year * 12 + (due.month - 1) - (anchor.year * 12 + (anchor.month - 1));
}

/** One cadence step after `periodDueIso`, measured from the anchor month. */
export function periodAfter(
  anchorIso: string,
  dueDay: number,
  cadence: ScheduleCadence,
  periodDueIso: string,
): string | null {
  if (cadence === 'custom' || cadence === 'irregular') {
    return null;
  }
  const index = periodIndexOf(anchorIso, periodDueIso);
  return dueDateAt(anchorIso, dueDay, index + STEPS[cadence]);
}
