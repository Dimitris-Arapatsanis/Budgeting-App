import { beforeEach, describe, expect, it } from 'vitest';
import type { AccountWithBalance, Instrument, InvestmentMonth, MonthSummary, Pie, PiePreviewLine, Portfolio, Trade } from '@budget/shared';
import { buildApp } from './app.ts';
import { openDb } from './db/index.ts';
import { fakeMarket } from './market/fake-market.ts';

let app: ReturnType<typeof buildApp>;
let market: ReturnType<typeof fakeMarket>;
let offline = false;

async function api<T = unknown>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: object) {
  const res = await app.inject({ method, url, payload });
  return { status: res.statusCode, body: (res.body ? res.json() : undefined) as T };
}

let db: ReturnType<typeof openDb>;

beforeEach(() => {
  offline = false;
  market = fakeMarket({ failing: () => offline });
  db = openDb(':memory:', { seed: 'demo' });
  app = buildApp(db, { market });
});

async function fixtures() {
  const accounts = (await api<AccountWithBalance[]>('GET', '/api/accounts')).body;
  const instruments = (await api<Instrument[]>('GET', '/api/instruments')).body;
  const account = (name: string) => accounts.find(a => a.name === name)!.id;
  const instrument = (ticker: string) => instruments.find(i => i.ticker === ticker)!.id;
  return {
    piraeus: account('Τράπεζα Πειραιώς'),
    revolut: account('Revolut'),
    t212: account('Trading 212'),
    vusa: instrument('VUSA.AS'),
    msft: instrument('MSFT'),
  };
}

const balanceOf = async (id: number) =>
  (await api<AccountWithBalance[]>('GET', '/api/accounts')).body.find(a => a.id === id)!.balance;

describe('seed', () => {
  it('creates VUSA and the Trading 212 pie', async () => {
    const f = await fixtures();
    const instruments = (await api<Instrument[]>('GET', '/api/instruments')).body;
    expect(instruments.find(i => i.ticker === 'VUSA.AS')).toMatchObject({ currency: 'EUR' });
    const [pie] = (await api<Pie[]>('GET', '/api/pies')).body;
    expect(pie!.accountId).toBe(f.t212);
    expect(pie!.slices).toHaveLength(9);
    expect(pie!.slices.reduce((s, x) => s + x.targetPercent, 0)).toBe(100);
    expect(pie!.slices[0]!.targetPercent).toBe(15);
  });
});

describe('trades', () => {
  it('buys reduce broker cash, openings do not, and the month counts buys as invested', async () => {
    const f = await fixtures();
    await api('POST', '/api/trades', { date: '2026-01-01', accountId: f.revolut, instrumentId: f.vusa, side: 'opening', quantity: 10, amountEur: 80_000 });
    const buy = await api<Trade>('POST', '/api/trades', { date: '2026-08-10', accountId: f.revolut, instrumentId: f.vusa, side: 'buy', quantity: 1.5, amountEur: 13_000 });
    expect(buy.status).toBe(201);
    expect(buy.body).toMatchObject({ side: 'buy', quantity: 1.5, pieId: null });
    expect(await balanceOf(f.revolut)).toBe(-13_000);

    const summary = (await api<MonthSummary>('GET', '/api/summary?month=2026-08')).body;
    expect(summary).toMatchObject({ invested: 13_000 });

    await api('DELETE', `/api/trades/${buy.body.id}`);
    expect(await balanceOf(f.revolut)).toBe(0);
  });

  it('validates account type, instrument and quantity', async () => {
    const f = await fixtures();
    const base = { date: '2026-08-10', accountId: f.revolut, instrumentId: f.vusa, side: 'buy', quantity: 1, amountEur: 100 };
    expect((await api('POST', '/api/trades', { ...base, accountId: f.piraeus })).status).toBe(400);
    expect((await api('POST', '/api/trades', { ...base, instrumentId: 999 })).status).toBe(400);
    expect((await api('POST', '/api/trades', { ...base, quantity: 0 })).status).toBe(400);
    expect((await api('POST', '/api/trades/batch', { trades: [base, { ...base, accountId: f.piraeus }] })).status).toBe(400);
    expect((await api<Trade[]>('GET', '/api/trades')).body).toHaveLength(0);
  });

  it('blocks deleting accounts and instruments that have trades', async () => {
    const f = await fixtures();
    await api('POST', '/api/trades', { date: '2026-08-10', accountId: f.revolut, instrumentId: f.vusa, side: 'buy', quantity: 1, amountEur: 100 });
    expect((await api('DELETE', `/api/accounts/${f.revolut}`)).status).toBe(409);
    expect((await api('DELETE', `/api/instruments/${f.vusa}`)).status).toBe(409);
    // Σε pie
    expect((await api('DELETE', `/api/instruments/${f.msft}`)).status).toBe(409);
  });
});

