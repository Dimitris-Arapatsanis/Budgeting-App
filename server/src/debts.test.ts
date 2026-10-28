import { beforeEach, describe, expect, it } from 'vitest';
import type { AccountWithBalance, Category, Debt, MonthSummary, Transaction } from '@budget/shared';
import { buildApp } from './app.ts';
import { openDb } from './db/index.ts';
import { fakeMarket } from './market/fake-market.ts';

let app: ReturnType<typeof buildApp>;

async function api<T = unknown>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: object) {
  const res = await app.inject({ method, url, payload });
  return { status: res.statusCode, body: (res.body ? res.json() : undefined) as T };
}

beforeEach(() => {
  app = buildApp(openDb(':memory:'), { market: fakeMarket() });
});

async function fixtures() {
  const accounts = (await api<AccountWithBalance[]>('GET', '/api/accounts')).body;
  const categories = (await api<Category[]>('GET', '/api/categories')).body;
  return {
    piraeus: accounts.find(a => a.name === 'Τράπεζα Πειραιώς')!.id,
    cash: accounts.find(a => a.type === 'cash')!.id,
    other: categories.find(c => c.name === 'Άλλα')!.id,
    otherIncome: categories.find(c => c.name === 'Άλλα έσοδα')!.id,
  };
}

const balances = async () => {
  const accounts = (await api<AccountWithBalance[]>('GET', '/api/accounts')).body;
  return Object.fromEntries(accounts.map(a => [a.name, a.balance]));
};

describe('debts: lent', () => {
  it('lends, gets partially repaid into another account, and settles', async () => {
    const f = await fixtures();
    const created = await api<Debt>('POST', '/api/debts', { direction: 'lent', person: 'Γιώργος', reason: 'Εισιτήρια', date: '2026-10-05', amount: 10_000, accountId: f.cash });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ person: 'Γιώργος', amount: 10_000, accountId: f.cash, settled: 0, outstanding: 10_000 });
    expect(await balances()).toMatchObject({ 'Μετρητά': -10_000, 'Μου χρωστάνε': 10_000 });

    const id = created.body.id;
    const partial = await api<Debt>('POST', `/api/debts/${id}/payments`, { date: '2026-10-20', amount: 4_000, accountId: f.piraeus });
    expect(partial.body).toMatchObject({ settled: 4_000, outstanding: 6_000 });
    expect(partial.body.payments).toEqual([{ transactionId: expect.any(Number), date: '2026-10-20', amount: 4_000, accountId: f.piraeus, kind: 'payment' }]);
    expect((await api('POST', `/api/debts/${id}/payments`, { date: '2026-10-21', amount: 7_000, accountId: f.piraeus })).status).toBe(400);
    await api('POST', `/api/debts/${id}/payments`, { date: '2026-10-21', amount: 6_000, accountId: f.piraeus });
    expect(await balances()).toMatchObject({ 'Τράπεζα Πειραιώς': 10_000, 'Μετρητά': -10_000, 'Μου χρωστάνε': 0 });

    // Ο δανεισμός δεν είναι έξοδο: η αποταμίευση του μήνα δεν αλλάζει
    const summary = (await api<MonthSummary>('GET', '/api/summary?month=2026-10')).body;
    expect(summary).toMatchObject({ income: 0, expenses: 0, savings: 0 });
  });

  it('forgives the rest as an expense in the chosen category', async () => {
    const f = await fixtures();
    const { body: debt } = await api<Debt>('POST', '/api/debts', { direction: 'lent', person: 'Μαρία', date: '2026-10-05', amount: 5_000, accountId: f.piraeus });
    await api('POST', `/api/debts/${debt.id}/payments`, { date: '2026-10-10', amount: 2_000, accountId: f.piraeus });
    const forgiven = await api<Debt>('POST', `/api/debts/${debt.id}/forgive`, { date: '2026-10-15', categoryId: f.other });
    expect(forgiven.body).toMatchObject({ outstanding: 0, settled: 5_000 });
    expect(forgiven.body.payments[1]).toMatchObject({ amount: 3_000, accountId: null, kind: 'forgiven' });

    const summary = (await api<MonthSummary>('GET', '/api/summary?month=2026-10')).body;
    expect(summary).toMatchObject({ expenses: 3_000, savings: -3_000 });
    expect(await balances()).toMatchObject({ 'Τράπεζα Πειραιώς': -3_000, 'Μου χρωστάνε': 0 });
    expect((await api('POST', `/api/debts/${debt.id}/forgive`, { date: '2026-10-15', categoryId: f.other })).status).toBe(400);
    // Λάθος κατηγορία (έσοδο για δανεικά που έδωσα)
    const other = (await api<Debt>('POST', '/api/debts', { direction: 'lent', person: 'Νίκος', date: '2026-10-05', amount: 100, accountId: f.piraeus })).body;
    expect((await api('POST', `/api/debts/${other.id}/forgive`, { date: '2026-10-15', categoryId: f.otherIncome })).status).toBe(400);

    // Αναίρεση του «χαρίστηκε»
    const undone = await api<Debt>('DELETE', `/api/debts/${debt.id}/payments/${forgiven.body.payments[1]!.transactionId}`);
    expect(undone.body.outstanding).toBe(3_000);
  });
});

