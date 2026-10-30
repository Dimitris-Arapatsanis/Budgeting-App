import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AccountWithBalance, Debt, Instrument, MonthSummary, NetWorthHistory, Pie, SetupStatus, Trade, Transaction } from '@budget/shared';
import { buildApp } from './app.ts';
import { openDb } from './db/index.ts';
import { fakeMarket } from './market/fake-market.ts';

let app: ReturnType<typeof buildApp>;
let backupDir: string;

async function api<T = unknown>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: object) {
  const res = await app.inject({ method, url, payload });
  return { status: res.statusCode, body: (res.body ? res.json() : undefined) as T };
}

beforeEach(() => {
  backupDir = mkdtempSync(join(tmpdir(), 'budget-backup-'));
  app = buildApp(openDb(':memory:'), { market: fakeMarket(), backupDir });
});
afterEach(() => rmSync(backupDir, { recursive: true, force: true }));

async function fixtures() {
  const accounts = (await api<AccountWithBalance[]>('GET', '/api/accounts')).body;
  const instruments = (await api<Instrument[]>('GET', '/api/instruments')).body;
  const [pie] = (await api<Pie[]>('GET', '/api/pies')).body;
  const account = (name: string) => accounts.find(a => a.name === name)!.id;
  return {
    piraeus: account('Τράπεζα Πειραιώς'),
    alpha: account('Alpha Bank'),
    revolut: account('Revolut'),
    t212: account('Trading 212'),
    vusa: instruments.find(i => i.ticker === 'VUSA.AS')!.id,
    msft: instruments.find(i => i.ticker === 'MSFT')!.id,
    pie: pie!,
  };
}

async function setup(f: Awaited<ReturnType<typeof fixtures>>) {
  return api('POST', '/api/setup', {
    startDate: '2026-07-31',
    balances: [{ accountId: f.piraeus, initialBalance: 100_000 }, { accountId: f.alpha, initialBalance: 500_000 }],
    positions: [
      { accountId: f.revolut, instrumentId: f.vusa, quantity: 10, amountEur: 70_000 },
      { accountId: f.t212, instrumentId: f.msft, quantity: 1, amountEur: 15_000 },
    ],
    debts: [
      { direction: 'lent', person: 'Μπαμπάς', reason: 'Παλιό', amount: 10_000 },
      { direction: 'borrowed', person: 'Αδερφός', amount: 5_000 },
    ],
  });
}

describe('setup («Ξεκίνα»)', () => {
  it('reports an empty app and saves the starting point in one go', async () => {
    expect((await api<SetupStatus>('GET', '/api/setup/status')).body).toEqual({ empty: true });
    const f = await fixtures();
    expect((await setup(f)).status).toBe(204);
    expect((await api<SetupStatus>('GET', '/api/setup/status')).body).toEqual({ empty: false });

    const balances = Object.fromEntries((await api<AccountWithBalance[]>('GET', '/api/accounts')).body.map(a => [a.name, a.balance]));
    expect(balances).toMatchObject({ 'Τράπεζα Πειραιώς': 100_000, 'Alpha Bank': 500_000, Revolut: 0, 'Μου χρωστάνε': 10_000, 'Χρωστάω': -5_000 });

    const trades = (await api<Trade[]>('GET', '/api/trades')).body;
    expect(trades.map(t => [t.side, t.date, t.instrumentId])).toEqual(expect.arrayContaining([
      ['opening', '2026-07-31', f.vusa], ['opening', '2026-07-31', f.msft],
    ]));
    // Η MSFT είναι στο pie του Trading 212
    expect(trades.find(t => t.instrumentId === f.msft)!.pieId).toBe(f.pie.id);

    const debts = (await api<Debt[]>('GET', '/api/debts')).body;
    expect(debts.map(d => [d.direction, d.person, d.amount, d.accountId, d.outstanding])).toEqual(expect.arrayContaining([
      ['lent', 'Μπαμπάς', 10_000, null, 10_000], ['borrowed', 'Αδερφός', 5_000, null, 5_000],
    ]));

    // Τίποτα από την αφετηρία δεν είναι κίνηση του μήνα
    const summary = (await api<MonthSummary>('GET', '/api/summary?month=2026-07')).body;
    expect(summary).toMatchObject({ income: 0, expenses: 0, savings: 0, invested: 0 });
    expect(summary.allocation).toEqual({ accounts: [], cash: 0, cashByAccount: [] });

    // Περιουσία: ούτε τα υπόλοιπα, ούτε οι μετοχές, ούτε τα χρωστούμενα φαίνονται ως μεταβολή
    const nw = (await api<NetWorthHistory>('GET', '/api/networth')).body;
    expect(nw.months[0]).toMatchObject({ month: '2026-07', change: 0, savings: 0, marketChange: 0 });
  });

  it('refuses to run twice and validates accounts', async () => {
    const f = await fixtures();
    const bad = await api('POST', '/api/setup', {
      startDate: '2026-07-31', balances: [], debts: [],
      positions: [{ accountId: f.piraeus, instrumentId: f.vusa, quantity: 1, amountEur: 100 }],
    });
    expect(bad.status).toBe(400);
    expect((await api<Trade[]>('GET', '/api/trades')).body).toEqual([]);
    await setup(f);
    expect((await setup(f)).status).toBe(409);
  });
});

