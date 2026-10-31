import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.ts';
import { startDailyBackups } from './backup.ts';
import { openDb } from './db/index.ts';

const port = Number(process.env.PORT ?? 3001);
// Μόνο τοπικά: το κινητό έρχεται μέσω «tailscale serve», όχι κατευθείαν από το δίκτυο
const host = process.env.HOST ?? '127.0.0.1';
const dbFile = process.env.DB_FILE ?? fileURLToPath(new URL('../data/budget.db', import.meta.url));
const backupDir = join(dirname(dbFile), 'backups');
const staticDir = fileURLToPath(new URL('../../client/dist', import.meta.url));

const db = openDb(dbFile);
const app = buildApp(db, {
  logger: { level: process.env.LOG_LEVEL ?? 'warn' },
  backupDir,
  // AUTH=off μόνο για δοκιμές με δοκιμαστική βάση
  auth: process.env.AUTH !== 'off',
  staticDir,
});
try {
  await app.listen({ port, host });
} catch (err) {
  if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
    console.error(`
Η θύρα ${port} είναι πιασμένη: η εφαρμογή τρέχει ήδη (π.χ. «npm run dev» ή άλλο παράθυρο του start-budget.cmd).
Κλείσε το άλλο παράθυρο (Ctrl+C) και ξαναδοκίμασε.
`);
    process.exit(1);
  }
  throw err;
}
startDailyBackups(db, backupDir, msg => console.log(msg));
const serving = existsSync(staticDir) ? 'εφαρμογή + API' : 'API';
console.log(`${serving}: http://${host === '0.0.0.0' ? 'localhost' : host}:${port}  ·  βάση: ${dbFile}`);
