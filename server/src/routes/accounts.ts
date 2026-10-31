import { eq, or } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  accountInputSchema,
  computeBalances,
  idParamSchema,
  isDebtAccount,
  reconcileInputSchema,
  type AccountWithBalance,
} from '@budget/shared';
import type { Db } from '../db/index.ts';
import { accounts, trades, transactions } from '../db/schema.ts';
import { HttpError, notFound } from '../http-error.ts';
import { listTrades } from './investments.ts';
import { usedByRecurring } from './recurring.ts';

export function listAccounts(db: Db): AccountWithBalance[] {
  const rows = db.select().from(accounts).orderBy(accounts.sortOrder, accounts.id).all();
  const balances = computeBalances(rows, db.select().from(transactions).all(), undefined, listTrades(db));
  return rows.map(a => ({ ...a, balance: balances.get(a.id) ?? a.initialBalance }));
}

function getAccount(db: Db, id: number): AccountWithBalance {
  const account = listAccounts(db).find(a => a.id === id);
  if (!account) throw notFound('Ο λογαριασμός');
  return account;
}

/** Λογαριασμός που αλλάζει ο χρήστης: όχι οι λογαριασμοί συστήματος των χρωστούμενων. */
function getUserAccount(db: Db, id: number): AccountWithBalance {
  const account = getAccount(db, id);
  if (isDebtAccount(account)) throw new HttpError(400, 'Ο λογαριασμός αλλάζει μόνο από τα χρωστούμενα');
  return account;
}

export function accountRoutes(app: FastifyInstance, db: Db) {
  app.get('/api/accounts', () => listAccounts(db));

  app.post('/api/accounts', (req, reply) => {
    const input = accountInputSchema.parse(req.body);
    const maxOrder = Math.max(-1, ...db.select().from(accounts).all().map(a => a.sortOrder));
    const row = db.insert(accounts).values({ ...input, sortOrder: maxOrder + 1 }).returning().get();
    reply.code(201);
    return getAccount(db, row.id);
  });

  app.put('/api/accounts/:id', req => {
    const { id } = idParamSchema.parse(req.params);
    const input = accountInputSchema.parse(req.body);
    getUserAccount(db, id);
    const row = db.update(accounts).set(input).where(eq(accounts.id, id)).returning().get();
    if (!row) throw notFound('Ο λογαριασμός');
    return getAccount(db, id);
  });

  app.delete('/api/accounts/:id', (req, reply) => {
    const { id } = idParamSchema.parse(req.params);
    const used = db.select({ id: transactions.id }).from(transactions)
      .where(or(eq(transactions.accountId, id), eq(transactions.toAccountId, id))).limit(1).get();
    const traded = db.select({ id: trades.id }).from(trades).where(eq(trades.accountId, id)).limit(1).get();
    if (used || traded) throw new HttpError(409, 'Ο λογαριασμός έχει συναλλαγές. Μπορείς να τον αρχειοθετήσεις.');
    if (usedByRecurring(db, { accountId: id })) throw new HttpError(409, 'Ο λογαριασμός χρησιμοποιείται σε επαναλαμβανόμενη συναλλαγή');
    const row = db.delete(accounts).where(eq(accounts.id, id)).returning().get();
    if (!row) throw notFound('Ο λογαριασμός');
    return reply.code(204).send();
  });

  // Διόρθωση υπολοίπου: δημιουργεί adjustment ώστε το υπόλοιπο στην ημερομηνία να γίνει actualBalance
  app.post('/api/accounts/:id/reconcile', req => {
    const { id } = idParamSchema.parse(req.params);
    const { actualBalance, date } = reconcileInputSchema.parse(req.body);
    const account = getUserAccount(db, id);
    const balanceAtDate = computeBalances([account], db.select().from(transactions).all(), date, listTrades(db)).get(id) ?? 0;
    const diff = actualBalance - balanceAtDate;
    if (diff !== 0) {
      db.insert(transactions)
        .values({ date, type: 'adjustment', amount: diff, accountId: id, description: 'Διόρθωση υπολοίπου' })
        .run();
    }
    return { adjustment: diff, account: getAccount(db, id) };
  });
}
