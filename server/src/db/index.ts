import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema.ts';
import { seed, type SeedProfile } from './seed.ts';

export type Db = BetterSQLite3Database<typeof schema>;

const MIGRATIONS_DIR = fileURLToPath(new URL('../../drizzle', import.meta.url));

/** Ανοίγει τη βάση (":memory:" για tests), τρέχει migrations και seed. */
export function openDb(file: string, { seed: profile = 'default' }: { seed?: SeedProfile } = {}): Db {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  seed(db, profile);
  return db;
}
