import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { categoryInputSchema, idParamSchema } from '@budget/shared';
import type { Db } from '../db/index.ts';
import { categories, transactions } from '../db/schema.ts';
import { HttpError, notFound } from '../http-error.ts';

const isUniqueViolation = (err: unknown) =>
  err instanceof Error && 'code' in err && err.code === 'SQLITE_CONSTRAINT_UNIQUE';

const duplicate = () => new HttpError(409, 'Υπάρχει ήδη κατηγορία με αυτό το όνομα');

export function categoryRoutes(app: FastifyInstance, db: Db) {
  app.get('/api/categories', () => db.select().from(categories).orderBy(categories.kind, categories.id).all());

  app.post('/api/categories', (req, reply) => {
    const input = categoryInputSchema.parse(req.body);
    try {
      const row = db.insert(categories).values(input).returning().get();
      reply.code(201);
      return row;
    } catch (err) {
      throw isUniqueViolation(err) ? duplicate() : err;
    }
  });

  app.put('/api/categories/:id', req => {
    const { id } = idParamSchema.parse(req.params);
    const input = categoryInputSchema.parse(req.body);
    const existing = db.select().from(categories).where(eq(categories.id, id)).get();
    if (!existing) throw notFound('Η κατηγορία');
    if (existing.kind !== input.kind) {
      const used = db.select({ id: transactions.id }).from(transactions)
        .where(eq(transactions.categoryId, id)).limit(1).get();
      if (used) throw new HttpError(409, 'Η κατηγορία έχει συναλλαγές, δεν μπορεί να αλλάξει είδος');
    }
    try {
      return db.update(categories).set(input).where(eq(categories.id, id)).returning().get();
    } catch (err) {
      throw isUniqueViolation(err) ? duplicate() : err;
    }
  });

  app.delete('/api/categories/:id', (req, reply) => {
    const { id } = idParamSchema.parse(req.params);
    const used = db.select({ id: transactions.id }).from(transactions)
      .where(eq(transactions.categoryId, id)).limit(1).get();
    if (used) throw new HttpError(409, 'Η κατηγορία έχει συναλλαγές και δεν μπορεί να διαγραφεί');
    const row = db.delete(categories).where(eq(categories.id, id)).returning().get();
    if (!row) throw notFound('Η κατηγορία');
    return reply.code(204).send();
  });
}
