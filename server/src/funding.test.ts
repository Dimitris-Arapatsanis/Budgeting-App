import { beforeEach, describe, expect, it } from 'vitest';
import type { AccountWithBalance, Instrument, Pie, Trade, Transaction } from '@budget/shared';
import { buildApp } from './app.ts';
import { openDb } from './db/index.ts';
import { fakeMarket } from './market/fake-market.ts';

let app: ReturnType<typeof buildApp>;

async function api<T = unknown>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: object) {
  const res = await app.inject({ method, url, payload });
  return { status: res.statusCode, body: (res.body ? res.json() : undefined) as T };
}

beforeEach(() => {
  app = buildApp(openDb(':memory:', { seed: 'demo' }), { market: fakeMarket() });
});

async function fixtures() {
  const accounts = (await api<AccountWithBalance[]>('GET', '/api/accounts')).body;
  const instruments = (await api<Instrument[]>('GET', '/api/instruments')).body;
  return {
    piraeus: accounts.find(a => a.name === 'Τράπεζα Πειραιώς')!.id,
    revolut: accounts.find(a => a.name === 'Revolut')!.id,
    t212: accounts.find(a => a.name === 'Trading 212')!.id,
    vusa: instruments.find(i => i.ticker === 'VUSA.AS')!.id,
  };
}

const balances = async () =>
  Object.fromEntries((await api<AccountWithBalance[]>('GET', '/api/accounts')).body.map(a => [a.name, a.balance]));

