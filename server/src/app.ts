import Fastify, { type FastifyError, type FastifyServerOptions } from 'fastify';
import { ZodError } from 'zod';
import type { Db } from './db/index.ts';
import { HttpError } from './http-error.ts';
import { yahooMarketData, type MarketData } from './market/market-data.ts';
import { Prices } from './market/prices.ts';
import { accountRoutes } from './routes/accounts.ts';
import { categoryRoutes } from './routes/categories.ts';
import { debtRoutes } from './routes/debts.ts';
import { investmentRoutes } from './routes/investments.ts';
import { transactionRoutes } from './routes/transactions.ts';

interface AppOptions extends Pick<FastifyServerOptions, 'logger'> {
  /** Πηγή τιμών (στα tests ένα fake) */
  market?: MarketData;
}

export function buildApp(db: Db, { logger = false, market = yahooMarketData() }: AppOptions = {}) {
  const app = Fastify({ logger });

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

  accountRoutes(app, db);
  categoryRoutes(app, db);
  transactionRoutes(app, db);
  debtRoutes(app, db);
  investmentRoutes(app, db, market, new Prices(db, market));

  return app;
}
