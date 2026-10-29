export const PROPERTY_ACCESS = Symbol('PROPERTY_ACCESS');

export type MembershipRole = 'owner' | 'member' | 'viewer';

export interface ResolvedMembership {
  role: MembershipRole;
  userId: string;
}

export interface PropertyAccess {
  resolve(input: {
    userId: string;
    propertyId: string;
  }): ResolvedMembership | null | Promise<ResolvedMembership | null>;
  documentBelongsToProperty(propertyId: string, documentId: string): boolean | Promise<boolean>;
}

/** Fail closed. Unknown properties, documents, and memberships stay unknown. */
export class FailClosedPropertyAccess implements PropertyAccess {
  resolve(): null {
    return null;
  }

  documentBelongsToProperty(): boolean {
    return false;
  }
}
