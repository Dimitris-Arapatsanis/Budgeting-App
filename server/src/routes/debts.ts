import { and, eq, isNotNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  ACCOUNT_TYPE_LABELS,
  buildDebt,
  debtForgiveSchema,
  isDebtOpening,
  debtInputSchema,
  debtPaymentSchema,
  idParamSchema,
  isDebtAccount,
  type Debt,
  type DebtDirection,
} from '@budget/shared';
import { z } from 'zod';
import type { Db } from '../db/index.ts';
import { accounts, categories, debts, transactions } from '../db/schema.ts';
import { HttpError, notFound } from '../http-error.ts';

const debtAccountType = (direction: DebtDirection) => (direction === 'lent' ? 'receivable' : 'payable');

/** Ο λογαριασμός συστήματος για μια κατεύθυνση. Φτιάχνεται την πρώτη φορά που χρειάζεται. */
export function debtAccount(db: Db, direction: DebtDirection, create = true) {
  const type = debtAccountType(direction);
  const existing = db.select().from(accounts).where(eq(accounts.type, type)).get();
  if (existing || !create) return existing;
  const maxOrder = Math.max(-1, ...db.select().from(accounts).all().map(a => a.sortOrder));
  return db.insert(accounts)
    .values({ name: ACCOUNT_TYPE_LABELS[type], type, initialBalance: 0, sortOrder: maxOrder + 1 })
    .returning().get();
}

export function listDebts(db: Db): Debt[] {
  const rows = db.select().from(debts).all();
  if (rows.length === 0) return [];
  const txs = db.select().from(transactions).where(isNotNull(transactions.debtId)).all();
  const accountIds = { lent: debtAccount(db, 'lent', false)?.id, borrowed: debtAccount(db, 'borrowed', false)?.id };
  return rows
    .flatMap(row => {
      const accountId = accountIds[row.direction];
      const debt = accountId == null ? null : buildDebt(row, txs.filter(t => t.debtId === row.id), accountId);
      return debt ? [debt] : [];
    })
    .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
}

function getDebt(db: Db, id: number): Debt {
  const debt = listDebts(db).find(d => d.id === id);
  if (!debt) throw notFound('Το χρωστούμενο');
  return debt;
}

/**
 * Η συναλλαγή που ανοίγει ένα χρωστούμενο. Με λογαριασμό: μεταφορά από/προς αυτόν. Χωρίς (παλιό χρέος):
 * διόρθωση στον λογαριασμό συστήματος, που δεν μετράει πουθενά ως κίνηση.
 */
export function debtOpeningRow(
  debt: { id: number; direction: DebtDirection; person: string; date: string; amount: number; accountId: number | null },
  systemAccountId: number,
) {
  const lent = debt.direction === 'lent';
  const common = { date: debt.date, amount: debt.amount, description: debt.person, debtId: debt.id };
  if (debt.accountId == null) {
    return { ...common, type: 'adjustment' as const, amount: lent ? debt.amount : -debt.amount, accountId: systemAccountId, toAccountId: null };
  }
  return {
    ...common,
    type: 'transfer' as const,
    accountId: lent ? debt.accountId : systemAccountId,
    toAccountId: lent ? systemAccountId : debt.accountId,
  };
}

/** Λογαριασμός του χρήστη (όχι συστήματος) που υπάρχει. */
function checkUserAccount(db: Db, id: number | null) {
  if (id == null) return;
  const account = db.select().from(accounts).where(eq(accounts.id, id)).get();
  if (!account || isDebtAccount(account)) throw new HttpError(400, 'Ο λογαριασμός δεν υπάρχει');
}

const paymentParamSchema = z.object({ id: z.coerce.number().int().positive(), transactionId: z.coerce.number().int().positive() });

