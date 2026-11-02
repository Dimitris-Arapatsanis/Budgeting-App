import { describe, expect, it } from 'vitest';
import { computeBalances, computeMonthSummary } from './calc.ts';
import { parseDecimal } from './money.ts';
import { computeHoldings, normalizeCurrency, quantityFor, splitPieAmount, toEur, valueCents } from './portfolio.ts';
import type { Trade } from './schemas.ts';

const REVOLUT = 3;
const T212 = 4;
const VUSA = 1;
const MSFT = 2;

let nextId = 1;
function trade(partial: Partial<Trade> & Pick<Trade, 'side' | 'quantity' | 'amountEur'>): Trade {
  return { id: nextId++, date: '2026-10-05', accountId: REVOLUT, instrumentId: VUSA, pieId: null, fundingAccountId: null, fundingTransactionId: null, fundingFee: 0, batchId: null, ...partial };
}

describe('computeHoldings', () => {
  it('adds buys and openings, and removes cost proportionally on sell (average cost)', () => {
    const trades = [
      trade({ side: 'opening', date: '2026-01-01', quantity: 10, amountEur: 100_000 }),
      trade({ side: 'buy', date: '2026-10-05', quantity: 5, amountEur: 65_000 }),
      trade({ side: 'sell', date: '2026-10-20', quantity: 3, amountEur: 45_000 }),
      trade({ side: 'buy', accountId: T212, instrumentId: MSFT, quantity: 0.123456, amountEur: 5_000 }),
    ];
    expect(computeHoldings(trades)).toEqual([
      // 15 μετοχές κόστους 1.650 € → πώληση 3 αφαιρεί 330 €
      { accountId: REVOLUT, instrumentId: VUSA, quantity: 12, costEur: 132_000 },
      { accountId: T212, instrumentId: MSFT, quantity: 0.123456, costEur: 5_000 },
    ]);
  });

  it('respects the until date and drops fully sold positions', () => {
    const trades = [
      trade({ side: 'buy', date: '2026-09-01', quantity: 0.1, amountEur: 1_000 }),
      trade({ side: 'buy', date: '2026-09-02', quantity: 0.2, amountEur: 2_000 }),
      trade({ side: 'sell', date: '2026-10-01', quantity: 0.3, amountEur: 3_500 }),
    ];
    expect(computeHoldings(trades, '2026-09-30')).toEqual([{ accountId: REVOLUT, instrumentId: VUSA, quantity: 0.3, costEur: 3_000 }]);
    expect(computeHoldings(trades)).toEqual([]);
  });
});

describe('splitPieAmount', () => {
  it('splits by target percent and always sums to the amount', () => {
    const slices = [15, 15, 14, 14, 12, 10, 8, 7, 5].map((targetPercent, i) => ({ instrumentId: i + 1, targetPercent }));
    const parts = splitPieAmount(10_000, slices);
    expect(parts).toEqual([1_500, 1_500, 1_400, 1_400, 1_200, 1_000, 800, 700, 500]);
    const odd = splitPieAmount(3_333, slices);
    expect(odd.reduce((a, b) => a + b, 0)).toBe(3_333);
    expect(splitPieAmount(100, [{ instrumentId: 1, targetPercent: 33.34 }, { instrumentId: 2, targetPercent: 33.33 }, { instrumentId: 3, targetPercent: 33.33 }]))
      .toEqual([34, 33, 33]);
  });
});

describe('currency conversion', () => {
  it('normalizes London pence and converts to EUR', () => {
    expect(normalizeCurrency('GBp')).toEqual({ currency: 'GBP', factor: 0.01 });
    expect(normalizeCurrency('usd')).toEqual({ currency: 'USD', factor: 1 });
    // 527,20 $ με EURUSD 1,1147 → 472,95 €
    expect(toEur(527.2, 1.1147)).toBeCloseTo(472.952, 3);
    expect(valueCents(0.5, 472.952)).toBe(23_648);
    expect(quantityFor(10_000, 472.952)).toBe(0.21143795);
  });

  it('parses decimal quantities in Greek or English format', () => {
    expect(parseDecimal('0,123456')).toBe(0.123456);
    expect(parseDecimal('12.5')).toBe(12.5);
    expect(parseDecimal('-1')).toBeNull();
    expect(parseDecimal('abc')).toBeNull();
  });
});

describe('trades in balances and month summary', () => {
  const accounts = [
    { id: 1, type: 'bank' as const, initialBalance: 100_000 },
    { id: REVOLUT, type: 'broker' as const, initialBalance: 20_000 },
  ];

  it('buys take cash from the broker, sells add it back, openings do not touch cash', () => {
    const trades = [
      trade({ side: 'opening', quantity: 10, amountEur: 900_000 }),
      trade({ side: 'buy', quantity: 1, amountEur: 13_000 }),
      trade({ side: 'sell', date: '2026-11-01', quantity: 0.5, amountEur: 7_000 }),
    ];
    expect(computeBalances(accounts, [], undefined, trades).get(REVOLUT)).toBe(14_000);
    expect(computeBalances(accounts, [], '2026-10-31', trades).get(REVOLUT)).toBe(7_000);
  });

  it('counts buys (not openings) as invested', () => {
    const salary = { id: 1, date: '2026-10-01', type: 'income' as const, amount: 180_000, accountId: 1, toAccountId: null, categoryId: 1, description: '' };
    const rent = { ...salary, id: 2, type: 'expense' as const, amount: 100_000 };
    const trades = [trade({ side: 'buy', quantity: 1, amountEur: 30_000 }), trade({ side: 'opening', quantity: 5, amountEur: 500_000 })];
    const s = computeMonthSummary([salary, rent], accounts, trades);
    expect(s).toMatchObject({ savings: 80_000, invested: 30_000, status: 'ok' });
  });
});
