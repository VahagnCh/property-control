import type { ApiErrorBody, HealthBody, PaymentCreateResponse, PropertyResponse } from '../contract';

/** Contract fixtures for the test double. Production code does not import this file. */

export const PROPERTY_ID = '11111111-1111-4111-8111-111111111111';

export const OBLIGATION_ID = '22222222-2222-4222-8222-222222222222';

export const healthOk: HealthBody = { status: 'ok' };

export const healthUnavailable: HealthBody = { status: 'unavailable' };

export const notFoundBody: ApiErrorBody = {
  statusCode: 404,
  error: 'not_found',
  message: 'Not found.',
};

export const propertyFixture: PropertyResponse = {
  id: PROPERTY_ID,
  name: 'Casa Roma',
  propertyType: 'house',
  occupancyStatus: 'owned',
  addressLine: null,
  city: 'Ciudad de México',
  state: 'CMX',
  country: 'MX',
  postalCode: null,
  timezone: 'America/Mexico_City',
  createdAt: '2026-10-29T18:00:00.000Z',
  updatedAt: '2026-10-29T18:00:00.000Z',
};

export function paymentCreated(amount: string, paidAt: string): PaymentCreateResponse {
  return {
    payment: {
      id: '33333333-3333-4333-8333-333333333333',
      propertyId: PROPERTY_ID,
      obligationId: OBLIGATION_ID,
      amount,
      currency: 'MXN',
      paidAt,
      status: 'recorded',
    },
    warnings: [],
  };
}