describe('debts: borrowed', () => {
  it('borrows into an account and repays from another', async () => {
    const f = await fixtures();
    const { body: debt } = await api<Debt>('POST', '/api/debts', { direction: 'borrowed', person: 'Αδερφός', date: '2026-10-01', amount: 20_000, accountId: f.piraeus });
    expect(debt).toMatchObject({ direction: 'borrowed', accountId: f.piraeus, outstanding: 20_000 });
    expect(await balances()).toMatchObject({ 'Τράπεζα Πειραιώς': 20_000, 'Χρωστάω': -20_000 });
    await api('POST', `/api/debts/${debt.id}/payments`, { date: '2026-10-25', amount: 20_000, accountId: f.cash });
    expect(await balances()).toMatchObject({ 'Μετρητά': -20_000, 'Χρωστάω': 0 });
    const forgive = await api<Debt>('POST', '/api/debts', { direction: 'borrowed', person: 'Γονείς', date: '2026-10-01', amount: 1_000, accountId: f.piraeus });
    const res = await api<Debt>('POST', `/api/debts/${forgive.body.id}/forgive`, { date: '2026-10-30', categoryId: f.otherIncome });
    expect(res.body.outstanding).toBe(0);
    expect((await api<MonthSummary>('GET', '/api/summary?month=2026-10')).body.income).toBe(1_000);
  });
});

describe('debts: protection and editing', () => {
  it('keeps debt transactions and system accounts out of the regular APIs', async () => {
    const f = await fixtures();
    const { body: debt } = await api<Debt>('POST', '/api/debts', { direction: 'lent', person: 'Γιώργος', date: '2026-10-05', amount: 10_000, accountId: f.cash });
    const [tx] = (await api<Transaction[]>('GET', '/api/transactions?month=2026-10')).body;
    expect(tx).toMatchObject({ type: 'transfer', debtId: debt.id, description: 'Γιώργος' });
    expect((await api('DELETE', `/api/transactions/${tx!.id}`)).status).toBe(409);
    expect((await api('PUT', `/api/transactions/${tx!.id}`, { type: 'expense', date: '2026-10-05', amount: 1, accountId: f.cash, categoryId: f.other })).status).toBe(409);

    const receivable = (await api<AccountWithBalance[]>('GET', '/api/accounts')).body.find(a => a.type === 'receivable')!;
    expect((await api('POST', '/api/transactions', { type: 'transfer', date: '2026-10-05', amount: 1, accountId: f.cash, toAccountId: receivable.id })).status).toBe(400);
    expect((await api('POST', `/api/accounts/${receivable.id}/reconcile`, { actualBalance: 0, date: '2026-10-05' })).status).toBe(400);
    expect((await api('POST', '/api/accounts', { name: 'X', type: 'receivable', initialBalance: 0 })).status).toBe(400);
    expect((await api('POST', '/api/debts', { direction: 'lent', person: 'X', date: '2026-10-05', amount: 1, accountId: receivable.id })).status).toBe(400);
  });

  it('edits and deletes a debt with its transactions', async () => {
    const f = await fixtures();
    const { body: debt } = await api<Debt>('POST', '/api/debts', { direction: 'lent', person: 'Γιώργος', date: '2026-10-05', amount: 10_000, accountId: f.cash });
    await api('POST', `/api/debts/${debt.id}/payments`, { date: '2026-10-20', amount: 4_000, accountId: f.piraeus });
    const base = { direction: 'lent', person: 'Γιώργος Π.', reason: 'Δείπνο', date: '2026-10-06', accountId: f.piraeus };
    expect((await api('PUT', `/api/debts/${debt.id}`, { ...base, amount: 3_000 })).status).toBe(400);
    const edited = await api<Debt>('PUT', `/api/debts/${debt.id}`, { ...base, amount: 12_000 });
    expect(edited.body).toMatchObject({ person: 'Γιώργος Π.', reason: 'Δείπνο', amount: 12_000, accountId: f.piraeus, outstanding: 8_000 });
    expect(await balances()).toMatchObject({ 'Μετρητά': 0, 'Τράπεζα Πειραιώς': -8_000, 'Μου χρωστάνε': 8_000 });

    expect((await api('DELETE', `/api/debts/${debt.id}`)).status).toBe(204);
    expect((await api<Debt[]>('GET', '/api/debts')).body).toEqual([]);
    expect((await api<Transaction[]>('GET', '/api/transactions?month=2026-10')).body).toEqual([]);
    expect(await balances()).toMatchObject({ 'Τράπεζα Πειραιώς': 0, 'Μου χρωστάνε': 0 });
  });
});
