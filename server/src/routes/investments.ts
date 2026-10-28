import { desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  computeHoldings,
  idParamSchema,
  instrumentInputSchema,
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
import { accounts, instruments, pieSlices, pies, trades } from '../db/schema.ts';
import { HttpError, notFound } from '../http-error.ts';
import type { MarketData } from '../market/market-data.ts';
import type { Prices } from '../market/prices.ts';

const TRADE_COLUMNS = {
  id: trades.id,
  date: trades.date,
  accountId: trades.accountId,
  instrumentId: trades.instrumentId,
  side: trades.side,
  quantity: trades.quantity,
  amountEur: trades.amountEur,
  pieId: trades.pieId,
};

export function listTrades(db: Db): Trade[] {
  return db.select(TRADE_COLUMNS).from(trades).orderBy(desc(trades.date), desc(trades.id)).all();
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

function toTradeRow(db: Db, input: ParsedTradeInput) {
  checkBroker(db, input.accountId);
  checkInstrument(db, input.instrumentId);
  if (input.pieId != null && !db.select().from(pies).where(eq(pies.id, input.pieId)).get()) {
    throw new HttpError(400, 'Το pie δεν υπάρχει');
  }
  return input;
}

/** Αξία όλων των θέσεων σε μια ημερομηνία (cents), με τις τιμές κλεισίματος εκείνης της μέρας. */
async function valueAt(db: Db, prices: Prices, allTrades: Trade[], date: string) {
  const holdings = computeHoldings(allTrades, date);
  if (holdings.length === 0) return { value: 0, incomplete: false };
  const byId = new Map(db.select().from(instruments).all().map(i => [i.id, i]));
  const points = await Promise.all(holdings.map(h => prices.priceOn(byId.get(h.instrumentId)!, date)));
  let value = 0;
  let incomplete = false;
  holdings.forEach((h, i) => {
    const p = points[i];
    if (p) value += valueCents(h.quantity, p.priceEur);
    else incomplete = true;
  });
  return { value, incomplete };
}

/**
 * Αξία των αρχικών θέσεων την ημέρα που μπήκαν. Μετράει σαν «εισροή» στη μεταβολή αξίας του μήνα:
 * οι μετοχές υπήρχαν ήδη, οπότε δεν πρέπει να φανούν ως κέρδος (ούτε το κόστος τους, που είναι παλιό).
 */
async function openingsValue(db: Db, prices: Prices, openings: Trade[]) {
  const byId = new Map(db.select().from(instruments).all().map(i => [i.id, i]));
  const points = await Promise.all(openings.map(t => prices.priceOn(byId.get(t.instrumentId)!, t.date)));
  let value = 0;
  let incomplete = false;
  openings.forEach((t, i) => {
    const p = points[i];
    if (p) value += valueCents(t.quantity, p.priceEur);
    else {
      value += t.amountEur;
      incomplete = true;
    }
  });
  return { value, incomplete };
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
    const row = toTradeRow(db, tradeInputSchema.parse(req.body));
    reply.code(201);
    return db.insert(trades).values(row).returning(TRADE_COLUMNS).get();
  });

  // Πολλές κινήσεις μαζί (αγορά στο pie): όλες ή καμία
  app.post('/api/trades/batch', (req, reply) => {
    const { trades: inputs } = tradeBatchSchema.parse(req.body);
    const rows = inputs.map(t => toTradeRow(db, t));
    reply.code(201);
    return db.transaction(tx => rows.map(r => tx.insert(trades).values(r).returning(TRADE_COLUMNS).get()));
  });

  app.put('/api/trades/:id', req => {
    const { id } = idParamSchema.parse(req.params);
    const row = toTradeRow(db, tradeInputSchema.parse(req.body));
    const updated = db.update(trades).set(row).where(eq(trades.id, id)).returning(TRADE_COLUMNS).get();
    if (!updated) throw notFound('Η κίνηση');
    return updated;
  });

  app.delete('/api/trades/:id', (req, reply) => {
    const { id } = idParamSchema.parse(req.params);
    const row = db.delete(trades).where(eq(trades.id, id)).returning().get();
    if (!row) throw notFound('Η κίνηση');
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
