import { and, eq, inArray, isNotNull, or } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  dueDateIn,
  idParamSchema,
  isDebtAccount,
  monthQuerySchema,
  recurringInputSchema,
  recurringSkipSchema,
  type ParsedRecurringInput,
  type Recurring,
  type RecurringDue,
} from '@budget/shared';
import type { Db } from '../db/index.ts';
import { accounts, categories, instruments, pies, recurring, recurringSkips, trades, transactions } from '../db/schema.ts';
import { HttpError, notFound } from '../http-error.ts';

export function listRecurring(db: Db): Recurring[] {
  return db.select().from(recurring).orderBy(recurring.day, recurring.id).all();
}

function getRecurring(db: Db, id: number): Recurring {
  const rule = db.select().from(recurring).where(eq(recurring.id, id)).get();
  if (!rule) throw notFound('Ο κανόνας επανάληψης');
  return rule;
}

/** Ελέγχει ότι υπάρχουν όσα αναφέρει ο κανόνας. Για pie, ο λογαριασμός είναι πάντα του pie. */
function toRow(db: Db, input: ParsedRecurringInput): ParsedRecurringInput {
  const account = (id: number) => db.select().from(accounts).where(eq(accounts.id, id)).get();
  const userAccount = (id: number | null) => {
    if (id == null) return;
    const a = account(id);
    if (!a || isDebtAccount(a)) throw new HttpError(400, 'Ο λογαριασμός δεν υπάρχει');
    return a;
  };
  const row = { ...input };
  if (input.kind === 'pie') {
    const pie = db.select().from(pies).where(eq(pies.id, input.pieId!)).get();
    if (!pie) throw new HttpError(400, 'Το pie δεν υπάρχει');
    row.accountId = pie.accountId;
  }
  const main = userAccount(row.accountId)!;
  if ((input.kind === 'buy' || input.kind === 'pie') && main.type !== 'broker') {
    throw new HttpError(400, 'Οι μετοχές μπαίνουν μόνο σε λογαριασμό broker');
  }
  if (input.kind === 'income' || input.kind === 'expense') {
    const category = db.select().from(categories).where(eq(categories.id, input.categoryId!)).get();
    if (!category || category.kind !== input.kind) throw new HttpError(400, 'Η κατηγορία δεν ταιριάζει');
  }
  if (input.kind === 'transfer') {
    userAccount(input.toAccountId);
    if (input.toAccountId === input.accountId) throw new HttpError(400, 'Η μεταφορά πρέπει να γίνει σε διαφορετικό λογαριασμό');
  }
  if (input.kind === 'buy' && !db.select().from(instruments).where(eq(instruments.id, input.instrumentId!)).get()) {
    throw new HttpError(400, 'Η μετοχή δεν υπάρχει');
  }
  if (input.kind === 'buy' || input.kind === 'pie') userAccount(input.fundingAccountId);

  // Κρατάμε μόνο τα πεδία που ισχύουν για το είδος
  const keep = <K extends keyof ParsedRecurringInput>(key: K, when: boolean) => {
    if (!when) (row[key] as unknown) = null;
  };
  keep('toAccountId', input.kind === 'transfer');
  keep('categoryId', input.kind === 'income' || input.kind === 'expense');
  keep('instrumentId', input.kind === 'buy');
  keep('pieId', input.kind === 'pie');
  keep('fundingAccountId', input.kind === 'buy' || input.kind === 'pie');
  keep('month', input.frequency === 'yearly');
  return row;
}

/** Οι λήξεις ενός μήνα που δεν έχουν καταχωριστεί ούτε προσπεραστεί. */
export function dueInMonth(db: Db, month: string): RecurringDue[] {
  const rules = listRecurring(db)
    .map(r => ({ recurring: r, dueDate: dueDateIn(r, month) }))
    .filter((d): d is RecurringDue => d.dueDate != null);
  if (rules.length === 0) return [];
  const ids = rules.map(r => r.recurring.id);
  const done = new Set<string>();
  for (const table of [transactions, trades]) {
    for (const row of db.select({ id: table.recurringId, due: table.recurringDue }).from(table)
      .where(and(inArray(table.recurringId, ids), isNotNull(table.recurringDue))).all()) {
      done.add(`${row.id}:${row.due}`);
    }
  }
  for (const s of db.select().from(recurringSkips).where(inArray(recurringSkips.recurringId, ids)).all()) {
    done.add(`${s.recurringId}:${s.dueDate}`);
  }
  return rules
    .filter(d => !done.has(`${d.recurring.id}:${d.dueDate}`))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.recurring.id - b.recurring.id);
}

