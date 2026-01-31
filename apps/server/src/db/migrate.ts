import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { withClient } from "./index";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SQL_DIR = path.resolve(__dirname, "../../sql");

async function main(): Promise<void> {
  const files = fs
    .readdirSync(SQL_DIR)
    .filter((f) => /^\d+_.*\.sql$/.test(f))
    .sort();

  await withClient(async (c) => {
    await c.query("BEGIN");
    try {
      await c.query(`CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
      const { rows } = await c.query("SELECT version FROM schema_migrations");
      const applied = new Set(rows.map((r: { version: string }) => r.version));

      for (const f of files) {
        if (applied.has(f)) continue;
        const sql = fs.readFileSync(path.join(SQL_DIR, f), "utf8");
        await c.query(sql);
        await c.query("INSERT INTO schema_migrations(version) VALUES($1)", [f]);
        // eslint-disable-next-line no-console
        console.log(`Applied ${f}`);
      }

      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    }
  });
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
