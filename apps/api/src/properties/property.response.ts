import { UnprocessableEntityException } from '@nestjs/common';
import { isIanaTimeZone } from '../common/property-calendar.js';

/** IANA name used when a client omits timezone. Never a fixed offset. */
export const DEFAULT_PROPERTY_TIMEZONE = 'America/Mexico_City';

export const PROPERTY_TYPES = ['house', 'apartment', 'land', 'commercial', 'other'] as const;

export type PropertyType = (typeof PROPERTY_TYPES)[number];

export const OCCUPANCY_STATUSES = ['owned', 'rented', 'family', 'investment'] as const;

export type OccupancyStatus = (typeof OCCUPANCY_STATUSES)[number];

/**
 * Every v1 Property response. `timezone` is required so a response cannot omit it.
 */
export interface PropertyResponse {
  id: string;
  name: string;
  propertyType: PropertyType;
  occupancyStatus: OccupancyStatus | null;
  addressLine: string | null;
  city: string | null;
  state: string | null;
  country: string;
  postalCode: string | null;
  timezone: string;
  createdAt: string;
  updatedAt: string;
}

/** Create and patch body. `timezone` may be omitted; the response still includes it. */
export interface PropertyWriteDto {
  name: string;
  propertyType?: PropertyType;
  occupancyStatus?: OccupancyStatus;
  addressLine?: string;
  city?: string;
  state?: string;
  country?: string;
  postalCode?: string;
  timezone?: string;
}

export interface PropertyRecord {
  id: string;
  name: string;
  propertyType: PropertyType;
  occupancyStatus?: OccupancyStatus | null;
  addressLine?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  postalCode?: string | null;
  timezone?: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

/** Maps a stored property onto the v1 response, filling the default timezone. */
export function toPropertyResponse(record: PropertyRecord): PropertyResponse {
  return {
    id: record.id,
    name: record.name,
    propertyType: record.propertyType,
    occupancyStatus: record.occupancyStatus ?? null,
    addressLine: record.addressLine ?? null,
    city: record.city ?? null,
    state: record.state ?? null,
    country: record.country && record.country.length > 0 ? record.country : 'MX',
    postalCode: record.postalCode ?? null,
    timezone: propertyTimezone(record.timezone),
    createdAt: toIso(record.createdAt),
    updatedAt: toIso(record.updatedAt),
  };
}

export function propertyTimezone(timezone: string | null | undefined): string {
  const trimmed = timezone?.trim() ?? '';
  if (trimmed.length === 0 || !isIanaTimeZone(trimmed)) {
    return DEFAULT_PROPERTY_TIMEZONE;
  }
  return trimmed;
}

/** Property create and patch. An invalid IANA name is 422. Omitted is allowed. */
export function assertWritablePropertyTimezone(timezone: string | null | undefined): void {
  if (timezone === undefined || timezone === null) {
    return;
  }
  const trimmed = timezone.trim();
  if (trimmed.length === 0 || !isIanaTimeZone(trimmed)) {
    throw new UnprocessableEntityException({
      statusCode: 422,
      message: 'timezone must be an IANA name.',
      error: 'invalid_timezone',
    });
  }
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