describe('instruments', () => {
  it('adds an instrument from Yahoo with normalized currency', async () => {
    const search = await api<Array<{ ticker: string }>>('GET', '/api/instruments/search?q=barc');
    expect(search.body[0]!.ticker).toBe('BARC.L');
    const added = await api<Instrument>('POST', '/api/instruments', { ticker: 'barc.l' });
    expect(added.status).toBe(201);
    expect(added.body).toMatchObject({ ticker: 'BARC.L', name: 'Barclays PLC', currency: 'GBP' });
    expect((await api('POST', '/api/instruments', { ticker: 'BARC.L' })).status).toBe(409);
    expect((await api('POST', '/api/instruments', { ticker: 'NOPE' })).status).toBe(400);
    expect((await api('DELETE', `/api/instruments/${added.body.id}`)).status).toBe(204);
  });
});

describe('pies', () => {
  it('previews a pie buy with today\'s prices and saves it as a batch', async () => {
    const f = await fixtures();
    const [pie] = (await api<Pie[]>('GET', '/api/pies')).body;
    const today = new Date().toISOString().slice(0, 10);
    const preview = (await api<PiePreviewLine[]>('POST', `/api/pies/${pie!.id}/preview`, { amountEur: 10_000, date: today })).body;
    expect(preview.reduce((s, l) => s + l.amountEur, 0)).toBe(10_000);
    const msft = preview.find(l => l.instrumentId === f.msft)!;
    // 15 € σε 220 $ με EURUSD 1,1 → 200 €/μετοχή → 0,075
    expect(msft).toMatchObject({ amountEur: 1_500, quantity: 0.075, price: { price: 220, currency: 'USD', fxRate: 1.1, priceEur: expect.closeTo(200, 6) } });

    const saved = await api<Trade[]>('POST', '/api/trades/batch', {
      trades: preview.map(l => ({ date: today, accountId: pie!.accountId, instrumentId: l.instrumentId, side: 'buy', quantity: l.quantity, amountEur: l.amountEur, pieId: pie!.id })),
    });
    expect(saved.status).toBe(201);
    expect(saved.body).toHaveLength(9);
    expect(await balanceOf(f.t212)).toBe(-10_000);

    const portfolio = (await api<Portfolio>('GET', '/api/portfolio')).body;
    const drift = portfolio.pies[0]!;
    expect(drift.slices.find(s => s.instrumentId === f.msft)!.actualPercent).toBeCloseTo(15, 0);
  });

  it('validates that slices sum to 100%', async () => {
    const f = await fixtures();
    const [pie] = (await api<Pie[]>('GET', '/api/pies')).body;
    const bad = await api<{ error: string }>('PUT', `/api/pies/${pie!.id}`, { name: 'Pie', accountId: f.t212, slices: [{ instrumentId: f.msft, targetPercent: 90 }] });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe('Τα ποσοστά πρέπει να κάνουν 100%');
    const ok = await api<Pie>('PUT', `/api/pies/${pie!.id}`, { name: 'Tech', accountId: f.t212, slices: [{ instrumentId: f.msft, targetPercent: 60 }, { instrumentId: f.vusa, targetPercent: 40 }] });
    expect(ok.body).toMatchObject({ name: 'Tech', slices: [{ instrumentId: f.msft, targetPercent: 60 }, { instrumentId: f.vusa, targetPercent: 40 }] });
  });
});

