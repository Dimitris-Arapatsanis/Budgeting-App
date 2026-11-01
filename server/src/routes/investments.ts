import { desc, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  computeHoldings,
  idParamSchema,
  instrumentInputSchema,
  isDebtAccount,
  lastDayOfMonth,
  monthQuerySchema,
  normalizeCurrency,
  pieInputSchema,
  piePreviewSchema,
  quantityFor,
  searchQuerySchema,
  shiftMonth,
  splitPieAmount,
  today,
  tradeBatchSchema,
  tradeInputSchema,
  valueCents,
  type Instrument,
  type InvestmentMonth,
  type ParsedTradeInput,
  type Pie,
  type PiePreviewLine,
  type Portfolio,
  type Position,
  type Trade,
} from '@budget/shared';
import type { Db } from '../db/index.ts';
import { accounts, instruments, pieSlices, pies, recurring, trades, transactions } from '../db/schema.ts';
import { HttpError, notFound } from '../http-error.ts';
import type { MarketData } from '../market/market-data.ts';
import type { Prices } from '../market/prices.ts';
import { openingsValue, valueAt } from '../market/valuation.ts';
import { recurringLink, usedByRecurring } from './recurring.ts';

const TRADE_COLUMNS = {
  id: trades.id,
  date: trades.date,
  accountId: trades.accountId,
  instrumentId: trades.instrumentId,
  side: trades.side,
  quantity: trades.quantity,
  amountEur: trades.amountEur,
  pieId: trades.pieId,
  fundingAccountId: transactions.accountId,
  fundingTransactionId: trades.fundingTransactionId,
  batchId: trades.batchId,
  recurringId: trades.recurringId,
  recurringDue: trades.recurringDue,
};

const selectTrades = (db: Db) =>
  db.select(TRADE_COLUMNS).from(trades).leftJoin(transactions, eq(trades.fundingTransactionId, transactions.id));

export function listTrades(db: Db): Trade[] {
  return selectTrades(db).orderBy(desc(trades.date), desc(trades.id)).all();
}

function getTrade(db: Db, id: number): Trade {
  const trade = selectTrades(db).where(eq(trades.id, id)).get();
  if (!trade) throw notFound('Η κίνηση');
  return trade;
}

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * Μεταφορές που χρηματοδοτούν αγορές («Χρήματα από»): μία ανά (λογαριασμό, broker, ημερομηνία),
 * ώστε μια αγορά στο pie να γίνεται μία μεταφορά και όχι μία ανά μετοχή.
 */
