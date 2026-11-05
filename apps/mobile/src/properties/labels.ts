import type { ObligationCategory, ObligationRecurrence, OccupancyStatus, PropertyType } from '../api/contract';

export type LabelLanguage = 'es' | 'en';

type Option<T extends string> = { value: T; es: string; en: string };

export const PROPERTY_TYPE_OPTIONS: ReadonlyArray<Option<PropertyType>> = [
  { value: 'house', es: 'Casa', en: 'House' },
  { value: 'apartment', es: 'Depto', en: 'Apartment' },
  { value: 'land', es: 'Terreno', en: 'Land' },
  { value: 'commercial', es: 'Local', en: 'Shop' },
  { value: 'other', es: 'Otro', en: 'Other' },
];

export const OCCUPANCY_OPTIONS: ReadonlyArray<Option<OccupancyStatus>> = [
  { value: 'owned', es: 'Propia', en: 'Owned' },
  { value: 'rented', es: 'Rentada', en: 'Rented' },
  { value: 'family', es: 'Familiar', en: 'Family' },
  { value: 'investment', es: 'Inversión', en: 'Investment' },
];

export const CATEGORY_OPTIONS: ReadonlyArray<Option<ObligationCategory>> = [
  { value: 'predial', es: 'Predial', en: 'Predial' },
  { value: 'water', es: 'Agua', en: 'Water' },
  { value: 'electricity', es: 'CFE/Electricidad', en: 'Electricity' },
  { value: 'gas', es: 'Gas', en: 'Gas' },
  { value: 'internet', es: 'Internet', en: 'Internet' },
  { value: 'mantenimiento', es: 'Mantenimiento/HOA', en: 'Maintenance' },
  { value: 'mortgage', es: 'Hipoteca', en: 'Mortgage' },
  { value: 'insurance', es: 'Seguro', en: 'Insurance' },
  { value: 'security', es: 'Seguridad', en: 'Security' },
  { value: 'other', es: 'Otro', en: 'Other' },
];

export const RECURRENCE_OPTIONS: ReadonlyArray<Option<ObligationRecurrence>> = [
  { value: 'monthly', es: 'Mensual', en: 'Monthly' },
  { value: 'bimonthly', es: 'Bimestral', en: 'Every two months' },
  { value: 'quarterly', es: 'Trimestral', en: 'Quarterly' },
  { value: 'semiannual', es: 'Semestral', en: 'Twice a year' },
  { value: 'annual', es: 'Anual', en: 'Yearly' },
  { value: 'custom', es: 'Personalizada', en: 'Custom' },
  { value: 'irregular', es: 'Irregular/única', en: 'One time' },
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
  return language === 'en' ? found.en : found.es;
}
