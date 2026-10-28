import { describe, expect, it } from 'vitest';
import { centsToInput, parseAmount } from './money.ts';
import { lastDayOfMonth, shiftMonth } from './month.ts';

describe('parseAmount', () => {
  it.each([
    ['1500', 150000],
    ['1.234,56', 123456],
    ['1234.56', 123456],
    ['1234,5', 123450],
    ['1.500', 150000],
    ['12.345.678', 1234567800],
    ['0,99', 99],
    ['25 €', 2500],
    ['-300', -30000],
    ['1.5', 150],
  ])('%s → %i cents', (input, expected) => {
    expect(parseAmount(input)).toBe(expected);
  });

  it.each(['', '   ', 'abc', '1,234,56', '12,345', '1.2.3'])('rejects %j', input => {
    expect(parseAmount(input)).toBeNull();
  });

  it('round-trips through centsToInput', () => {
    expect(parseAmount(centsToInput(123456))).toBe(123456);
  });
});

describe('month helpers', () => {
  it('shifts across years', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
  });

  it('finds the last day of the month', () => {
    expect(lastDayOfMonth('2028-02')).toBe('2028-02-29');
    expect(lastDayOfMonth('2026-10')).toBe('2026-10-31');
  });
});
