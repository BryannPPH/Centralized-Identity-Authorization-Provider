import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

const { Client } = pg;

const prismaBin =
  process.platform === "win32"
    ? "node_modules/.bin/prisma.cmd"
    : "node_modules/.bin/prisma";

const localDatabases = [
  ["App A", "APP_A_DATABASE_URL"],
  ["App B", "APP_B_DATABASE_URL"]
];

const localMigrationsDir = "prisma/local-migrations";

function loadDotEnv() {
  try {
    for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);

      if (!match || process.env[match[1]] !== undefined) {
        continue;
      }

      process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    // Compose injects env directly; local runs can create .env from .env.example.
  }
}

function requireEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}

function run(command, args, env) {
  const result = spawnSync(command, args, {
    env: {
      ...process.env,
      ...env
    },
    stdio: "inherit"
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

async function applyLocalMigrations(label, databaseUrl) {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS "local_migrations" (
        "name" TEXT PRIMARY KEY,
        "applied_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const migrations = readdirSync(localMigrationsDir)
      .filter((file) => file.endsWith(".sql"))
      .sort();

    for (const migration of migrations) {
      const applied = await client.query(
        'SELECT 1 FROM "local_migrations" WHERE "name" = $1',
        [migration]
      );

      if (applied.rowCount) {
        continue;
      }

      console.log(`Applying local migration ${migration} for ${label}`);
      await client.query("BEGIN");

      try {
        await client.query(readFileSync(join(localMigrationsDir, migration), "utf8"));
        await client.query('INSERT INTO "local_migrations" ("name") VALUES ($1)', [
          migration
        ]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client.end();
  }
}

loadDotEnv();
run(prismaBin, ["generate"]);

console.log("Applying migrations for Auth Provider");
run(prismaBin, ["migrate", "deploy"], {
  DATABASE_URL: requireEnv("AUTH_DATABASE_URL")
});

for (const [label, envName] of localDatabases) {
  await applyLocalMigrations(label, requireEnv(envName));
}

console.log("Seeding Auth Provider");
run(prismaBin, ["db", "seed"], {
  DATABASE_URL: requireEnv("AUTH_DATABASE_URL")
});