describe('old debts («παλιό χρέος»)', () => {
  it('opens without moving any account and is repaid normally', async () => {
    const f = await fixtures();
    const { body: debt } = await api<Debt>('POST', '/api/debts', { direction: 'lent', person: 'Δέσποινα', date: '2026-10-01', amount: 8_000, accountId: null });
    expect(debt).toMatchObject({ accountId: null, amount: 8_000, outstanding: 8_000 });
    expect((await api<Transaction[]>('GET', '/api/transactions?month=2026-10')).body[0]).toMatchObject({ type: 'adjustment', debtId: debt.id });

    await api('POST', `/api/debts/${debt.id}/payments`, { date: '2026-10-20', amount: 8_000, accountId: f.piraeus });
    const balances = Object.fromEntries((await api<AccountWithBalance[]>('GET', '/api/accounts')).body.map(a => [a.name, a.balance]));
    expect(balances).toMatchObject({ 'Τράπεζα Πειραιώς': 8_000, 'Μου χρωστάνε': 0 });
    const summary = (await api<MonthSummary>('GET', '/api/summary?month=2026-10')).body;
    expect(summary).toMatchObject({ income: 0, expenses: 0, savings: 0 });

    // Από παλιό χρέος σε κανονικό (με λογαριασμό) και πίσω
    const base = { direction: 'lent', person: 'Δέσποινα', date: '2026-10-01', amount: 8_000 };
    expect((await api<Debt>('PUT', `/api/debts/${debt.id}`, { ...base, accountId: f.alpha })).body.accountId).toBe(f.alpha);
    expect((await api<Debt>('PUT', `/api/debts/${debt.id}`, { ...base, accountId: null })).body.accountId).toBeNull();
  });
});

describe('reset («Έναρξη από την αρχή»)', () => {
  it('backs up the database, wipes everything and seeds again', async () => {
    const f = await fixtures();
    await setup(f);
    await api('POST', '/api/categories', { name: 'Δική μου', kind: 'expense' });

    expect((await api('POST', '/api/reset', { confirm: 'όχι' })).status).toBe(400);
    const { body } = await api<{ backup: string }>('POST', '/api/reset', { confirm: 'ΔΙΑΓΡΑΦΗ' });
    expect(existsSync(body.backup)).toBe(true);
    expect(readdirSync(backupDir)).toHaveLength(1);

    expect((await api<SetupStatus>('GET', '/api/setup/status')).body).toEqual({ empty: true });
    const accounts = (await api<AccountWithBalance[]>('GET', '/api/accounts')).body;
    expect(accounts.map(a => a.name)).toEqual(['Τράπεζα Πειραιώς', 'Alpha Bank', 'Μετρητά', 'Revolut', 'Trading 212']);
    expect((await api<Debt[]>('GET', '/api/debts')).body).toEqual([]);
    expect((await api<Pie[]>('GET', '/api/pies')).body[0]!.slices).toHaveLength(9);
    expect((await api<Array<{ name: string }>>('GET', '/api/categories')).body.some(c => c.name === 'Δική μου')).toBe(false);
  });
});
