import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { withClient } from "../db";
import {
  AuthError,
  buildGuestEmail,
  buildSessionExpiry,
  hashPassword,
  hashToken,
  issueAuthToken,
  normalizeEmail,
  readAuthToken,
  resolveAuth,
  resolveAuthFromHeaders,
  verifyPassword
} from "../lib/auth";

const RegisterBody = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  display_name: z.string().min(1).optional()
});

const PromoteBody = RegisterBody;

const LoginBody = z.object({
  email: z.string().email(),
  password: z.string().min(8)
});

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/auth/register", async (req, reply) => {
    const body = RegisterBody.parse(req.body);
    const email = normalizeEmail(body.email);
    const displayName = body.display_name?.trim() || null;
    const passwordHash = hashPassword(body.password);
    const token = issueAuthToken();
    const tokenHash = hashToken(token);
    const userId = randomUUID();
    const sessionId = randomUUID();
    const expiresAt = buildSessionExpiry();

    try {
      const result = await withClient(async (c) => {
        const existing = (await c.query(
          "SELECT user_id FROM users WHERE lower(email) = lower($1)",
          [email]
        )).rows as Array<{ user_id: string }>;
        if (existing.length > 0) {
          return { conflict: true } as const;
        }
        await c.query(
          `INSERT INTO users (user_id, email, display_name, password_hash, is_guest)
           VALUES ($1, $2, $3, $4, $5)`,
          [userId, email, displayName, passwordHash, false]
        );
        await c.query(
          `INSERT INTO user_sessions (session_id, user_id, token_hash, expires_at)
           VALUES ($1, $2, $3, $4)`,
          [sessionId, userId, tokenHash, expiresAt]
        );
        return { conflict: false } as const;
      });

      if (result.conflict) {
        return reply.status(409).send({ error: "Email already registered." });
      }

      return reply.send({
        token,
        expires_at: expiresAt.toISOString(),
        user: { user_id: userId, email, display_name: displayName ?? undefined, is_guest: false }
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: message });
    }
  });

  app.post("/api/auth/login", async (req, reply) => {
    const body = LoginBody.parse(req.body);
    const email = normalizeEmail(body.email);
    const token = issueAuthToken();
    const tokenHash = hashToken(token);
    const sessionId = randomUUID();
    const expiresAt = buildSessionExpiry();

    try {
      const result = await withClient(async (c) => {
        const rows = (await c.query(
          "SELECT user_id, email, display_name, password_hash FROM users WHERE lower(email) = lower($1)",
          [email]
        )).rows as Array<{ user_id: string; email: string; display_name: string | null; password_hash: string }>;
        const user = rows[0];
        if (!user || !verifyPassword(body.password, user.password_hash)) return null;
        await c.query(
          `INSERT INTO user_sessions (session_id, user_id, token_hash, expires_at)
           VALUES ($1, $2, $3, $4)`,
          [sessionId, user.user_id, tokenHash, expiresAt]
        );
        return user;
      });

      if (!result) {
        return reply.status(401).send({ error: "Invalid email or password." });
      }

      return reply.send({
        token,
        expires_at: expiresAt.toISOString(),
        user: { user_id: result.user_id, email: result.email, display_name: result.display_name ?? undefined, is_guest: false }
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: message });
    }
  });

  app.post("/api/auth/guest", async (_req, reply) => {
    const token = issueAuthToken();
    const tokenHash = hashToken(token);
    const userId = randomUUID();
    const sessionId = randomUUID();
    const expiresAt = buildSessionExpiry();
    const email = buildGuestEmail(userId);
    const passwordHash = hashPassword(issueAuthToken());

    try {
      await withClient(async (c) => {
        await c.query(
          `INSERT INTO users (user_id, email, display_name, password_hash, is_guest)
           VALUES ($1, $2, $3, $4, $5)`,
          [userId, email, "Guest", passwordHash, true]
        );
        await c.query(
          `INSERT INTO user_sessions (session_id, user_id, token_hash, expires_at)
           VALUES ($1, $2, $3, $4)`,
          [sessionId, userId, tokenHash, expiresAt]
        );
      });

      return reply.send({
        token,
        expires_at: expiresAt.toISOString(),
        user: { user_id: userId, email, display_name: "Guest", is_guest: true }
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: message });
    }
  });

  app.post("/api/auth/logout", async (req, reply) => {
    const token = readAuthToken(req.headers as Record<string, unknown>);
    if (!token) return reply.status(401).send({ error: "Missing auth token." });
    try {
      const result = await withClient(async (c) => {
        const auth = await resolveAuth(c, token);
        if (!auth) return false;
        await c.query("UPDATE user_sessions SET revoked_at = now() WHERE session_id = $1", [auth.sessionId]);
        return true;
      });
      if (!result) return reply.status(401).send({ error: "Invalid or expired session." });
      return reply.send({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: message });
    }
  });

  app.post("/api/auth/promote", async (req, reply) => {
    const body = PromoteBody.parse(req.body);
    const email = normalizeEmail(body.email);
    const displayName = body.display_name?.trim() || null;
    const passwordHash = hashPassword(body.password);
    const token = readAuthToken(req.headers as Record<string, unknown>);
    if (!token) return reply.status(401).send({ error: "Missing auth token." });

    try {
      const result = await withClient(async (c) => {
        const auth = await resolveAuth(c, token);
        if (!auth) return { status: 401 as const };
        if (!auth.user.is_guest) return { status: 400 as const };
        const conflict = (await c.query(
          "SELECT user_id FROM users WHERE lower(email) = lower($1) AND user_id <> $2",
          [email, auth.user.user_id]
        )).rows as Array<{ user_id: string }>;
        if (conflict.length > 0) return { status: 409 as const };
        await c.query(
          `UPDATE users
           SET email = $1, display_name = $2, password_hash = $3, is_guest = false
           WHERE user_id = $4`,
          [email, displayName, passwordHash, auth.user.user_id]
        );
        return { status: 200 as const, user_id: auth.user.user_id };
      });

      if (result.status === 401) return reply.status(401).send({ error: "Invalid or expired session." });
      if (result.status === 400) return reply.status(400).send({ error: "Session is not a guest account." });
      if (result.status === 409) return reply.status(409).send({ error: "Email already registered." });

      return reply.send({
        token,
        user: { user_id: result.user_id, email, display_name: displayName ?? undefined, is_guest: false }
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: message });
    }
  });

  app.get("/api/auth/me", async (req, reply) => {
    try {
      const result = await withClient(async (c) => {
        const auth = await resolveAuthFromHeaders(c, req.headers as Record<string, unknown>, { required: true });
        if (!auth) throw new AuthError("Missing auth token.");
        return auth.user;
      });
      return reply.send({ user: result });
    } catch (err) {
      if (err instanceof AuthError) {
        return reply.status(err.status).send({ error: err.message });
      }
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: message });
    }
  });
}
