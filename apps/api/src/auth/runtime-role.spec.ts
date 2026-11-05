import { describe, expect, it } from 'vitest';
import { assertRuntimeRole, roleFacts } from './runtime-role.js';

const appRole = roleFacts({ currentUser: 'property_control_app' });

describe('assertRuntimeRole', () => {
  it('allows the non-owner app role', () => {
    expect(() => assertRuntimeRole(appRole)).not.toThrow();
  });

  it('fails when the connection is a superuser', () => {
    expect(() => assertRuntimeRole(roleFacts({ currentUser: 'postgres', superuser: true, databaseOwner: true }))).toThrow(
      /property_control_app/,
    );
  });

  it('fails when the connection owns the database even if it is not a superuser', () => {
    expect(() => assertRuntimeRole(roleFacts({ currentUser: 'neon_owner', superuser: false, databaseOwner: true }))).toThrow(
      /not the database owner or a superuser/,
    );
  });

  it('fails for any role other than the app role', () => {
    expect(() => assertRuntimeRole(roleFacts({ currentUser: 'someone_else' }))).toThrow(/property_control_app/);
  });

  it('fails when the app role name is also the database owner', () => {
    expect(() => assertRuntimeRole(roleFacts({ currentUser: 'property_control_app', databaseOwner: true }))).toThrow(
      /not the database owner or a superuser/,
    );
  });

  it('fails for createdb, createrole, replication, or bypassrls', () => {
    for (const flag of ['createDb', 'createRole', 'replication', 'bypassRls'] as const) {
      expect(() => assertRuntimeRole(roleFacts({ currentUser: 'property_control_app', [flag]: true }))).toThrow(
        /property_control_app/,
      );
    }
  });

  it('fails when the app role is a member of the owner or a privileged role', () => {
    expect(() =>
      assertRuntimeRole(roleFacts({ currentUser: 'property_control_app', privilegedMembership: true })),
    ).toThrow(/membership in an owner or privileged role/);
  });
});
