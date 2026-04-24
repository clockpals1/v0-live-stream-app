/**
 * RBAC — single source of truth for roles and capabilities.
 * Used by both frontend components and backend API routes so role logic
 * cannot drift between client and server.
 */

export const ROLES = ["admin", "host", "cohost", "superuser"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin",
  host: "Host",
  cohost: "Co-host",
  superuser: "Super User",
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  admin: "Full access. Can manage users and create/own streams.",
  host: "Can create and own streams, and be invited as a co-host.",
  cohost: "Can only join streams they are invited to as a co-host.",
  superuser:
    "Stream operator. Cannot broadcast or go live. Can only manage the specific streams an admin has assigned them to.",
};

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/**
 * Capability matrix. Keep the mapping here so a new capability only needs
 * to be added in one place.
 *
 * Super-user semantics:
 *   - canBroadcast / createOwnStreams / beInvitedAsCohost: ALL false.
 *     Super users are operators, not broadcasters — they never publish media.
 *   - accessHostDashboard: true so they land on a dashboard, but that
 *     dashboard only lists streams they were explicitly assigned to
 *     (see stream_operators table).
 *   - operateAssignedStream: true — actual per-stream access is gated
 *     server-side by a stream_operators lookup, this flag is only the
 *     client-side role-level precondition.
 */
export const CAPS = {
  manageUsers: (r: Role) => r === "admin",
  accessAdminPanel: (r: Role) => r === "admin",
  createOwnStreams: (r: Role) => r === "admin" || r === "host",
  beInvitedAsCohost: (r: Role) => r === "admin" || r === "host" || r === "cohost",
  accessHostDashboard: (r: Role) =>
    r === "admin" || r === "host" || r === "cohost" || r === "superuser",
  // True for any role that is permitted to BROADCAST its own camera/audio.
  // Explicitly excludes superuser so every broadcaster-only control in the
  // UI (Start Stream, End Stream, Go On-Air, Pause, Resume, Switch Camera)
  // can be gated from a single capability check.
  canBroadcast: (r: Role) => r === "admin" || r === "host" || r === "cohost",
  // Role-level precondition for operating a stream as a non-broadcaster.
  // The actual per-stream grant is the stream_operators row — this cap just
  // says "this role is eligible to be an operator".
  operateAssignedStream: (r: Role) => r === "admin" || r === "superuser",
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
 * Server-friendly helper: given the authed user's role and whether they hold
 * an active stream_operators row for a specific stream, return the
 * effective access mode the stream interface should render in.
 *
 *   "owner"    — they are the broadcaster for this stream
 *   "admin"    — platform admin; full access regardless of ownership
 *   "operator" — assigned super user; stream-scoped non-broadcast access
 *   "cohost"   — assigned co-host broadcaster (separate flow)
 *   "denied"   — no basis to access this stream
 */
export type StreamAccessMode =
  | "owner"
  | "admin"
  | "operator"
  | "cohost"
  | "denied";

export function resolveStreamAccess(input: {
  role: Role;
  isOwner: boolean;
  isOperator: boolean;
  isCohost: boolean;
}): StreamAccessMode {
  if (input.isOwner) return "owner";
  if (input.role === "admin") return "admin";
  if (input.isOperator && CAPS.operateAssignedStream(input.role))
    return "operator";
  if (input.isCohost && CAPS.beInvitedAsCohost(input.role)) return "cohost";
  return "denied";
}
