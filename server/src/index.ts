import { fileURLToPath } from 'node:url';
import { buildApp } from './app.ts';
import { openDb } from './db/index.ts';

const port = Number(process.env.PORT ?? 3001);
const dbFile = process.env.DB_FILE ?? fileURLToPath(new URL('../data/budget.db', import.meta.url));

const app = buildApp(openDb(dbFile), { logger: { level: process.env.LOG_LEVEL ?? 'warn' } });
await app.listen({ port, host: '127.0.0.1' });
console.log(`API: http://127.0.0.1:${port}  ·  βάση: ${dbFile}`);
