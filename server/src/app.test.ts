import { beforeEach, describe, expect, it } from 'vitest';
import type { AccountWithBalance, Category, MonthSummary, YearSummary } from '@budget/shared';
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
  const account = (name: string) => accounts.find(a => a.name === name)!.id;
  const category = (name: string) => categories.find(c => c.name === name)!.id;
  return {
    piraeus: account('Τράπεζα Πειραιώς'),
    alpha: account('Alpha Bank'),
    salary: category('Μισθός'),
    supermarket: category('Σούπερ μάρκετ'),
  };
}

describe('seed', () => {
  it('creates the default accounts and categories', async () => {
    const accounts = (await api<AccountWithBalance[]>('GET', '/api/accounts')).body;
    expect(accounts.map(a => [a.name, a.type, a.balance])).toEqual([
      ['Τράπεζα Πειραιώς', 'bank', 0],
      ['Alpha Bank', 'savings', 0],
      ['Μετρητά', 'cash', 0],
      ['Revolut', 'broker', 0],
      ['Trading 212', 'broker', 0],
    ]);
    const categories = (await api<Category[]>('GET', '/api/categories')).body;
    expect(categories.filter(c => c.kind === 'income')).toHaveLength(4);
    expect(categories.filter(c => c.kind === 'expense')).toHaveLength(12);
    expect(categories.find(c => c.name === 'Σούπερ μάρκετ')).toMatchObject({ icon: 'shopping-cart', color: 'emerald' });
  });
});

describe('transactions & summary', () => {
  it('records a month and computes balances and the month result', async () => {
    const f = await fixtures();
    await api('POST', '/api/transactions', { type: 'income', date: '2026-10-01', amount: 180_000, accountId: f.piraeus, categoryId: f.salary });
    await api('POST', '/api/transactions', { type: 'transfer', date: '2026-10-01', amount: 50_000, accountId: f.piraeus, toAccountId: f.alpha });
    await api('POST', '/api/transactions', { type: 'expense', date: '2026-10-10', amount: 150_000, accountId: f.piraeus, categoryId: f.supermarket });
    await api('POST', '/api/transactions', { type: 'expense', date: '2026-11-02', amount: 1_000, accountId: f.piraeus, categoryId: f.supermarket });

    const october = await api<unknown[]>('GET', '/api/transactions?month=2026-10');
    expect(october.body).toHaveLength(3);

    const summary = (await api<MonthSummary>('GET', '/api/summary?month=2026-10')).body;
    expect(summary).toMatchObject({ income: 180_000, expenses: 150_000, savings: 30_000, status: 'ok', fromSavings: 0 });

    const accounts = (await api<AccountWithBalance[]>('GET', '/api/accounts')).body;
    expect(accounts.find(a => a.id === f.piraeus)!.balance).toBe(180_000 - 50_000 - 150_000 - 1_000);
    expect(accounts.find(a => a.id === f.alpha)!.balance).toBe(50_000);
  });

  it('returns the year overview', async () => {
    const f = await fixtures();
    await api('POST', '/api/transactions', { type: 'income', date: '2026-10-01', amount: 180_000, accountId: f.piraeus, categoryId: f.salary });
    await api('POST', '/api/transactions', { type: 'income', date: '2025-12-01', amount: 99_000, accountId: f.piraeus, categoryId: f.salary });
    const res = await api<YearSummary>('GET', '/api/year?year=2026');
    expect(res.body.months).toHaveLength(12);
    expect(res.body.total.income).toBe(180_000);
    expect((await api('GET', '/api/year?year=abc')).status).toBe(400);
  });

  it('rejects invalid transactions', async () => {
    const f = await fixtures();
    const cases = [
      { type: 'expense', date: '2026-10-01', amount: -5, accountId: f.piraeus, categoryId: f.supermarket },
      { type: 'expense', date: '2026-10-01', amount: 500, accountId: f.piraeus, categoryId: f.salary }, // λάθος είδος κατηγορίας
      { type: 'transfer', date: '2026-10-01', amount: 500, accountId: f.piraeus, toAccountId: f.piraeus },
      { type: 'income', date: '01/10/2026', amount: 500, accountId: f.piraeus, categoryId: f.salary },
      { type: 'income', date: '2026-10-01', amount: 500, accountId: 999, categoryId: f.salary },
    ];
    for (const payload of cases) {
      expect((await api('POST', '/api/transactions', payload)).status, JSON.stringify(payload)).toBe(400);
    }
  });

  it('updates and deletes a transaction', async () => {
    const f = await fixtures();
    const created = await api<{ id: number }>('POST', '/api/transactions', { type: 'expense', date: '2026-10-05', amount: 1_000, accountId: f.piraeus, categoryId: f.supermarket });
    expect(created.status).toBe(201);
    const updated = await api<{ amount: number }>('PUT', `/api/transactions/${created.body.id}`, { type: 'expense', date: '2026-10-05', amount: 2_500, accountId: f.piraeus, categoryId: f.supermarket, description: 'Λαϊκή' });
    expect(updated.body.amount).toBe(2_500);
    expect((await api('DELETE', `/api/transactions/${created.body.id}`)).status).toBe(204);
    expect((await api('DELETE', `/api/transactions/${created.body.id}`)).status).toBe(404);
  });
});