describe('trade funding («Χρήματα από»)', () => {
  it('a buy funded from the bank creates the transfer, and deleting the buy removes it', async () => {
    const f = await fixtures();
    const { body: trade } = await api<Trade>('POST', '/api/trades', {
      date: '2026-10-10', accountId: f.revolut, instrumentId: f.vusa, side: 'buy', quantity: 1, amountEur: 10_000, fundingAccountId: f.piraeus,
    });
    expect(trade.fundingAccountId).toBe(f.piraeus);
    // Τα λεφτά έφυγαν από την Πειραιώς, το Revolut μένει στο 0
    expect(await balances()).toMatchObject({ 'Τράπεζα Πειραιώς': -10_000, Revolut: 0 });

    const [transfer] = (await api<Transaction[]>('GET', '/api/transactions?month=2026-10')).body;
    expect(transfer).toMatchObject({ type: 'transfer', amount: 10_000, accountId: f.piraeus, toAccountId: f.revolut, tradeFunding: true });
    expect((await api('DELETE', `/api/transactions/${transfer!.id}`)).status).toBe(409);

    await api('DELETE', `/api/trades/${trade.id}`);
    expect((await api<Transaction[]>('GET', '/api/transactions?month=2026-10')).body).toEqual([]);
    expect(await balances()).toMatchObject({ 'Τράπεζα Πειραιώς': 0, Revolut: 0 });
  });

  it('a pie buy makes one transfer for the total; removing one stock reduces it', async () => {
    const f = await fixtures();
    const [pie] = (await api<Pie[]>('GET', '/api/pies')).body;
    const { body: saved } = await api<Trade[]>('POST', '/api/trades/batch', {
      trades: pie!.slices.slice(0, 3).map(s => ({
        date: '2026-10-12', accountId: f.t212, instrumentId: s.instrumentId, side: 'buy', quantity: 0.1, amountEur: 2_000, pieId: pie!.id, fundingAccountId: f.piraeus,
      })),
    });
    const transfers = (await api<Transaction[]>('GET', '/api/transactions?month=2026-10')).body;
    expect(transfers).toHaveLength(1);
    expect(transfers[0]).toMatchObject({ amount: 6_000, description: 'Αγορά μετοχών' });

    await api('DELETE', `/api/trades/${saved[0]!.id}`);
    expect((await api<Transaction[]>('GET', '/api/transactions?month=2026-10')).body[0]!.amount).toBe(4_000);
    expect(await balances()).toMatchObject({ 'Τράπεζα Πειραιώς': -4_000, 'Trading 212': 0 });
  });

  it('editing a buy can add, change or remove its funding', async () => {
    const f = await fixtures();
    const base = { date: '2026-10-10', accountId: f.revolut, instrumentId: f.vusa, side: 'buy', quantity: 1, amountEur: 10_000 };
    // Παλιά αγορά χωρίς χρηματοδότηση: το Revolut πάει μείον
    const { body: trade } = await api<Trade>('POST', '/api/trades', base);
    expect(await balances()).toMatchObject({ Revolut: -10_000 });
    // Διόρθωση: «Χρήματα από» Πειραιώς
    expect((await api<Trade>('PUT', `/api/trades/${trade.id}`, { ...base, amountEur: 12_000, fundingAccountId: f.piraeus })).body.fundingAccountId).toBe(f.piraeus);
    expect(await balances()).toMatchObject({ 'Τράπεζα Πειραιώς': -12_000, Revolut: 0 });
    // Πίσω σε «υπόλοιπο του broker»
    await api('PUT', `/api/trades/${trade.id}`, { ...base, fundingAccountId: null });
    expect(await balances()).toMatchObject({ 'Τράπεζα Πειραιώς': 0, Revolut: -10_000 });
    expect((await api<Transaction[]>('GET', '/api/transactions?month=2026-10')).body).toEqual([]);
  });

  it('ignores funding for openings and rejects unknown accounts', async () => {
    const f = await fixtures();
    const opening = await api<Trade>('POST', '/api/trades', {
      date: '2026-10-10', accountId: f.revolut, instrumentId: f.vusa, side: 'opening', quantity: 1, amountEur: 10_000, fundingAccountId: f.piraeus,
    });
    expect(opening.body.fundingAccountId).toBeNull();
    expect(await balances()).toMatchObject({ 'Τράπεζα Πειραιώς': 0 });
    expect((await api('POST', '/api/trades', {
      date: '2026-10-10', accountId: f.revolut, instrumentId: f.vusa, side: 'buy', quantity: 1, amountEur: 100, fundingAccountId: 999,
    })).status).toBe(400);
  });

  it('keeps two pie buys of the same day apart (batchId), each with its own transfer', async () => {
    const f = await fixtures();
    const accounts = (await api<AccountWithBalance[]>('GET', '/api/accounts')).body;
    const alpha = accounts.find(a => a.name === 'Alpha Bank')!.id;
    const [pie] = (await api<Pie[]>('GET', '/api/pies')).body;
    const buy = (amountEur: number, fundingAccountId: number | null) => api<Trade[]>('POST', '/api/trades/batch', {
      trades: pie!.slices.slice(0, 2).map(s => ({
        date: '2026-10-30', accountId: f.t212, instrumentId: s.instrumentId, side: 'buy', quantity: 0.01, amountEur, pieId: pie!.id, fundingAccountId,
      })),
    });
    const a = (await buy(1_250, alpha)).body;
    const b = (await buy(2_400, f.piraeus)).body;
    const c = (await buy(500, null)).body;
    const d = (await buy(500, null)).body;
    for (const batch of [a, b, c, d]) {
      expect(new Set(batch.map(t => t.batchId)).size).toBe(1);
      expect(batch[0]!.batchId).toBe(batch[0]!.id);
    }
    expect(new Set([a, b, c, d].map(x => x[0]!.batchId)).size).toBe(4);
    expect(a[0]!.fundingAccountId).toBe(alpha);
    expect(b[0]!.fundingAccountId).toBe(f.piraeus);
    const transfers = (await api<Transaction[]>('GET', '/api/transactions?month=2026-10')).body;
    expect(transfers.map(t => [t.accountId, t.amount]).sort()).toEqual([[f.piraeus, 4_800], [alpha, 2_500]].sort());
  });
});
