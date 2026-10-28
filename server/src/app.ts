import Fastify, { type FastifyError, type FastifyServerOptions } from 'fastify';
import { ZodError } from 'zod';
import type { Db } from './db/index.ts';
import { HttpError } from './http-error.ts';
import { accountRoutes } from './routes/accounts.ts';
import { categoryRoutes } from './routes/categories.ts';
import { transactionRoutes } from './routes/transactions.ts';

export function buildApp(db: Db, { logger = false }: Pick<FastifyServerOptions, 'logger'> = {}) {
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

  return app;
}