describe('accounts', () => {
  it('reconciles the balance with an adjustment', async () => {
    const f = await fixtures();
    await api('POST', '/api/transactions', { type: 'income', date: '2026-10-01', amount: 100_000, accountId: f.piraeus, categoryId: f.salary });
    const res = await api<{ adjustment: number; account: AccountWithBalance }>('POST', `/api/accounts/${f.piraeus}/reconcile`, { actualBalance: 97_550, date: '2026-10-20' });
    expect(res.body.adjustment).toBe(-2_450);
    expect(res.body.account.balance).toBe(97_550);

    const summary = (await api<MonthSummary>('GET', '/api/summary?month=2026-10')).body;
    expect(summary).toMatchObject({ savings: 100_000, adjustments: -2_450 });
  });

  it('refuses to delete an account or category that has transactions', async () => {
    const f = await fixtures();
    await api('POST', '/api/transactions', { type: 'income', date: '2026-10-01', amount: 100, accountId: f.piraeus, categoryId: f.salary });
    expect((await api('DELETE', `/api/accounts/${f.piraeus}`)).status).toBe(409);
    expect((await api('DELETE', `/api/categories/${f.salary}`)).status).toBe(409);
  });

  it('creates a loan account with a negative balance', async () => {
    const res = await api<AccountWithBalance>('POST', '/api/accounts', { name: 'Δάνειο αυτοκινήτου', type: 'loan', initialBalance: -500_000 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ balance: -500_000, sortOrder: 5 });
  });
});

describe('categories', () => {
  it('rejects duplicate names within the same kind', async () => {
    expect((await api('POST', '/api/categories', { name: 'Σούπερ μάρκετ', kind: 'expense' })).status).toBe(409);
    expect((await api('POST', '/api/categories', { name: 'Κατοικίδια', kind: 'expense' })).status).toBe(201);
  });

  it('stores icon and color, with defaults and validation', async () => {
    const created = await api<Category>('POST', '/api/categories', { name: 'Γυμναστήριο', kind: 'expense' });
    expect(created.body).toMatchObject({ icon: 'tag', color: 'slate' });
    const updated = await api<Category>('PUT', `/api/categories/${created.body.id}`, { name: 'Γυμναστήριο', kind: 'expense', icon: 'dumbbell', color: 'pink' });
    expect(updated.body).toMatchObject({ icon: 'dumbbell', color: 'pink' });
    expect((await api('PUT', `/api/categories/${created.body.id}`, { name: 'Γυμναστήριο', kind: 'expense', color: '#ff0000' })).status).toBe(400);
    expect((await api('POST', '/api/categories', { name: 'Χ', kind: 'expense', icon: 'rocket' })).status).toBe(400);
  });
});
