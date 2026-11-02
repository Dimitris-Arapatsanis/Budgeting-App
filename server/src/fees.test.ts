import { beforeEach, describe, expect, it } from 'vitest';
import type { AccountWithBalance, Category, Instrument, MonthSummary, Pie, Trade, Transaction } from '@budget/shared';
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
  return {
    piraeus: accounts.find(a => a.name === 'Τράπεζα Πειραιώς')!.id,
    alpha: accounts.find(a => a.name === 'Alpha Bank')!.id,
    t212: accounts.find(a => a.name === 'Trading 212')!.id,
    revolut: accounts.find(a => a.name === 'Revolut')!.id,
    travel: categories.find(c => c.name === 'Ταξίδια')!.id,
    fees: categories.find(c => c.name === 'Χρεώσεις' && c.kind === 'expense')!.id,
    vusa: instruments.find(i => i.ticker === 'VUSA.AS')!.id,
  };
}

const balances = async () =>
  Object.fromEntries((await api<AccountWithBalance[]>('GET', '/api/accounts')).body.map(a => [a.name, a.balance]));
const monthTx = async () => (await api<Transaction[]>('GET', '/api/transactions?month=2026-11')).body;
const summary = async () => (await api<MonthSummary>('GET', '/api/summary?month=2026-11')).body;

describe('fees (χρεώσεις)', () => {
  it('a transfer with a fee: the fee is an expense from the source account, on top of the amount', async () => {
    const f = await fixtures();
    const { body: transfer } = await api<Transaction>('POST', '/api/transactions', {
      type: 'transfer', date: '2026-11-02', amount: 10_000, accountId: f.piraeus, toAccountId: f.alpha, fee: 100,
    });
    expect(await balances()).toMatchObject({ 'Τράπεζα Πειραιώς': -10_100, 'Alpha Bank': 10_000 });
    const rows = await monthTx();
    const fee = rows.find(t => t.feeForId === transfer.id)!;
    expect(fee).toMatchObject({ type: 'expense', amount: 100, accountId: f.piraeus, categoryId: f.fees, date: '2026-11-02' });
    expect(rows.find(t => t.id === transfer.id)!.fee).toBe(100);
    expect(await summary()).toMatchObject({ expenses: 100 });

    // Η χρέωση δεν αλλάζει/σβήνεται μόνη της
    expect((await api('DELETE', `/api/transactions/${fee.id}`)).status).toBe(409);

    // Αλλαγή: νέα χρέωση και άλλος λογαριασμός
    await api('PUT', `/api/transactions/${transfer.id}`, {
      type: 'transfer', date: '2026-11-03', amount: 10_000, accountId: f.alpha, toAccountId: f.piraeus, fee: 50,
    });
    expect((await monthTx()).find(t => t.feeForId === transfer.id)).toMatchObject({ amount: 50, accountId: f.alpha, date: '2026-11-03' });
    // Χωρίς χρέωση: σβήνεται
    await api('PUT', `/api/transactions/${transfer.id}`, {
      type: 'transfer', date: '2026-11-03', amount: 10_000, accountId: f.alpha, toAccountId: f.piraeus,
    });
    expect((await monthTx()).some(t => t.feeForId != null)).toBe(false);

    // Διαγραφή συναλλαγής σβήνει και τη χρέωση
    await api('PUT', `/api/transactions/${transfer.id}`, {
      type: 'transfer', date: '2026-11-03', amount: 10_000, accountId: f.alpha, toAccountId: f.piraeus, fee: 20,
    });
    expect((await api('DELETE', `/api/transactions/${transfer.id}`)).status).toBe(204);
    expect(await monthTx()).toHaveLength(0);
  });

  it('an expense with a fee keeps its own category; the fee goes to «Χρεώσεις»', async () => {
    const f = await fixtures();
    await api('POST', '/api/transactions', {
      type: 'expense', date: '2026-11-02', amount: 5_000, accountId: f.piraeus, categoryId: f.travel, fee: 150, description: 'Ξενοδοχείο',
    });
    const s = await summary();
    expect(s.expenses).toBe(5_150);
    expect(s.expensesByCategory.find(c => c.categoryId === f.travel)!.amount).toBe(5_000);
    expect(s.expensesByCategory.find(c => c.categoryId === f.fees)!.amount).toBe(150);
    expect((await monthTx()).find(t => t.feeForId != null)!.description).toBe('Ξενοδοχείο');
  });

  it('a stock buy funded from the bank with a fee: 25,18 leave the bank, 25 reach the broker', async () => {
    const f = await fixtures();
    const { body: trade } = await api<Trade>('POST', '/api/trades', {
      date: '2026-11-02', accountId: f.t212, instrumentId: f.vusa, side: 'buy', quantity: 0.2, amountEur: 2_500, fundingAccountId: f.piraeus, fundingFee: 18,
    });
    expect(trade.fundingFee).toBe(18);
    expect(await balances()).toMatchObject({ 'Τράπεζα Πειραιώς': -2_518, 'Trading 212': 0 });
    expect(await summary()).toMatchObject({ expenses: 18, invested: 2_500 });

    // Αλλαγή χρέωσης
    await api('PUT', `/api/trades/${trade.id}`, {
      date: '2026-11-02', accountId: f.t212, instrumentId: f.vusa, side: 'buy', quantity: 0.2, amountEur: 2_500, fundingAccountId: f.piraeus, fundingFee: 30,
    });
    expect(await balances()).toMatchObject({ 'Τράπεζα Πειραιώς': -2_530 });

    // Διαγραφή αγοράς: φεύγουν μεταφορά και χρέωση
    await api('DELETE', `/api/trades/${trade.id}`);
    expect(await monthTx()).toHaveLength(0);
  });

  it('a pie buy: one transfer and one fee for the whole buy', async () => {
    const f = await fixtures();
    const pie = (await api<Pie[]>('GET', '/api/pies')).body[0]!;
    const [a, b] = pie.slices;
    const { body: created } = await api<Trade[]>('POST', '/api/trades/batch', {
      trades: [
        { date: '2026-11-02', accountId: f.t212, instrumentId: a!.instrumentId, side: 'buy', quantity: 0.1, amountEur: 1_500, pieId: pie.id, fundingAccountId: f.piraeus, fundingFee: 18 },
        { date: '2026-11-02', accountId: f.t212, instrumentId: b!.instrumentId, side: 'buy', quantity: 0.1, amountEur: 1_000, pieId: pie.id, fundingAccountId: f.piraeus },
      ],
    });
    const rows = await monthTx();
    expect(rows.filter(t => t.type === 'transfer')).toHaveLength(1);
    expect(rows.filter(t => t.feeForId != null).map(t => t.amount)).toEqual([18]);
    expect(await balances()).toMatchObject({ 'Τράπεζα Πειραιώς': -2_518 });

    // Σβήνεις τη μετοχή που είχε τη χρέωση: η μεταφορά μένει για την άλλη, η χρέωση φεύγει
    await api('DELETE', `/api/trades/${created[0]!.id}`);
    expect(await balances()).toMatchObject({ 'Τράπεζα Πειραιώς': -1_000 });
  });

  it('a buy from the broker\'s own cash has no fee', async () => {
    const f = await fixtures();
    const { body: trade } = await api<Trade>('POST', '/api/trades', {
      date: '2026-11-02', accountId: f.revolut, instrumentId: f.vusa, side: 'buy', quantity: 1, amountEur: 1_000, fundingFee: 50,
    });
    expect(trade.fundingFee).toBe(0);
    expect(await monthTx()).toHaveLength(0);
  });
});
