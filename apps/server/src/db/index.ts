import pg from "pg";
import { env } from "../config";

export const pool = new pg.Pool({ connectionString: env.DATABASE_URL });

export async function withClient<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    return await fn(c);
  } finally {
    c.release();
  }
}