function fundTrades(tx: Tx, items: Array<{ id: number; input: ParsedTradeInput }>) {
  const groups = new Map<string, Array<{ id: number; input: ParsedTradeInput }>>();
  for (const item of items) {
    const { fundingAccountId, accountId, date } = item.input;
    if (fundingAccountId == null) continue;
    const key = `${fundingAccountId}:${accountId}:${date}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  for (const group of groups.values()) {
    const first = group[0]!.input;
    const instrument = tx.select().from(instruments).where(eq(instruments.id, first.instrumentId)).get();
    const transfer = tx.insert(transactions).values({
      date: first.date,
      type: 'transfer',
      amount: group.reduce((sum, g) => sum + g.input.amountEur, 0),
      accountId: first.fundingAccountId!,
      toAccountId: first.accountId,
      description: group.length > 1 ? 'Αγορά μετοχών' : `Αγορά ${instrument?.name ?? 'μετοχής'}`,
    }).returning().get();
    tx.update(trades).set({ fundingTransactionId: transfer.id }).where(inArray(trades.id, group.map(g => g.id))).run();
  }
}

/** Αφαιρεί το μερίδιο μιας αγοράς από τη μεταφορά που τη χρηματοδότησε. Αν δεν μείνει τίποτα, τη σβήνει. */
function releaseFunding(tx: Tx, fundingTransactionId: number | null, amountEur: number) {
  if (fundingTransactionId == null) return;
  const transfer = tx.select().from(transactions).where(eq(transactions.id, fundingTransactionId)).get();
  if (!transfer) return;
  if (transfer.amount > amountEur) {
    tx.update(transactions).set({ amount: transfer.amount - amountEur }).where(eq(transactions.id, transfer.id)).run();
  } else {
    tx.delete(transactions).where(eq(transactions.id, transfer.id)).run();
  }
}

function insertTrades(db: Db, inputs: ParsedTradeInput[]): Trade[] {
  const ids = db.transaction(tx => {
    const items = inputs.map(({ fundingAccountId: _, ...row }, i) => ({
      id: tx.insert(trades).values(row).returning({ id: trades.id }).get().id,
      input: inputs[i]!,
    }));
    // Μια αγορά με πολλές μετοχές (pie) = ένα batch, για να φαίνεται ως μία γραμμή
    if (items.length > 1) tx.update(trades).set({ batchId: items[0]!.id }).where(inArray(trades.id, items.map(i => i.id))).run();
    fundTrades(tx, items);
    return items.map(item => item.id);
  });
  return ids.map(id => getTrade(db, id));
}

function listPies(db: Db): Pie[] {
  const slices = db.select().from(pieSlices).all();
  return db.select().from(pies).orderBy(pies.id).all().map(p => ({
    ...p,
    slices: slices
      .filter(s => s.pieId === p.id)
      .map(({ instrumentId, targetPercent }) => ({ instrumentId, targetPercent }))
      .sort((a, b) => b.targetPercent - a.targetPercent),
  }));
}

function getPie(db: Db, id: number): Pie {
  const pie = listPies(db).find(p => p.id === id);
  if (!pie) throw notFound('Το pie');
  return pie;
}

function checkBroker(db: Db, accountId: number) {
  const account = db.select().from(accounts).where(eq(accounts.id, accountId)).get();
  if (!account) throw new HttpError(400, 'Ο λογαριασμός δεν υπάρχει');
  if (account.type !== 'broker') throw new HttpError(400, 'Οι μετοχές μπαίνουν μόνο σε λογαριασμό broker');
}

function checkInstrument(db: Db, instrumentId: number) {
  if (!db.select().from(instruments).where(eq(instruments.id, instrumentId)).get()) {
    throw new HttpError(400, 'Η μετοχή δεν υπάρχει');
  }
}

function toTradeRow(db: Db, input: ParsedTradeInput): ParsedTradeInput {
  checkBroker(db, input.accountId);
  checkInstrument(db, input.instrumentId);
  if (input.pieId != null && !db.select().from(pies).where(eq(pies.id, input.pieId)).get()) {
    throw new HttpError(400, 'Το pie δεν υπάρχει');
  }
  // Χρηματοδότηση μόνο για αγορές από άλλον λογαριασμό. Από τον ίδιο broker = από τα μετρητά του.
  const funding = input.side === 'buy' && input.fundingAccountId !== input.accountId ? input.fundingAccountId : null;
  if (funding != null) {
    const account = db.select().from(accounts).where(eq(accounts.id, funding)).get();
    if (!account || isDebtAccount(account)) throw new HttpError(400, 'Ο λογαριασμός «Χρήματα από» δεν υπάρχει');
  }
  return { ...input, fundingAccountId: funding, ...recurringLink(db, input) };
}

export function investmentRoutes(app: FastifyInstance, db: Db, market: MarketData, prices: Prices) {
  // ---------- Μετοχές ----------

  app.get('/api/instruments', () => db.select().from(instruments).orderBy(instruments.name).all());

  app.get('/api/instruments/search', async req => {
    const { q } = searchQuerySchema.parse(req.query);
    try {
      return await market.search(q);
    } catch {
      throw new HttpError(502, 'Η αναζήτηση στο Yahoo Finance απέτυχε. Δοκίμασε ξανά.');
    }
  });

  app.post('/api/instruments', async (req, reply) => {
    const { ticker } = instrumentInputSchema.parse(req.body);
    if (db.select().from(instruments).where(eq(instruments.ticker, ticker)).get()) {
      throw new HttpError(409, `Η μετοχή ${ticker} υπάρχει ήδη`);
    }
    let quote;
    try {
      [quote] = await market.quotes([ticker]);
    } catch {
      throw new HttpError(502, 'Το Yahoo Finance δεν απάντησε. Δοκίμασε ξανά.');
    }
    if (!quote) throw new HttpError(400, `Δεν βρέθηκε τιμή για το ${ticker}`);
    reply.code(201);
    return db.insert(instruments)
      .values({ ticker, name: quote.name, currency: normalizeCurrency(quote.currency).currency })
      .returning().get();
  });

  app.delete('/api/instruments/:id', (req, reply) => {
    const { id } = idParamSchema.parse(req.params);
    if (db.select({ id: trades.id }).from(trades).where(eq(trades.instrumentId, id)).limit(1).get()) {
      throw new HttpError(409, 'Η μετοχή έχει κινήσεις και δεν μπορεί να διαγραφεί');
    }
    if (usedByRecurring(db, { instrumentId: id })) {
      throw new HttpError(409, 'Η μετοχή χρησιμοποιείται σε επαναλαμβανόμενη αγορά');
    }
    if (db.select().from(pieSlices).where(eq(pieSlices.instrumentId, id)).limit(1).get()) {
      throw new HttpError(409, 'Η μετοχή είναι σε pie. Βγάλε την πρώτα από το pie.');
    }
    const row = db.delete(instruments).where(eq(instruments.id, id)).returning().get();
    if (!row) throw notFound('Η μετοχή');
    return reply.code(204).send();
  });

  // ---------- Κινήσεις ----------

  app.get('/api/trades', () => listTrades(db));

  app.post('/api/trades', (req, reply) => {
    const input = toTradeRow(db, tradeInputSchema.parse(req.body));
    reply.code(201);
    return insertTrades(db, [input])[0];
  });

  // Πολλές κινήσεις μαζί (αγορά στο pie): όλες ή καμία
  app.post('/api/trades/batch', (req, reply) => {
    const { trades: inputs } = tradeBatchSchema.parse(req.body);
    const rows = inputs.map(t => toTradeRow(db, t));
    reply.code(201);
    return insertTrades(db, rows);
  });

  // Η χρηματοδότηση ξαναγίνεται από την αρχή: η παλιά μεταφορά μειώνεται (ή σβήνεται) και, αν χρειάζεται, γίνεται νέα
  app.put('/api/trades/:id', req => {
    const { id } = idParamSchema.parse(req.params);
    const input = toTradeRow(db, tradeInputSchema.parse(req.body));
    db.transaction(tx => {
      const old = tx.select().from(trades).where(eq(trades.id, id)).get();
      if (!old) throw notFound('Η κίνηση');
      const { fundingAccountId: _, ...row } = input;
      tx.update(trades).set({ ...row, fundingTransactionId: null }).where(eq(trades.id, id)).run();
      releaseFunding(tx, old.fundingTransactionId, old.amountEur);
      fundTrades(tx, [{ id, input }]);
    });
    return getTrade(db, id);
  });

  app.delete('/api/trades/:id', (req, reply) => {
    const { id } = idParamSchema.parse(req.params);
    db.transaction(tx => {
      const old = tx.delete(trades).where(eq(trades.id, id)).returning().get();
      if (!old) throw notFound('Η κίνηση');
      releaseFunding(tx, old.fundingTransactionId, old.amountEur);
    });
    return reply.code(204).send();
  });

  // ---------- Pies ----------

  app.get('/api/pies', () => listPies(db));

  const savePie = (id: number | undefined, body: unknown) => {
    const input = pieInputSchema.parse(body);
    checkBroker(db, input.accountId);
    input.slices.forEach(s => checkInstrument(db, s.instrumentId));
    return db.transaction(tx => {
      const pieId = id == null
        ? tx.insert(pies).values({ name: input.name, accountId: input.accountId }).returning().get().id
        : tx.update(pies).set({ name: input.name, accountId: input.accountId }).where(eq(pies.id, id)).returning().get()?.id;
      if (pieId == null) throw notFound('Το pie');
      tx.delete(pieSlices).where(eq(pieSlices.pieId, pieId)).run();
      tx.insert(pieSlices).values(input.slices.map(s => ({ ...s, pieId }))).run();
      return pieId;
    });
  };

  app.post('/api/pies', (req, reply) => {
    const id = savePie(undefined, req.body);
    reply.code(201);
    return getPie(db, id);
  });

  app.put('/api/pies/:id', req => {
    const { id } = idParamSchema.parse(req.params);
    return getPie(db, savePie(id, req.body));
  });

  // Διαγραφή pie: μόνο χωρίς κινήσεις ή επαναλαμβανόμενες αγορές (οι μετοχές του μένουν)
  app.delete('/api/pies/:id', (req, reply) => {
    const { id } = idParamSchema.parse(req.params);
    getPie(db, id);
    if (db.select({ id: trades.id }).from(trades).where(eq(trades.pieId, id)).limit(1).get()) {
      throw new HttpError(409, 'Το pie έχει κινήσεις και δεν μπορεί να διαγραφεί');
    }
    if (db.select({ id: recurring.id }).from(recurring).where(eq(recurring.pieId, id)).limit(1).get()) {
      throw new HttpError(409, 'Το pie χρησιμοποιείται σε επαναλαμβανόμενη αγορά');
    }
    db.delete(pies).where(eq(pies.id, id)).run();
    return reply.code(204).send();
  });

  // Πρόταση για αγορά στο pie: μοίρασμα του ποσού και ποσότητες με την τιμή της ημέρας. Δεν αποθηκεύει τίποτα.
  app.post('/api/pies/:id/preview', async req => {
    const { id } = idParamSchema.parse(req.params);
    const { amountEur, date } = piePreviewSchema.parse(req.body);
    const pie = getPie(db, id);
    const byId = new Map(db.select().from(instruments).all().map(i => [i.id, i]));
    const amounts = splitPieAmount(amountEur, pie.slices);
    return Promise.all(pie.slices.map(async (s, i): Promise<PiePreviewLine> => {
      const price = await prices.priceOn(byId.get(s.instrumentId)!, date);
      const amount = amounts[i]!;
      return { ...s, amountEur: amount, price, quantity: price ? quantityFor(amount, price.priceEur) : null };
    }));
  });

  // ---------- Portfolio ----------

  app.get('/api/portfolio', async (): Promise<Portfolio> => {
    const holdings = computeHoldings(listTrades(db));
    const all: Instrument[] = db.select().from(instruments).all();
    const held = all.filter(i => holdings.some(h => h.instrumentId === i.id));
    const { prices: live, stale } = await prices.latest(held);

    const positions: Position[] = holdings.map(h => {
      const price = live.get(h.instrumentId) ?? null;
      return {
        ...h,
        price,
        valueEur: price ? valueCents(h.quantity, price.priceEur) : null,
        dayChangeEur: price ? valueCents(h.quantity, price.changeEur) : 0,
      };
    });
    const sum = (f: (p: Position) => number) => positions.reduce((acc, p) => acc + f(p), 0);

    const pieDrift = listPies(db).map(pie => {
      const values = pie.slices.map(s => positions
        .filter(p => p.accountId === pie.accountId && p.instrumentId === s.instrumentId)
        .reduce((acc, p) => acc + (p.valueEur ?? 0), 0));
      const total = values.reduce((a, b) => a + b, 0);
      return {
        pieId: pie.id,
        valueEur: total,
        slices: pie.slices.map((s, i) => ({
          ...s,
          valueEur: values[i]!,
          actualPercent: total > 0 ? (values[i]! / total) * 100 : 0,
        })),
      };
    });

    return {
      positions,
      // Χωρίς τιμή, η θέση μετράει με το κόστος της, για να μη «χάνεται» από το σύνολο
      valueEur: sum(p => p.valueEur ?? p.costEur),
      costEur: sum(p => p.costEur),
      dayChangeEur: sum(p => p.dayChangeEur),
      stale: stale || positions.some(p => !p.price),
      pies: pieDrift,
    };
  });

  app.get('/api/portfolio/month', async (req): Promise<InvestmentMonth> => {
    const { month } = monthQuerySchema.parse(req.query);
    const allTrades = listTrades(db);
    const monthTrades = allTrades.filter(t => t.date.startsWith(month));
    const total = (side: Trade['side']) => monthTrades.filter(t => t.side === side).reduce((acc, t) => acc + t.amountEur, 0);
    const bought = total('buy');
    const sold = total('sell');
    const opened = total('opening');

    const startDate = lastDayOfMonth(shiftMonth(month, -1));
    const endDate = lastDayOfMonth(month) < today() ? lastDayOfMonth(month) : today();
    if (startDate >= today()) {
      return { month, bought, sold, opened, valueStart: 0, valueEnd: 0, marketChange: 0, incomplete: false };
    }
    const [start, end, openedValue] = await Promise.all([
      valueAt(db, prices, allTrades, startDate),
      valueAt(db, prices, allTrades, endDate),
      openingsValue(db, prices, monthTrades.filter(t => t.side === 'opening')),
    ]);
    return {
      month,
      bought,
      sold,
      opened,
      valueStart: start.value,
      valueEnd: end.value,
      marketChange: end.value - start.value - (bought - sold + openedValue.value),
      incomplete: start.incomplete || end.incomplete || openedValue.incomplete,
    };
  });
}
