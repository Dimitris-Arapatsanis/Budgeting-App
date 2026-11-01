import { beforeEach, describe, expect, it } from 'vitest';
import type { AccountWithBalance, Category, Instrument, Pie, Recurring, RecurringDue, Trade, Transaction } from '@budget/shared';
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
  const categories = (await api<Category[]>('GET', '/api/categories')).body;
  const instruments = (await api<Instrument[]>('GET', '/api/instruments')).body;
  const [pie] = (await api<Pie[]>('GET', '/api/pies')).body;
  return {
    piraeus: accounts.find(a => a.name === 'Τράπεζα Πειραιώς')!.id,
    revolut: accounts.find(a => a.name === 'Revolut')!.id,
    t212: accounts.find(a => a.name === 'Trading 212')!.id,
    salary: categories.find(c => c.name === 'Μισθός')!.id,
    subscriptions: categories.find(c => c.name === 'Συνδρομές')!.id,
    vusa: instruments.find(i => i.ticker === 'VUSA.AS')!.id,
    pie: pie!,
  };
}

const due = async (month: string) => (await api<RecurringDue[]>('GET', `/api/recurring/due?month=${month}`)).body;

describe('recurring', () => {
  it('shows a monthly rule as due until it is recorded or skipped', async () => {
    const f = await fixtures();
    const { body: netflix } = await api<Recurring>('POST', '/api/recurring', {
      kind: 'expense', description: 'Netflix', amount: 1_399, accountId: f.piraeus, categoryId: f.subscriptions,
      frequency: 'monthly', day: 22, startDate: '2026-10-01',
    });
    expect(netflix).toMatchObject({ kind: 'expense', amount: 1_399, toAccountId: null, month: null, active: true });

    expect((await due('2026-09'))).toEqual([]);
    expect((await due('2026-10')).map(d => [d.recurring.id, d.dueDate])).toEqual([[netflix.id, '2026-10-22']]);

    // Καταχώριση (με άλλο ποσό): η λήξη δεν φαίνεται πια
    const { body: tx } = await api<Transaction>('POST', '/api/transactions', {
      type: 'expense', date: '2026-10-23', amount: 1_499, accountId: f.piraeus, categoryId: f.subscriptions,
      description: 'Netflix', recurringId: netflix.id, recurringDue: '2026-10-22',
    });
    expect(tx).toMatchObject({ recurringId: netflix.id, recurringDue: '2026-10-22' });
    expect(await due('2026-10')).toEqual([]);
    // Διαγραφή της συναλλαγής: ξανά αναμενόμενη
    await api('DELETE', `/api/transactions/${tx.id}`);
    expect(await due('2026-10')).toHaveLength(1);

    // «Όχι αυτόν τον μήνα» και αναίρεση
    await api('POST', `/api/recurring/${netflix.id}/skip`, { dueDate: '2026-11-22' });
    expect(await due('2026-11')).toEqual([]);
    await api('DELETE', `/api/recurring/${netflix.id}/skip/2026-11-22`);
    expect(await due('2026-11')).toHaveLength(1);

    // Παύση
    await api('PUT', `/api/recurring/${netflix.id}`, { ...netflix, active: false });
    expect(await due('2026-12')).toEqual([]);
  });

  it('supports yearly rules, transfers, stock and pie buys', async () => {
    const f = await fixtures();
    const yearly = await api<Recurring>('POST', '/api/recurring', {
      kind: 'income', description: 'Bonus', amount: 50_000, accountId: f.piraeus, categoryId: f.salary,
      frequency: 'yearly', day: 20, month: 12, startDate: '2026-01-01',
    });
    expect(yearly.status).toBe(201);
    const buy = (await api<Recurring>('POST', '/api/recurring', {
      kind: 'buy', amount: 10_000, accountId: f.revolut, instrumentId: f.vusa, fundingAccountId: f.piraeus,
      frequency: 'monthly', day: 5, startDate: '2026-01-01',
    })).body;
    // Για pie ο λογαριασμός παίρνεται από το pie
    const pie = (await api<Recurring>('POST', '/api/recurring', {
      kind: 'pie', amount: 5_000, accountId: f.piraeus, pieId: f.pie.id, fundingAccountId: f.piraeus,
      frequency: 'monthly', day: 5, startDate: '2026-01-01', categoryId: f.salary,
    })).body;
    expect(pie).toMatchObject({ accountId: f.t212, categoryId: null });

    expect((await due('2026-11')).map(d => d.recurring.kind)).toEqual(['buy', 'pie']);
    expect((await due('2026-12')).map(d => d.recurring.kind)).toEqual(['buy', 'pie', 'income']);

    // Η αγορά καλύπτει τη λήξη της, όπως και η αγορά στο pie (batch)
    await api('POST', '/api/trades', {
      date: '2026-11-05', accountId: f.revolut, instrumentId: f.vusa, side: 'buy', quantity: 0.75, amountEur: 10_000,
      fundingAccountId: f.piraeus, recurringId: buy.id, recurringDue: '2026-11-05',
    });
    const { body: batch } = await api<Trade[]>('POST', '/api/trades/batch', {
      trades: f.pie.slices.slice(0, 2).map(s => ({
        date: '2026-11-05', accountId: f.t212, instrumentId: s.instrumentId, side: 'buy', quantity: 0.01, amountEur: 2_500,
        pieId: f.pie.id, recurringId: pie.id, recurringDue: '2026-11-05',
      })),
    });
    expect(batch[0]).toMatchObject({ recurringId: pie.id, recurringDue: '2026-11-05' });
    expect(await due('2026-11')).toEqual([]);
  });

  it('validates rules by kind', async () => {
    const f = await fixtures();
    const base = { amount: 100, accountId: f.piraeus, frequency: 'monthly', day: 1, startDate: '2026-01-01' };
    expect((await api('POST', '/api/recurring', { ...base, kind: 'expense' })).status).toBe(400);
    expect((await api('POST', '/api/recurring', { ...base, kind: 'expense', categoryId: f.salary })).status).toBe(400);
    expect((await api('POST', '/api/recurring', { ...base, kind: 'transfer', toAccountId: f.piraeus })).status).toBe(400);
    expect((await api('POST', '/api/recurring', { ...base, kind: 'buy', instrumentId: f.vusa })).status).toBe(400);
    expect((await api('POST', '/api/recurring', { ...base, kind: 'income', categoryId: f.salary, frequency: 'yearly' })).status).toBe(400);
    expect((await api('POST', '/api/recurring', { ...base, kind: 'income', categoryId: f.salary, endDate: '2025-01-01' })).status).toBe(400);
  });

  it('deleting a rule keeps its transactions; used categories and accounts cannot be deleted', async () => {
    const f = await fixtures();
    const { body: rule } = await api<Recurring>('POST', '/api/recurring', {
      kind: 'expense', amount: 1_399, accountId: f.piraeus, categoryId: f.subscriptions, frequency: 'monthly', day: 22, startDate: '2026-10-01',
    });
    expect((await api('DELETE', `/api/categories/${f.subscriptions}`)).status).toBe(409);
    await api('POST', '/api/transactions', {
      type: 'expense', date: '2026-10-22', amount: 1_399, accountId: f.piraeus, categoryId: f.subscriptions,
      recurringId: rule.id, recurringDue: '2026-10-22',
    });
    expect((await api('DELETE', `/api/recurring/${rule.id}`)).status).toBe(204);
    const [tx] = (await api<Transaction[]>('GET', '/api/transactions?month=2026-10')).body;
    expect(tx).toMatchObject({ amount: 1_399, recurringId: null, recurringDue: null });
    expect((await api<Recurring[]>('GET', '/api/recurring')).body).toEqual([]);
  });
});
