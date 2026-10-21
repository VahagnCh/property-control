import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROPERTY_TIMEZONE,
  propertyTimezone,
  toPropertyResponse,
  type PropertyResponse,
  type PropertyWriteDto,
} from './property.response.js';

const createdAt = new Date('2026-10-21T15:00:00.000Z');

describe('PropertyResponse timezone', () => {
  it('includes America/Mexico_City when the stored timezone is omitted', () => {
    const response = toPropertyResponse({
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Casa',
      propertyType: 'house',
      createdAt,
      updatedAt: createdAt,
    });

    expect(response.timezone).toBe(DEFAULT_PROPERTY_TIMEZONE);
    expect(response.timezone).toBe('America/Mexico_City');
    expect(Object.hasOwn(response, 'timezone')).toBe(true);
    const wire: PropertyResponse = response;
    expect(wire.timezone).toBe('America/Mexico_City');
  });

  it('treats a blank timezone as the default and keeps an explicit IANA name', () => {
    expect(propertyTimezone(undefined)).toBe('America/Mexico_City');
    expect(propertyTimezone('   ')).toBe('America/Mexico_City');
    expect(propertyTimezone('America/Cancun')).toBe('America/Cancun');

    const response = toPropertyResponse({
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Casa',
      propertyType: 'apartment',
      timezone: 'America/Tijuana',
      createdAt,
      updatedAt: createdAt,
    });
    expect(response.timezone).toBe('America/Tijuana');
  });

  it('allows a write body to omit timezone', () => {
    const body: PropertyWriteDto = { name: 'Casa' };
    expect(body.timezone).toBeUndefined();
    expect(propertyTimezone(body.timezone)).toBe('America/Mexico_City');
  });
});
