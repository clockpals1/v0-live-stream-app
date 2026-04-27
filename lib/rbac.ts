/**
 * RBAC — single source of truth for roles and capabilities.
 * Used by both frontend components and backend API routes so role logic
 * cannot drift between client and server.
 */

export const ROLES = ["admin", "host", "cohost", "super_user"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin",
  host: "Host",
  cohost: "Co-host",
  super_user: "Super User",
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  admin: "Full access. Can manage users and create/own streams.",
  host: "Can create and own streams, and be invited as a co-host.",
  cohost: "Can only join streams they are invited to as a co-host.",
  super_user:
    "Stream operator. Manages overlays, co-hosts, and support controls for streams they are explicitly assigned to. Cannot broadcast or create streams.",
};

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/**
 * Per-stream access modes — separate from the global Role. A user's
 * Role says what they can do across the platform; StreamAccess says
 * what they can do on ONE specific stream.
 *
 *   owner    — the stream's host_id matches this user (or user is admin).
 *              Full broadcast + management controls.
 *   operator — listed in stream_operators for this stream. Management
 *              controls only (no broadcast).
 *   cohost   — listed via streams.assigned_host_id (legacy path). Can
 *              broadcast their own cohost feed through the cohost page.
 *   denied   — none of the above. Must be redirected away.
 */
export type StreamAccess = "owner" | "operator" | "cohost" | "denied";

/**
 * Capability matrix. Keep the mapping here so a new capability only needs
 * to be added in one place.
 *
 * Global (Role-driven):
 */
export const CAPS = {
  manageUsers: (r: Role) => r === "admin",
  accessAdminPanel: (r: Role) => r === "admin",
  createOwnStreams: (r: Role) => r === "admin" || r === "host",
  beInvitedAsCohost: (r: Role) => r === "admin" || r === "host" || r === "cohost",
  accessHostDashboard: (r: Role) =>
    r === "admin" || r === "host" || r === "cohost" || r === "super_user",
  assignOperators: (r: Role) => r === "admin" || r === "host",
} as const;

/**
 * Per-stream capabilities. Driven by StreamAccess, not Role — because a
 * super_user with an assignment has management rights, and an admin with
 * NO assignment (i.e. just looking at the admin panel) does not need
 * broadcast UI.
 */
export const STREAM_CAPS = {
  /** Can press Go Live / End Stream / Pause / Resume / Go On-Air / switch camera. */
  canBroadcast: (a: StreamAccess) => a === "owner",
  /** Can edit overlay / ticker / music / slideshow / co-host assignment. */
  canManageStream: (a: StreamAccess) => a === "owner" || a === "operator",
  /** Can download the locally-recorded .webm file (only the owner's machine recorded it). */
  canDownloadRecording: (a: StreamAccess) => a === "owner",
  /** Can view + send stream-scoped private messages. */
  canUsePrivateMessages: (a: StreamAccess) =>
    a === "owner" || a === "operator" || a === "cohost",
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

/**
 * Given a user's role and their relationship to a specific stream, return
 * the access mode for that stream. Admin wins over everything (they can
 * manage any stream). An explicit operator assignment beats the default
 * denied, even if the user's global role is host/cohost.
 *
 * The caller is responsible for ACTUALLY checking isOperator / isCohost /
 * isOwner against the database — this function is pure logic on those booleans.
 */
export function resolveStreamAccess(args: {
  role: Role;
  isOwner: boolean;
  isOperator: boolean;
  isCohost: boolean;
}): StreamAccess {
  if (args.isOwner || args.role === "admin") return "owner";
  if (args.isOperator) return "operator";
  if (args.isCohost) return "cohost";
  return "denied";
}
