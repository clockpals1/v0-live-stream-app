/**
 * RBAC — single source of truth for roles and capabilities.
 * Used by both frontend components and backend API routes so role logic
 * cannot drift between client and server.
 */

export const ROLES = ["admin", "host", "cohost"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin",
  host: "Host",
  cohost: "Co-host",
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  admin: "Full access. Can manage users and create/own streams.",
  host: "Can create and own streams, and be invited as a co-host.",
  cohost: "Can only join streams they are invited to as a co-host.",
};

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/**
 * Capability matrix. Keep the mapping here so a new capability only needs
 * to be added in one place.
 */
export const CAPS = {
  manageUsers: (r: Role) => r === "admin",
  accessAdminPanel: (r: Role) => r === "admin",
  createOwnStreams: (r: Role) => r === "admin" || r === "host",
  beInvitedAsCohost: (r: Role) => r === "admin" || r === "host" || r === "cohost",
  accessHostDashboard: (r: Role) => r === "admin" || r === "host" || r === "cohost",
} as const;

/**
 * Resolve a role from a hosts-row shape that may only carry the legacy
 * is_admin boolean (older API responses). Prefers explicit role when present.
 */
export function resolveRole(row: {
  role?: string | null;
  is_admin?: boolean | null;
}): Role {
  if (isRole(row.role)) return row.role;
  if (row.is_admin) return "admin";
  return "host";
}
