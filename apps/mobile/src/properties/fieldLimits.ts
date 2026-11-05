/**
 * Single-line caps from apps/api/src/writes/records.service.ts at e7df031.
 * The numbers are the second argument of assertSingleLine / optionalText.
 */
export const FIELD_LIMITS = {
  /** parsePropertyCreate, records.service.ts:675. Patch is :694. */
  propertyName: 200,
  /** parsePropertyFields, records.service.ts:732. Patch is :700. */
  addressLine: 300,
  /** parsePropertyFields, records.service.ts:733. Patch is :701. */
  city: 120,
  /** parsePropertyFields, records.service.ts:734. Patch is :702. */
  state: 120,
  /** parsePropertyFields, records.service.ts:735. Patch is :703. */
  postalCode: 12,
  /** parseObligationCreate, records.service.ts:761. Patch is :804. */
  obligationTitle: 300,
  /** parseObligationCreate, records.service.ts:762. Patch is :805. */
  providerName: 200,
  /** parseObligationCreate, records.service.ts:769. Patch is :812. */
  preferredMethod: 80,
} as const;
