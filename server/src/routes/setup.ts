import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { isDebtAccount, resetInputSchema, setupInputSchema, type SetupStatus } from '@budget/shared';
import type { Db } from '../db/index.ts';
import {
  accounts,
  categories,
  debts,
  fxCache,
  instruments,
  pieSlices,
  pies,
  priceCache,
  recurring,
  recurringSkips,
  trades,
  transactions,
} from '../db/schema.ts';
import { seed } from '../db/seed.ts';
import { HttpError } from '../http-error.ts';
import { debtAccount, debtOpeningRow } from './debts.ts';

/** Καμία κίνηση, κανένα χρωστούμενο και όλα τα υπόλοιπα 0: η εφαρμογή δεν έχει ξεκινήσει ακόμα. */
function isEmpty(db: Db) {
  return !db.select({ id: transactions.id }).from(transactions).limit(1).get()
    && !db.select({ id: recurring.id }).from(recurring).limit(1).get()
    && !db.select({ id: trades.id }).from(trades).limit(1).get()
    && !db.select({ id: debts.id }).from(debts).limit(1).get()
    && db.select().from(accounts).all().every(a => a.initialBalance === 0);
}

export function setupRoutes(app: FastifyInstance, db: Db, { backupDir }: { backupDir?: string }) {
  app.get('/api/setup/status', (): SetupStatus => ({ empty: isEmpty(db) }));

  // Αρχικοποίηση: υπόλοιπα, μετοχές και χρωστούμενα της ημέρας έναρξης. Όλα ή κανένα.
  app.post('/api/setup', (req, reply) => {
    const input = setupInputSchema.parse(req.body);
    if (!isEmpty(db)) throw new HttpError(409, 'Η εφαρμογή έχει ήδη δεδομένα');

    const byId = new Map(db.select().from(accounts).all().map(a => [a.id, a]));
    for (const b of input.balances) {
      const account = byId.get(b.accountId);
      if (!account || isDebtAccount(account)) throw new HttpError(400, 'Ο λογαριασμός δεν υπάρχει');
    }
    const instrumentIds = new Set(db.select({ id: instruments.id }).from(instruments).all().map(i => i.id));
    for (const p of input.positions) {
      if (byId.get(p.accountId)?.type !== 'broker') throw new HttpError(400, 'Οι μετοχές μπαίνουν μόνο σε λογαριασμό broker');
      if (!instrumentIds.has(p.instrumentId)) throw new HttpError(400, 'Η μετοχή δεν υπάρχει');
    }
    // Μετοχή του pie στον λογαριασμό του pie: η αρχική θέση ανήκει στο pie
    const pieOf = new Map(db.select().from(pieSlices).innerJoin(pies, eq(pieSlices.pieId, pies.id)).all()
      .map(r => [`${r.pies.accountId}:${r.pie_slices.instrumentId}`, r.pies.id]));

    db.transaction(tx => {
      for (const b of input.balances) {
        tx.update(accounts).set({ initialBalance: b.initialBalance }).where(eq(accounts.id, b.accountId)).run();
      }
      for (const p of input.positions) {
        tx.insert(trades).values({
          ...p,
          date: input.startDate,
          side: 'opening',
          pieId: pieOf.get(`${p.accountId}:${p.instrumentId}`) ?? null,
        }).run();
      }
      for (const d of input.debts) {
        const system = debtAccount(db, d.direction)!;
        const debt = tx.insert(debts)
          .values({ direction: d.direction, person: d.person, reason: d.reason, date: input.startDate })
          .returning().get();
        tx.insert(transactions).values(debtOpeningRow({ ...d, id: debt.id, date: input.startDate, accountId: null }, system.id)).run();
      }
    });
    return reply.code(204).send();
  });

  // Έναρξη από την αρχή: αντίγραφο της βάσης και μετά όλα από την αρχή (όπως στο πρώτο τρέξιμο)
  app.post('/api/reset', req => {
    resetInputSchema.parse(req.body);
    let backup: string | null = null;
    if (backupDir) {
      mkdirSync(backupDir, { recursive: true });
      backup = join(backupDir, `budget-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
      // Συνεπές αντίγραφο σε ένα αρχείο, ακόμα και με ανοιχτή τη βάση
      db.run(sql`VACUUM INTO ${backup}`);
    }
    // Σειρά διαγραφής: πρώτα ό,τι δείχνει σε άλλους πίνακες
    db.transaction(tx => {
      for (const table of [trades, transactions, recurringSkips, recurring, pieSlices, pies, debts, priceCache, fxCache, instruments, categories, accounts]) {
        tx.delete(table).run();
      }
    });
    seed(db);
    return { backup };
  });
}
