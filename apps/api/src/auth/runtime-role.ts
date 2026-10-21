export interface RuntimeRole {
  currentUser: string;
  superuser: boolean;
  databaseOwner: boolean;
}

const APP_ROLE = 'property_control_app';

/**
 * The running API must be the non-owner app role. The Neon owner and any
 * superuser are refused before the process listens.
 */
export function assertRuntimeRole(role: RuntimeRole): void {
  if (role.superuser || role.databaseOwner || role.currentUser !== APP_ROLE) {
    throw new Error(
      'The API must connect as property_control_app, not the database owner or a superuser.',
    );
  }
}

interface RoleQuery {
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
}

/** Reads current_user, rolsuper, and whether that role owns the database. */
export async function readRuntimeRole(prisma: RoleQuery): Promise<RuntimeRole> {
  const rows = await prisma.$queryRaw<
    Array<{ current_user: string; superuser: boolean; database_owner: boolean }>
  >`
    SELECT current_user,
           r.rolsuper AS superuser,
           r.oid = d.datdba AS database_owner
    FROM pg_roles r
    JOIN pg_database d ON d.datname = current_database()
    WHERE r.rolname = current_user
  `;
  const row = rows[0];
  if (!row) {
    throw new Error('The API could not read its database role.');
  }
  return {
    currentUser: row.current_user,
    superuser: Boolean(row.superuser),
    databaseOwner: Boolean(row.database_owner),
  };
}
