import { desc, eq, like } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  computeMonthSummary,
  computeYearSummary,
  idParamSchema,
  isDebtAccount,
  monthQuerySchema,
  transactionInputSchema,
  yearQuerySchema,
  type ParsedTransactionInput,
  type Transaction,
} from '@budget/shared';
import type { Db } from '../db/index.ts';
import { accounts, categories, transactions } from '../db/schema.ts';
import { HttpError, notFound } from '../http-error.ts';
import { listTrades } from './investments.ts';

/** Συναλλαγές μιας περιόδου: `period` = "YYYY-MM" (μήνας) ή "YYYY" (έτος). */
function periodTransactions(db: Db, period: string): Transaction[] {
  return db.select({
    id: transactions.id,
    date: transactions.date,
    type: transactions.type,
    amount: transactions.amount,
    accountId: transactions.accountId,
    toAccountId: transactions.toAccountId,
    categoryId: transactions.categoryId,
    description: transactions.description,
    debtId: transactions.debtId,
  })
    .from(transactions)
    .where(like(transactions.date, `${period}-%`))
    .orderBy(desc(transactions.date), desc(transactions.id))
    .all();
}

/** Μετατρέπει το validated input σε γραμμή πίνακα, ελέγχοντας ότι λογαριασμοί/κατηγορία υπάρχουν. */
function toRow(db: Db, input: ParsedTransactionInput) {
  // Οι λογαριασμοί των χρωστούμενων αλλάζουν μόνο από το /api/debts
  const accountExists = (id: number) => {
    const account = db.select().from(accounts).where(eq(accounts.id, id)).get();
    return !!account && !isDebtAccount(account);
  };
  if (!accountExists(input.accountId)) throw new HttpError(400, 'Ο λογαριασμός δεν υπάρχει');

  const row = {
    date: input.date,
    type: input.type,
    amount: input.amount,
    accountId: input.accountId,
    description: input.description,
    toAccountId: null as number | null,
    categoryId: null as number | null,
  };

  if (input.type === 'income' || input.type === 'expense') {
    const category = db.select().from(categories).where(eq(categories.id, input.categoryId)).get();
    if (!category) throw new HttpError(400, 'Η κατηγορία δεν υπάρχει');
    if (category.kind !== input.type) throw new HttpError(400, 'Η κατηγορία δεν ταιριάζει με το είδος της συναλλαγής');
    row.categoryId = input.categoryId;
  } else if (input.type === 'transfer') {
    if (!accountExists(input.toAccountId)) throw new HttpError(400, 'Ο λογαριασμός προορισμού δεν υπάρχει');
    row.toAccountId = input.toAccountId;
  }
  return row;
}

/** Οι συναλλαγές των χρωστούμενων αλλάζουν μόνο από τα χρωστούμενα. */
function checkNotDebt(db: Db, id: number) {
  const row = db.select({ debtId: transactions.debtId }).from(transactions).where(eq(transactions.id, id)).get();
  if (!row) throw notFound('Η συναλλαγή');
  if (row.debtId != null) throw new HttpError(409, 'Η συναλλαγή ανήκει σε χρωστούμενο. Άλλαξέ την από τους Λογαριασμούς.');
}

export function transactionRoutes(app: FastifyInstance, db: Db) {
  app.get('/api/transactions', req => {
    const { month } = monthQuerySchema.parse(req.query);
    return periodTransactions(db, month);
  });

  app.post('/api/transactions', (req, reply) => {
    const row = toRow(db, transactionInputSchema.parse(req.body));
    reply.code(201);
    return db.insert(transactions).values(row).returning().get();
  });

  app.put('/api/transactions/:id', req => {
    const { id } = idParamSchema.parse(req.params);
    checkNotDebt(db, id);
    const row = toRow(db, transactionInputSchema.parse(req.body));
    const updated = db.update(transactions).set(row).where(eq(transactions.id, id)).returning().get();
    if (!updated) throw notFound('Η συναλλαγή');
    return updated;
  });

  app.delete('/api/transactions/:id', (req, reply) => {
    const { id } = idParamSchema.parse(req.params);
    checkNotDebt(db, id);
    const row = db.delete(transactions).where(eq(transactions.id, id)).returning().get();
    if (!row) throw notFound('Η συναλλαγή');
    return reply.code(204).send();
  });

  app.get('/api/summary', req => {
    const { month } = monthQuerySchema.parse(req.query);
    const monthTrades = listTrades(db).filter(t => t.date.startsWith(month));
    return computeMonthSummary(periodTransactions(db, month), db.select().from(accounts).all(), monthTrades);
  });

  app.get('/api/year', req => {
    const { year } = yearQuerySchema.parse(req.query);
    const yearTrades = listTrades(db).filter(t => t.date.startsWith(`${year}-`));
    return computeYearSummary(year, periodTransactions(db, String(year)), db.select().from(accounts).all(), yearTrades);
  });
}
