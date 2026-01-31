import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type pg from "pg";

const TOKEN_BYTES = 32;
const SESSION_TTL_DAYS = 30;
const PASSWORD_HASH_PREFIX = "scrypt";

export type AuthUser = {
  user_id: string;
  email: string;
  display_name?: string | null;
  is_guest?: boolean;
};

export type AuthContext = {
  sessionId: string;
  user: AuthUser;
};

export class AuthError extends Error {
  status = 401;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, 64);
  return `${PASSWORD_HASH_PREFIX}$${salt.toString("hex")}$${key.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [prefix, saltHex, keyHex] = stored.split("$");
  if (prefix !== PASSWORD_HASH_PREFIX || !saltHex || !keyHex) return false;
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(keyHex, "hex");
  const derived = scryptSync(password, salt, expected.length);
  return timingSafeEqual(expected, derived);
}

export function issueAuthToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function buildSessionExpiry(from = new Date()): Date {
  return new Date(from.getTime() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
}

export function buildGuestEmail(id: string): string {
  return `guest-${id}@guest.local`;
}

export function readAuthToken(headers: Record<string, unknown>): string | null {
  const raw = readHeader(headers, "authorization");
  if (raw) {
    const [scheme, value] = raw.split(" ");
    if (scheme?.toLowerCase() === "bearer" && value?.trim()) return value.trim();
  }
  const fallback = readHeader(headers, "x-auth-token");
  return fallback?.trim() || null;
}

export async function resolveAuth(c: pg.PoolClient, token: string): Promise<AuthContext | null> {
  const tokenHash = hashToken(token);
  const rows = (await c.query(
    `SELECT s.session_id, s.expires_at, s.revoked_at, u.user_id, u.email, u.display_name, u.is_guest
     FROM user_sessions s
     JOIN users u ON s.user_id = u.user_id
     WHERE s.token_hash = $1`,
    [tokenHash]
  )).rows as Array<{
    session_id: string;
    expires_at: string;
    revoked_at: string | null;
    user_id: string;
    email: string;
    display_name: string | null;
    is_guest?: boolean;
  }>;
  const row = rows[0];
  if (!row) return null;
  if (row.revoked_at) return null;
  const expiresAt = new Date(row.expires_at);
  if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) return null;
  await c.query("UPDATE user_sessions SET last_seen = now() WHERE session_id = $1", [row.session_id]);
  return {
    sessionId: row.session_id,
    user: {
      user_id: row.user_id,
      email: row.email,
      display_name: row.display_name,
      is_guest: row.is_guest
    }
  };
}

export async function resolveAuthFromHeaders(
  c: pg.PoolClient,
  headers: Record<string, unknown>,
  options: { required?: boolean } = {}
): Promise<AuthContext | null> {
  const token = readAuthToken(headers);
  if (!token) {
    if (options.required) throw new AuthError("Missing auth token.");
    return null;
  }
  const auth = await resolveAuth(c, token);
  if (!auth) throw new AuthError("Invalid or expired session.");
  return auth;
}

function readHeader(headers: Record<string, unknown>, key: string): string | null {
  const direct = headers[key];
  if (typeof direct === "string") return direct;
  if (Array.isArray(direct)) return typeof direct[0] === "string" ? direct[0] : null;
  const lowerKey = key.toLowerCase();
  const lower = headers[lowerKey];
  if (typeof lower === "string") return lower;
  if (Array.isArray(lower)) return typeof lower[0] === "string" ? lower[0] : null;
  return null;
}
