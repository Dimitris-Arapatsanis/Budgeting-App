import { desc, eq, isNotNull, like } from 'drizzle-orm';
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
import { accounts, categories, trades, transactions } from '../db/schema.ts';
import { HttpError, notFound } from '../http-error.ts';
import { recurringLink } from './recurring.ts';
import { listTrades } from './investments.ts';
import { deleteFee, setFee } from '../fees.ts';

/** Οι μεταφορές που φτιάχτηκαν αυτόματα για αγορές μετοχών («Χρήματα από»). */
function fundingTransactionIds(db: Db) {
  return new Set(db.select({ id: trades.fundingTransactionId }).from(trades).where(isNotNull(trades.fundingTransactionId)).all().map(r => r.id));
}

/** Συναλλαγές μιας περιόδου: `period` = "YYYY-MM" (μήνας) ή "YYYY" (έτος). */
function periodTransactions(db: Db, period: string): Transaction[] {
  const funding = fundingTransactionIds(db);
  const rows = db.select({
    id: transactions.id,
    date: transactions.date,
    type: transactions.type,
    amount: transactions.amount,
    accountId: transactions.accountId,
    toAccountId: transactions.toAccountId,
    categoryId: transactions.categoryId,
    description: transactions.description,
    debtId: transactions.debtId,
    recurringId: transactions.recurringId,
    recurringDue: transactions.recurringDue,
    feeForId: transactions.feeForId,
  })
    .from(transactions)
    .where(like(transactions.date, `${period}-%`))
    .orderBy(desc(transactions.date), desc(transactions.id))
    .all();
  // Η χρέωση έχει την ίδια ημερομηνία με τη συναλλαγή της, άρα είναι στην ίδια περίοδο
  const fees = new Map(rows.filter(t => t.feeForId != null).map(t => [t.feeForId!, t.amount]));
  return rows.map(t => ({
    ...t,
    ...(funding.has(t.id) && { tradeFunding: true }),
    ...(fees.has(t.id) && { fee: fees.get(t.id) }),
  }));
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
    ...recurringLink(db, input),
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

/** Χρέωση μόνο σε έξοδα και μεταφορές. */
const feeOf = (input: ParsedTransactionInput) => (input.type === 'expense' || input.type === 'transfer' ? input.fee : 0);

/** Οι συναλλαγές των χρωστούμενων και οι μεταφορές των αγορών μετοχών αλλάζουν μόνο από εκεί που φτιάχτηκαν. */
function checkNotDebt(db: Db, id: number) {
  const row = db.select({ debtId: transactions.debtId, feeForId: transactions.feeForId }).from(transactions).where(eq(transactions.id, id)).get();
  if (!row) throw notFound('Η συναλλαγή');
  if (row.feeForId != null) throw new HttpError(409, 'Η χρέωση αλλάζει μαζί με τη συναλλαγή της.');
  if (row.debtId != null) throw new HttpError(409, 'Η συναλλαγή ανήκει σε χρωστούμενο. Άλλαξέ την από τους Λογαριασμούς.');
  if (fundingTransactionIds(db).has(id)) {
    throw new HttpError(409, 'Η μεταφορά ανήκει σε αγορά μετοχών. Άλλαξέ την από τις Επενδύσεις.');
  }
}

export function transactionRoutes(app: FastifyInstance, db: Db) {
  app.get('/api/transactions', req => {
    const { month } = monthQuerySchema.parse(req.query);
    return periodTransactions(db, month);
  });

  app.post('/api/transactions', (req, reply) => {
    const input = transactionInputSchema.parse(req.body);
    const row = toRow(db, input);
    reply.code(201);
    return db.transaction(tx => {
      const created = tx.insert(transactions).values(row).returning().get();
      setFee(tx, created, feeOf(input));
      return created;
    });
  });

  app.put('/api/transactions/:id', req => {
    const { id } = idParamSchema.parse(req.params);
    checkNotDebt(db, id);
    const input = transactionInputSchema.parse(req.body);
    const row = toRow(db, input);
    return db.transaction(tx => {
      const updated = tx.update(transactions).set(row).where(eq(transactions.id, id)).returning().get();
      if (!updated) throw notFound('Η συναλλαγή');
      setFee(tx, updated, feeOf(input));
      return updated;
    });
  });

  app.delete('/api/transactions/:id', (req, reply) => {
    const { id } = idParamSchema.parse(req.params);
    checkNotDebt(db, id);
    const row = db.transaction(tx => {
      deleteFee(tx, id);
      return tx.delete(transactions).where(eq(transactions.id, id)).returning().get();
    });
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
