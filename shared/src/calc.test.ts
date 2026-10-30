import { describe, expect, it } from 'vitest';
import { computeBalances, computeMonthSummary, computeYearSummary } from './calc.ts';
import type { Account, Transaction } from './schemas.ts';

const PIRAEUS = 1;
const ALPHA = 2;
const T212 = 3;

const accounts: Account[] = [
  { id: PIRAEUS, name: 'Τράπεζα Πειραιώς', type: 'bank', initialBalance: 100_000, archived: false, sortOrder: 0 },
  { id: ALPHA, name: 'Alpha Bank', type: 'savings', initialBalance: 500_000, archived: false, sortOrder: 1 },
  { id: T212, name: 'Trading 212', type: 'broker', initialBalance: 0, archived: false, sortOrder: 2 },
];

let nextId = 1;
function tx(partial: Partial<Transaction> & Pick<Transaction, 'type' | 'amount'>): Transaction {
  return {
    id: nextId++,
    date: '2026-10-01',
    accountId: PIRAEUS,
    toAccountId: null,
    categoryId: null,
    description: '',
    ...partial,
  };
}

const salary = tx({ type: 'income', amount: 180_000, categoryId: 1 });
const toAlpha500 = tx({ type: 'transfer', amount: 50_000, toAccountId: ALPHA });

describe('computeBalances', () => {
  it('applies income, expenses, transfers and adjustments', () => {
    const txs = [
      salary,
      toAlpha500,
      tx({ type: 'expense', amount: 30_000, categoryId: 10 }),
      tx({ type: 'transfer', amount: 10_000, toAccountId: T212 }),
      tx({ type: 'adjustment', amount: -1_500, accountId: ALPHA }),
    ];
    const balances = computeBalances(accounts, txs);
    expect(balances.get(PIRAEUS)).toBe(100_000 + 180_000 - 50_000 - 30_000 - 10_000);
    expect(balances.get(ALPHA)).toBe(500_000 + 50_000 - 1_500);
    expect(balances.get(T212)).toBe(10_000);
  });

  it('ignores transactions after the `until` date', () => {
    const later = tx({ type: 'expense', amount: 5_000, date: '2026-11-02', categoryId: 10 });
    expect(computeBalances(accounts, [salary, later], '2026-10-31').get(PIRAEUS)).toBe(280_000);
  });
});

describe('computeMonthSummary', () => {
  it('is ok when income covers expenses, whatever account the money is in', () => {
    const s = computeMonthSummary([salary, toAlpha500, tx({ type: 'expense', amount: 150_000, categoryId: 10 })], accounts);
    expect(s).toMatchObject({ income: 180_000, expenses: 150_000, savings: 30_000, status: 'ok', fromSavings: 0 });
    expect(s.savingsRate).toBeCloseTo(30 / 180);
  });

  it('is overspent when expenses exceed income', () => {
    const s = computeMonthSummary([salary, tx({ type: 'expense', amount: 210_000, categoryId: 10 })], accounts);
    expect(s).toMatchObject({ savings: -30_000, status: 'overspent', fromSavings: 30_000 });
  });

  it('does not treat transfers (savings or broker) as income or expenses', () => {
    const s = computeMonthSummary(
      [salary, toAlpha500, tx({ type: 'transfer', amount: 10_000, toAccountId: T212 })],
      accounts,
    );
    expect(s).toMatchObject({ income: 180_000, expenses: 0, savings: 180_000, balanceChange: 180_000 });
  });

  it('groups expenses by category, largest first', () => {
    const s = computeMonthSummary(
      [
        tx({ type: 'expense', amount: 1_000, categoryId: 10 }),
        tx({ type: 'expense', amount: 5_000, categoryId: 11 }),
        tx({ type: 'expense', amount: 2_000, categoryId: 10 }),
      ],
      accounts,
    );
    expect(s.expensesByCategory).toEqual([
      { categoryId: 11, amount: 5_000 },
      { categoryId: 10, amount: 3_000 },
    ]);
    expect(s.savingsRate).toBeNull();
  });

  it('splits savings into brokers and cash (cash accounts grouped)', () => {
    const s = computeMonthSummary(
      [
        salary,
        toAlpha500,
        tx({ type: 'expense', amount: 145_000, categoryId: 10 }),
        tx({ type: 'transfer', amount: 10_000, toAccountId: T212 }),
        tx({ type: 'adjustment', amount: -999, accountId: ALPHA }),
      ],
      accounts,
    );
    expect(s.savings).toBe(35_000);
    expect(s.allocation).toEqual({
      accounts: [{ accountId: T212, amount: 10_000 }],
      cash: 25_000,
      cashByAccount: [
        { accountId: ALPHA, amount: 50_000 },
        { accountId: PIRAEUS, amount: -25_000 },
      ],
    });
    expect(s.toBrokers).toBe(10_000);
  });

  it('includes adjustments in the balance change but not in savings', () => {
    const s = computeMonthSummary([salary, tx({ type: 'adjustment', amount: -2_000 })], accounts);
    expect(s).toMatchObject({ savings: 180_000, adjustments: -2_000, balanceChange: 178_000 });
  });
});

describe('computeYearSummary', () => {
  it('summarises each month and the whole year', () => {
    const txs = [
      tx({ type: 'income', amount: 180_000, categoryId: 1, date: '2026-09-01' }),
      tx({ type: 'expense', amount: 100_000, categoryId: 10, date: '2026-09-10' }),
      tx({ type: 'income', amount: 180_000, categoryId: 1, date: '2026-10-01' }),
      tx({ type: 'expense', amount: 200_000, categoryId: 10, date: '2026-10-10' }),
    ];
    const y = computeYearSummary(2026, txs, accounts);
    expect(y.months).toHaveLength(12);
    expect(y.months[8]).toMatchObject({ month: '2026-09', hasData: true, summary: { savings: 80_000 } });
    expect(y.months[9]).toMatchObject({ month: '2026-10', summary: { savings: -20_000, status: 'overspent' } });
    expect(y.months[0]!.hasData).toBe(false);
    expect(y.total).toMatchObject({ income: 360_000, expenses: 300_000, savings: 60_000 });
    expect(y).toMatchObject({ positiveMonths: 1, negativeMonths: 1 });
  });
});
