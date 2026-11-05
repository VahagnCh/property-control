import type { OccupancyStatus, PropertyType, PropertyWriteBody } from '../api/contract';
import type { CopyKey } from '../copy/userFacing';
import { DEFAULT_PROPERTY_TIMEZONE } from '../dates/propertyCalendar';
import { validateTextInput } from '../forms/textInput';

export type PropertyDraft = {
  name: string;
  propertyType: PropertyType;
  occupancyStatus: OccupancyStatus | null;
  addressLine: string;
  city: string;
  state: string;
};

function optionalText(value: string): { ok: true; value: string } | { ok: false; key: CopyKey } | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
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
  const addressLine = optionalText(draft.addressLine);
  if (addressLine && !addressLine.ok) {
    return addressLine;
  }
  const city = optionalText(draft.city);
  if (city && !city.ok) {
    return city;
  }
  const state = optionalText(draft.state);
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
