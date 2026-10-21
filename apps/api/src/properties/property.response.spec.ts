import { UnprocessableEntityException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROPERTY_TIMEZONE,
  assertWritablePropertyTimezone,
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

  it('falls back on a stored invalid timezone and rejects it on write', () => {
    expect(propertyTimezone('Not/AZone')).toBe(DEFAULT_PROPERTY_TIMEZONE);
    expect(propertyTimezone('Mars/Phobos')).toBe('America/Mexico_City');
    expect(() => assertWritablePropertyTimezone('Not/AZone')).toThrow(UnprocessableEntityException);
    try {
      assertWritablePropertyTimezone(' ');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(UnprocessableEntityException);
      expect((error as UnprocessableEntityException).getStatus()).toBe(422);
      expect((error as UnprocessableEntityException).getResponse()).toMatchObject({
        error: 'invalid_timezone',
      });
    }
    expect(() => assertWritablePropertyTimezone('America/Tijuana')).not.toThrow();
    expect(() => assertWritablePropertyTimezone(undefined)).not.toThrow();
  });
});
