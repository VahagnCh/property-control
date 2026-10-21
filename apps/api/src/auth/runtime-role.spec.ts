import { describe, expect, it } from 'vitest';
import { assertRuntimeRole, type RuntimeRole } from './runtime-role.js';

const appRole: RuntimeRole = {
  currentUser: 'property_control_app',
  superuser: false,
  databaseOwner: false,
};

describe('assertRuntimeRole', () => {
  it('allows the non-owner app role', () => {
    expect(() => assertRuntimeRole(appRole)).not.toThrow();
  });

  it('fails when the connection is a superuser', () => {
    expect(() =>
      assertRuntimeRole({ currentUser: 'postgres', superuser: true, databaseOwner: true }),
    ).toThrow(/property_control_app/);
  });

  it('fails when the connection owns the database even if it is not a superuser', () => {
    expect(() =>
      assertRuntimeRole({ currentUser: 'neon_owner', superuser: false, databaseOwner: true }),
    ).toThrow(/not the database owner or a superuser/);
  });

  it('fails for any role other than the app role', () => {
    expect(() =>
      assertRuntimeRole({ currentUser: 'someone_else', superuser: false, databaseOwner: false }),
    ).toThrow(/property_control_app/);
  });

  it('fails when the app role name is also the database owner', () => {
    expect(() =>
      assertRuntimeRole({ currentUser: 'property_control_app', superuser: false, databaseOwner: true }),
    ).toThrow(/not the database owner or a superuser/);
  });
});
