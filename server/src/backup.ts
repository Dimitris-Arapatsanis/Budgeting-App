import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { today } from '@budget/shared';
import type { Db } from './db/index.ts';

const DAILY = /^daily-\d{4}-\d{2}-\d{2}\.db$/;

/**
 * Ημερήσιο αντίγραφο της βάσης (`daily-YYYY-MM-DD.db`), αν δεν υπάρχει ήδη για σήμερα. Κρατάει τα `keep`
 * πιο πρόσφατα. Τα αντίγραφα της «Έναρξης από την αρχή» (`budget-*.db`) δεν τα αγγίζει.
 */
export function dailyBackup(db: Db, dir: string, keep = 30, date = today()): string | null {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `daily-${date}.db`);
  if (existsSync(file)) return null;
  db.run(sql`VACUUM INTO ${file}`);
  const daily = readdirSync(dir).filter(f => DAILY.test(f)).sort();
  for (const old of daily.slice(0, Math.max(0, daily.length - keep))) rmSync(join(dir, old));
  return file;
}

/** Αντίγραφο με την εκκίνηση και μετά έλεγχος κάθε ώρα (νέα μέρα = νέο αντίγραφο). */
export function startDailyBackups(db: Db, dir: string, log: (msg: string) => void = () => {}) {
  const run = () => {
    try {
      const file = dailyBackup(db, dir);
      if (file) log(`Αντίγραφο ασφαλείας: ${file}`);
    } catch (err) {
      log(`Το αντίγραφο ασφαλείας απέτυχε: ${(err as Error).message}`);
    }
  };
  run();
  return setInterval(run, 60 * 60_000).unref();
}