describe('portfolio', () => {
  it('values positions in EUR with average cost and day change', async () => {
    const f = await fixtures();
    await api('POST', '/api/trades', { date: '2026-01-01', accountId: f.revolut, instrumentId: f.vusa, side: 'opening', quantity: 10, amountEur: 80_000 });
    await api('POST', '/api/trades', { date: '2026-08-10', accountId: f.t212, instrumentId: f.msft, side: 'buy', quantity: 2, amountEur: 38_000 });

    const p = (await api<Portfolio>('GET', '/api/portfolio')).body;
    // VUSA 10 × 100 € = 1.000 €, MSFT 2 × 220 $ / 1,1 = 400 €
    expect(p).toMatchObject({ valueEur: 140_000, costEur: 118_000, stale: false });
    // VUSA +1 €/μετοχή, MSFT +2,2 $ = +2 €/μετοχή
    expect(p.dayChangeEur).toBe(1_400);
    expect(p.positions.find(x => x.instrumentId === f.msft)).toMatchObject({ quantity: 2, valueEur: 40_000 });
  });

  it('falls back to the last known price when Yahoo is offline', async () => {
    const f = await fixtures();
    await api('POST', '/api/trades', { date: '2026-08-10', accountId: f.revolut, instrumentId: f.vusa, side: 'buy', quantity: 2, amountEur: 17_000 });
    expect((await api<Portfolio>('GET', '/api/portfolio')).body).toMatchObject({ valueEur: 20_000, stale: false });

    // Επανεκκίνηση του server (άδεια cache μνήμης) ενώ το Yahoo δεν απαντάει: τιμή από τη βάση
    app = buildApp(db, { market: fakeMarket({ failing: () => true }) });
    const p = (await api<Portfolio>('GET', '/api/portfolio')).body;
    expect(p).toMatchObject({ valueEur: 20_000, dayChangeEur: 0, stale: true });
  });

  it('computes the market change of a past month from historical closes', async () => {
    const f = await fixtures();
    await api('POST', '/api/trades', { date: '2026-01-01', accountId: f.revolut, instrumentId: f.vusa, side: 'opening', quantity: 10, amountEur: 70_000 });
    await api('POST', '/api/trades', { date: '2026-08-10', accountId: f.revolut, instrumentId: f.vusa, side: 'buy', quantity: 1, amountEur: 8_500 });
    await api('POST', '/api/trades', { date: '2026-08-10', accountId: f.t212, instrumentId: f.msft, side: 'buy', quantity: 1.1, amountEur: 20_000 });

    const m = (await api<InvestmentMonth>('GET', '/api/portfolio/month?month=2026-08')).body;
    // Αρχή: 10 VUSA × 80 = 800 €. Τέλος: 11 × 90 = 990 € + 1,1 MSFT × 210 $ / 1,05 = 220 € → 1.210 €
    expect(m).toMatchObject({ bought: 28_500, opened: 0, valueStart: 80_000, valueEnd: 121_000, incomplete: false });
    expect(m.marketChange).toBe(121_000 - 80_000 - 28_500);

    // Δεύτερη φορά από την cache της βάσης, χωρίς νέες κλήσεις
    const before = market.calls.length;
    await api('GET', '/api/portfolio/month?month=2026-08');
    expect(market.calls.length).toBe(before);
  });

  it('values openings at the market price of their date, not at their old cost', async () => {
    const f = await fixtures();
    await api('POST', '/api/trades', { date: '2026-08-15', accountId: f.revolut, instrumentId: f.vusa, side: 'opening', quantity: 10, amountEur: 50_000 });
    const m = (await api<InvestmentMonth>('GET', '/api/portfolio/month?month=2026-08')).body;
    // Μπήκαν 10 × 85 € (κλείσιμο 14/8) = 850 €, τέλος μήνα 10 × 90 € = 900 € → +50 €, όχι +400 €
    expect(m).toMatchObject({ opened: 50_000, valueStart: 0, valueEnd: 90_000, marketChange: 5_000, incomplete: false });
  });
});

describe('pie create and delete', () => {
  it('creates a pie on another broker and deletes it only without trades', async () => {
    const f = await fixtures();
    const created = await api<Pie>('POST', '/api/pies', { name: 'Δεύτερο', accountId: f.revolut, slices: [{ instrumentId: f.msft, targetPercent: 100 }] });
    expect(created.status).toBe(201);
    expect((await api<Pie[]>('GET', '/api/pies')).body).toHaveLength(2);
    await api('POST', '/api/trades', { date: '2026-10-10', accountId: f.revolut, instrumentId: f.msft, side: 'buy', quantity: 0.1, amountEur: 2_000, pieId: created.body.id });
    expect((await api('DELETE', `/api/pies/${created.body.id}`)).status).toBe(409);
    // Broker με pie: δεν σβήνεται
    expect((await api('DELETE', `/api/accounts/${f.t212}`)).status).toBe(409);
    const [trade] = (await api<Trade[]>('GET', '/api/trades')).body;
    await api('DELETE', `/api/trades/${trade!.id}`);
    expect((await api('DELETE', `/api/pies/${created.body.id}`)).status).toBe(204);
    expect((await api<Pie[]>('GET', '/api/pies')).body).toHaveLength(1);
  });
});
