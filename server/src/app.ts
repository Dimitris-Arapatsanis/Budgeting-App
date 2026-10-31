import { existsSync } from 'node:fs';
import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyError, type FastifyServerOptions } from 'fastify';
import { ZodError } from 'zod';
import type { Db } from './db/index.ts';
import { HttpError } from './http-error.ts';
import { yahooMarketData, type MarketData } from './market/market-data.ts';
import { Prices } from './market/prices.ts';
import { accountRoutes } from './routes/accounts.ts';
import { authRoutes } from './routes/auth.ts';
import { categoryRoutes } from './routes/categories.ts';
import { debtRoutes } from './routes/debts.ts';
import { investmentRoutes } from './routes/investments.ts';
import { netWorthRoutes } from './routes/networth.ts';
import { recurringRoutes } from './routes/recurring.ts';
import { setupRoutes } from './routes/setup.ts';
import { transactionRoutes } from './routes/transactions.ts';

interface AppOptions extends Pick<FastifyServerOptions, 'logger'> {
  /** Πηγή τιμών (στα tests ένα fake) */
  market?: MarketData;
  /** Φάκελος για αντίγραφα της βάσης πριν από «Έναρξη από την αρχή» (χωρίς αντίγραφο αν λείπει, π.χ. στα tests) */
  backupDir?: string;
  /** Σύνδεση με κωδικό (ενεργή στον πραγματικό server, ανενεργή στα tests) */
  auth?: boolean;
  /** Το build του client (client/dist): αν υπάρχει, ο server σερβίρει και την εφαρμογή */
  staticDir?: string;
}

export function buildApp(db: Db, { logger = false, market = yahooMarketData(), backupDir, auth = false, staticDir }: AppOptions = {}) {
  // trustProxy: πίσω από το «tailscale serve» το πρωτόκολλο (https) έρχεται στο X-Forwarded-Proto
  const app = Fastify({ logger, trustProxy: true });
  app.register(fastifyCookie);

  app.setErrorHandler((error, req, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: error.issues[0]?.message ?? 'Μη έγκυρα δεδομένα', issues: error.issues });
    }
    if (error instanceof HttpError) {
      return reply.code(error.statusCode).send({ error: error.message });
    }
    const statusCode = (error as FastifyError).statusCode ?? 500;
    if (statusCode >= 500) req.log.error(error);
    return reply.code(statusCode).send({ error: statusCode >= 500 ? 'Σφάλμα server' : (error as Error).message });
  });

  // Πρώτα η σύνδεση: το hook της προστατεύει όλα τα /api/
  authRoutes(app, db, { enabled: auth });
  accountRoutes(app, db);
  categoryRoutes(app, db);
  transactionRoutes(app, db);
  debtRoutes(app, db);
  const prices = new Prices(db, market);
  investmentRoutes(app, db, market, prices);
  netWorthRoutes(app, db, prices);
  setupRoutes(app, db, { backupDir });
  recurringRoutes(app, db);

  // Παραγωγή: ο server σερβίρει και την εφαρμογή. Κάθε άγνωστο path (εκτός /api) δίνει το index.html (SPA).
  if (staticDir && existsSync(staticDir)) {
    app.register(fastifyStatic, { root: staticDir });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/')) return reply.sendFile('index.html');
      return reply.code(404).send({ error: 'Δεν βρέθηκε' });
    });
  }

  return app;
}
