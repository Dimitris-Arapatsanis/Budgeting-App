import { describe, expect, it } from 'vitest';
import { dueDateIn } from './recurring.ts';

const monthly = { active: true, frequency: 'monthly' as const, day: 1, month: null, startDate: '2026-01-01', endDate: null };

describe('dueDateIn', () => {
  it('returns the day of the month for monthly rules', () => {
    expect(dueDateIn(monthly, '2026-10')).toBe('2026-10-01');
    expect(dueDateIn({ ...monthly, day: 22 }, '2026-11')).toBe('2026-11-22');
  });

  it('uses the last day when the month is shorter', () => {
    expect(dueDateIn({ ...monthly, day: 31 }, '2026-02')).toBe('2026-02-28');
    expect(dueDateIn({ ...monthly, day: 31 }, '2028-02')).toBe('2028-02-29');
    expect(dueDateIn({ ...monthly, day: 31 }, '2026-04')).toBe('2026-04-30');
  });

  it('respects start date, end date and pause', () => {
    const rule = { ...monthly, day: 10, startDate: '2026-10-15', endDate: '2027-01-10' };
    expect(dueDateIn(rule, '2026-10')).toBeNull(); // 10/10 είναι πριν την έναρξη
    expect(dueDateIn(rule, '2026-11')).toBe('2026-11-10');
    expect(dueDateIn(rule, '2027-01')).toBe('2027-01-10');
    expect(dueDateIn(rule, '2027-02')).toBeNull();
    expect(dueDateIn({ ...rule, active: false }, '2026-11')).toBeNull();
  });

  it('yearly rules are due only in their month', () => {
    const yearly = { ...monthly, frequency: 'yearly' as const, day: 15, month: 3 };
    expect(dueDateIn(yearly, '2026-03')).toBe('2026-03-15');
    expect(dueDateIn(yearly, '2026-04')).toBeNull();
    expect(dueDateIn(yearly, '2027-03')).toBe('2027-03-15');
  });
});
