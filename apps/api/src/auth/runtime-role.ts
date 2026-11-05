export interface RuntimeRole {
  currentUser: string;
  superuser: boolean;
  databaseOwner: boolean;
  createRole: boolean;
  createDb: boolean;
  replication: boolean;
  bypassRls: boolean;
  /** Direct or inherited member of the DB owner, a table owner, or a privileged role. */
  privilegedMembership: boolean;
}

const APP_ROLE = 'property_control_app';

export function roleFacts(overrides: Partial<RuntimeRole> & Pick<RuntimeRole, 'currentUser'>): RuntimeRole {
  return {
    superuser: false,
    databaseOwner: false,
    createRole: false,
    createDb: false,
    replication: false,
    bypassRls: false,
    privilegedMembership: false,
    ...overrides,
  };
}

/**
 * The running API must be property_control_app with no elevated attributes
 * and no membership in the database owner, a table owner, neon_superuser,
 * pg_write_all_data, or pg_read_all_data. Membership in the owner is enough
 * to run ALTER TABLE ... DISABLE TRIGGER USER.
 */
export function assertRuntimeRole(role: RuntimeRole): void {
  const elevated =
    role.superuser ||
    role.databaseOwner ||
    role.createRole ||
    role.createDb ||
    role.replication ||
    role.bypassRls ||
    role.privilegedMembership;
  if (elevated || role.currentUser !== APP_ROLE) {
    throw new Error(
      'The API must connect as property_control_app, not the database owner or a superuser, and without createdb, createrole, replication, bypassrls, or membership in an owner or privileged role.',
    );
  }
}

interface RoleQuery {
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
}

interface RoleRow {
  current_user: string;
  superuser: boolean;
  createdb: boolean;
  createrole: boolean;
  replication: boolean;
  bypassrls: boolean;
  database_owner: boolean;
  privileged_membership: boolean;
}

/**
 * Reads the named role, or current_user when roleName is null.
 * The caller must be able to read pg_roles, pg_auth_members, and pg_class.
 */
export async function readNamedRole(prisma: RoleQuery, roleName: string | null): Promise<RuntimeRole> {
  const rows = await prisma.$queryRaw<RoleRow[]>`
    WITH RECURSIVE granted AS (
      SELECT m.roleid
      FROM pg_auth_members m
      JOIN pg_roles self ON self.oid = m.member
      WHERE self.rolname = COALESCE(${roleName}, current_user)
      UNION
      SELECT m.roleid
      FROM pg_auth_members m
      JOIN granted g ON m.member = g.roleid
    )
    SELECT r.rolname AS current_user,
           r.rolsuper AS superuser,
           r.rolcreatedb AS createdb,
           r.rolcreaterole AS createrole,
           r.rolreplication AS replication,
           r.rolbypassrls AS bypassrls,
           r.oid = d.datdba AS database_owner,
           EXISTS (
             SELECT 1
             FROM granted g
             JOIN pg_roles parent ON parent.oid = g.roleid
             WHERE parent.rolname IN ('neon_superuser', 'pg_write_all_data', 'pg_read_all_data')
                OR parent.oid = d.datdba
                OR EXISTS (
                  SELECT 1
                  FROM pg_class c
                  JOIN pg_namespace n ON n.oid = c.relnamespace
                  WHERE c.relowner = parent.oid
                    AND c.relkind IN ('r', 'p')
                    AND n.nspname = 'public'
                )
           ) AS privileged_membership
    FROM pg_roles r
    JOIN pg_database d ON d.datname = current_database()
    WHERE r.rolname = COALESCE(${roleName}, current_user)
  `;
  const row = rows[0];
  if (!row) {
    throw new Error('The API could not read its database role.');
  }
  return {
    currentUser: row.current_user,
    superuser: Boolean(row.superuser),
    databaseOwner: Boolean(row.database_owner),
    createRole: Boolean(row.createrole),
    createDb: Boolean(row.createdb),
    replication: Boolean(row.replication),
    bypassRls: Boolean(row.bypassrls),
    privilegedMembership: Boolean(row.privileged_membership),
  };
}

/** Reads current_user and the privileges assertRuntimeRole refuses. */
export async function readRuntimeRole(prisma: RoleQuery): Promise<RuntimeRole> {
  return readNamedRole(prisma, null);
}