export function recurringRoutes(app: FastifyInstance, db: Db) {
  app.get('/api/recurring', () => listRecurring(db));

  app.get('/api/recurring/due', req => {
    const { month } = monthQuerySchema.parse(req.query);
    return dueInMonth(db, month);
  });

  app.post('/api/recurring', (req, reply) => {
    const row = toRow(db, recurringInputSchema.parse(req.body));
    reply.code(201);
    return db.insert(recurring).values(row).returning().get();
  });

  app.put('/api/recurring/:id', req => {
    const { id } = idParamSchema.parse(req.params);
    const row = toRow(db, recurringInputSchema.parse(req.body));
    const updated = db.update(recurring).set(row).where(eq(recurring.id, id)).returning().get();
    if (!updated) throw notFound('Ο κανόνας επανάληψης');
    return updated;
  });

  // Οι καταχωρίσεις που έγιναν από τον κανόνα μένουν, απλώς δεν συνδέονται πια με αυτόν
  app.delete('/api/recurring/:id', (req, reply) => {
    const { id } = idParamSchema.parse(req.params);
    getRecurring(db, id);
    db.transaction(tx => {
      for (const table of [transactions, trades]) {
        tx.update(table).set({ recurringId: null, recurringDue: null }).where(eq(table.recurringId, id)).run();
      }
      tx.delete(recurringSkips).where(eq(recurringSkips.recurringId, id)).run();
      tx.delete(recurring).where(eq(recurring.id, id)).run();
    });
    return reply.code(204).send();
  });

  // «Όχι αυτόν τον μήνα»
  app.post('/api/recurring/:id/skip', (req, reply) => {
    const { id } = idParamSchema.parse(req.params);
    const { dueDate } = recurringSkipSchema.parse(req.body);
    getRecurring(db, id);
    db.insert(recurringSkips).values({ recurringId: id, dueDate }).onConflictDoNothing().run();
    return reply.code(204).send();
  });

  app.delete('/api/recurring/:id/skip/:dueDate', (req, reply) => {
    const { id } = idParamSchema.parse(req.params);
    const { dueDate } = recurringSkipSchema.parse({ dueDate: (req.params as { dueDate: string }).dueDate });
    db.delete(recurringSkips).where(and(eq(recurringSkips.recurringId, id), eq(recurringSkips.dueDate, dueDate))).run();
    return reply.code(204).send();
  });
}

/** Ελέγχει ότι ο κανόνας μιας καταχώρισης υπάρχει (αλλιώς η σύνδεση αγνοείται). */
export function recurringLink(db: Db, input: { recurringId: number | null; recurringDue: string | null }) {
  if (input.recurringId == null || input.recurringDue == null) return { recurringId: null, recurringDue: null };
  if (!db.select({ id: recurring.id }).from(recurring).where(eq(recurring.id, input.recurringId)).get()) {
    return { recurringId: null, recurringDue: null };
  }
  return { recurringId: input.recurringId, recurringDue: input.recurringDue };
}

/** Αν ένας λογαριασμός / κατηγορία / μετοχή χρησιμοποιείται από κανόνα επανάληψης (δεν σβήνεται τότε). */
export function usedByRecurring(db: Db, what: { accountId?: number; categoryId?: number; instrumentId?: number }) {
  const conditions = [];
  if (what.accountId != null) {
    conditions.push(eq(recurring.accountId, what.accountId), eq(recurring.toAccountId, what.accountId), eq(recurring.fundingAccountId, what.accountId));
  }
  if (what.categoryId != null) conditions.push(eq(recurring.categoryId, what.categoryId));
  if (what.instrumentId != null) conditions.push(eq(recurring.instrumentId, what.instrumentId));
  return !!db.select({ id: recurring.id }).from(recurring).where(or(...conditions)).limit(1).get();
}
