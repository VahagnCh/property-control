import type { OccupancyStatus, PropertyType, PropertyWriteBody } from '../api/contract';
import type { CopyKey } from '../copy/userFacing';
import { DEFAULT_PROPERTY_TIMEZONE } from '../dates/propertyCalendar';
import { validateTextInput } from '../forms/textInput';
import { FIELD_LIMITS } from './fieldLimits';

export type PropertyDraft = {
  name: string;
  propertyType: PropertyType;
  occupancyStatus: OccupancyStatus | null;
  addressLine: string;
  city: string;
  state: string;
};

function optionalText(
  value: string,
  maxLength: number,
): { ok: true; value: string } | { ok: false; key: CopyKey } | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.length > maxLength) {
    return { ok: false, key: 'form.title.tooLong' };
  }
  const checked = validateTextInput(trimmed, 'title');
  if (!checked.ok) {
    return { ok: false, key: checked.key };
  }
  return { ok: true, value: checked.value };
}

export function buildPropertyWrite(
  draft: PropertyDraft,
): { ok: true; body: PropertyWriteBody } | { ok: false; key: CopyKey } {
  if (draft.name.trim().length > FIELD_LIMITS.propertyName) {
    return { ok: false, key: 'form.title.tooLong' };
  }
  const name = validateTextInput(draft.name, 'title');
  if (!name.ok) {
    return { ok: false, key: name.key };
  }
  const body: PropertyWriteBody = {
    name: name.value,
    propertyType: draft.propertyType,
    country: 'MX',
    timezone: DEFAULT_PROPERTY_TIMEZONE,
  };
  if (draft.occupancyStatus) {
    body.occupancyStatus = draft.occupancyStatus;
  }
  const addressLine = optionalText(draft.addressLine, FIELD_LIMITS.addressLine);
  if (addressLine && !addressLine.ok) {
    return addressLine;
  }
  const city = optionalText(draft.city, FIELD_LIMITS.city);
  if (city && !city.ok) {
    return city;
  }
  const state = optionalText(draft.state, FIELD_LIMITS.state);
  if (state && !state.ok) {
    return state;
  }
  if (addressLine?.ok) {
    body.addressLine = addressLine.value;
  }
  if (city?.ok) {
    body.city = city.value;
  }
  if (state?.ok) {
    body.state = state.value;
  }
  return { ok: true, body };
}
