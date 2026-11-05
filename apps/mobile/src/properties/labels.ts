import type { ObligationCategory, ObligationRecurrence, OccupancyStatus, PropertyType } from '../api/contract';
import { copyText, type CopyKey } from '../copy/userFacing';

export type LabelLanguage = 'es' | 'en';

type Option<T extends string> = { value: T; key: CopyKey };

export const PROPERTY_TYPE_OPTIONS: ReadonlyArray<Option<PropertyType>> = [
  { value: 'house', key: 'property.type.house' },
  { value: 'apartment', key: 'property.type.apartment' },
  { value: 'land', key: 'property.type.land' },
  { value: 'commercial', key: 'property.type.commercial' },
  { value: 'other', key: 'property.type.other' },
];

export const OCCUPANCY_OPTIONS: ReadonlyArray<Option<OccupancyStatus>> = [
  { value: 'owned', key: 'property.occupancy.owned' },
  { value: 'rented', key: 'property.occupancy.rented' },
  { value: 'family', key: 'property.occupancy.family' },
  { value: 'investment', key: 'property.occupancy.investment' },
];

export const CATEGORY_OPTIONS: ReadonlyArray<Option<ObligationCategory>> = [
  { value: 'predial', key: 'obligation.category.predial' },
  { value: 'water', key: 'obligation.category.water' },
  { value: 'electricity', key: 'obligation.category.electricity' },
  { value: 'gas', key: 'obligation.category.gas' },
  { value: 'internet', key: 'obligation.category.internet' },
  { value: 'mantenimiento', key: 'obligation.category.mantenimiento' },
  { value: 'mortgage', key: 'obligation.category.mortgage' },
  { value: 'insurance', key: 'obligation.category.insurance' },
  { value: 'security', key: 'obligation.category.security' },
  { value: 'other', key: 'obligation.category.other' },
];

export const RECURRENCE_OPTIONS: ReadonlyArray<Option<ObligationRecurrence>> = [
  { value: 'monthly', key: 'obligation.recurrence.monthly' },
  { value: 'bimonthly', key: 'obligation.recurrence.bimonthly' },
  { value: 'quarterly', key: 'obligation.recurrence.quarterly' },
  { value: 'semiannual', key: 'obligation.recurrence.semiannual' },
  { value: 'annual', key: 'obligation.recurrence.annual' },
  { value: 'custom', key: 'obligation.recurrence.custom' },
  { value: 'irregular', key: 'obligation.recurrence.irregular' },
];

export function optionLabel<T extends string>(
  options: ReadonlyArray<Option<T>>,
  value: T,
  language: LabelLanguage = 'es',
): string {
  const found = options.find((option) => option.value === value);
  if (!found) {
    return value;
  }
  return copyText(found.key, language);
}