export function debtRoutes(app: FastifyInstance, db: Db) {
  app.get('/api/debts', () => listDebts(db));

  app.post('/api/debts', (req, reply) => {
    const input = debtInputSchema.parse(req.body);
    checkUserAccount(db, input.accountId);
    const id = db.transaction(tx => {
      const system = debtAccount(db, input.direction)!;
      const debt = tx.insert(debts)
        .values({ direction: input.direction, person: input.person, reason: input.reason, date: input.date })
        .returning().get();
      tx.insert(transactions).values(debtOpeningRow({ ...input, id: debt.id }, system.id)).run();
      return debt.id;
    });
    reply.code(201);
    return getDebt(db, id);
  });

  app.put('/api/debts/:id', req => {
    const { id } = idParamSchema.parse(req.params);
    const input = debtInputSchema.parse(req.body);
    checkUserAccount(db, input.accountId);
    const current = getDebt(db, id);
    if (input.direction !== current.direction) throw new HttpError(400, 'Δεν αλλάζει το είδος του χρωστούμενου');
    if (input.amount < current.settled) {
      throw new HttpError(400, 'Το ποσό δεν μπορεί να είναι μικρότερο από όσα έχουν ήδη επιστραφεί');
    }
    const system = debtAccount(db, current.direction)!;
    const opening = db.select().from(transactions).where(eq(transactions.debtId, id)).all()
      .find(t => isDebtOpening(t, current.direction, system.id))!;
    // Το άνοιγμα ξαναγράφεται: μπορεί να αλλάξει από μεταφορά σε παλιό χρέος και αντίστροφα
    db.transaction(tx => {
      tx.update(debts).set({ person: input.person, reason: input.reason, date: input.date }).where(eq(debts.id, id)).run();
      tx.update(transactions).set(debtOpeningRow({ ...input, id }, system.id)).where(eq(transactions.id, opening.id)).run();
    });
    return getDebt(db, id);
  });

  app.delete('/api/debts/:id', (req, reply) => {
    const { id } = idParamSchema.parse(req.params);
    getDebt(db, id);
    db.transaction(tx => {
      tx.delete(transactions).where(eq(transactions.debtId, id)).run();
      tx.delete(debts).where(eq(debts.id, id)).run();
    });
    return reply.code(204).send();
  });

  // Επιστροφή (ολόκληρη ή μέρος)
  app.post('/api/debts/:id/payments', (req, reply) => {
    const { id } = idParamSchema.parse(req.params);
    const input = debtPaymentSchema.parse(req.body);
    checkUserAccount(db, input.accountId);
    const debt = getDebt(db, id);
    if (input.amount > debt.outstanding) throw new HttpError(400, 'Το ποσό είναι μεγαλύτερο από όσα απομένουν');
    const system = debtAccount(db, debt.direction)!;
    const lent = debt.direction === 'lent';
    db.insert(transactions).values({
      date: input.date,
      type: 'transfer',
      amount: input.amount,
      accountId: lent ? system.id : input.accountId,
      toAccountId: lent ? input.accountId : system.id,
      description: debt.person,
      debtId: id,
    }).run();
    reply.code(201);
    return getDebt(db, id);
  });

  // Χαρίστηκε: το υπόλοιπο γίνεται έξοδο (δάνεισα) ή έσοδο (δανείστηκα)
  app.post('/api/debts/:id/forgive', (req, reply) => {
    const { id } = idParamSchema.parse(req.params);
    const input = debtForgiveSchema.parse(req.body);
    const debt = getDebt(db, id);
    if (debt.outstanding <= 0) throw new HttpError(400, 'Το χρωστούμενο έχει ήδη εξοφληθεί');
    const kind = debt.direction === 'lent' ? 'expense' : 'income';
    const category = db.select().from(categories).where(eq(categories.id, input.categoryId)).get();
    if (!category || category.kind !== kind) throw new HttpError(400, 'Η κατηγορία δεν ταιριάζει');
    db.insert(transactions).values({
      date: input.date,
      type: kind,
      amount: debt.outstanding,
      accountId: debtAccount(db, debt.direction)!.id,
      categoryId: input.categoryId,
      description: `Χαρίστηκε · ${debt.person}`,
      debtId: id,
    }).run();
    reply.code(201);
    return getDebt(db, id);
  });

  // Αναίρεση μιας επιστροφής ή του «χαρίστηκε»
  app.delete('/api/debts/:id/payments/:transactionId', req => {
    const { id, transactionId } = paymentParamSchema.parse(req.params);
    const debt = getDebt(db, id);
    if (!debt.payments.some(p => p.transactionId === transactionId)) throw notFound('Η επιστροφή');
    db.delete(transactions).where(and(eq(transactions.id, transactionId), eq(transactions.debtId, id))).run();
    return getDebt(db, id);
  });
}
