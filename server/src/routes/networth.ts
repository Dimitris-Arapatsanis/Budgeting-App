import type { FastifyInstance } from 'fastify';
import {
  asStartingPoint,
  computeBalances,
  computeNetWorthMonths,
  currentMonth,
  firstActivityDate,
  monthRange,
  monthValuationDate,
  netWorthBreakdown,
  summarizeNetWorthYears,
  today,
  type NetWorthHistory,
} from '@budget/shared';
import type { Db } from '../db/index.ts';
import { accounts, transactions } from '../db/schema.ts';
import type { Prices } from '../market/prices.ts';
import { valuesAt } from '../market/valuation.ts';
import { listTrades } from './investments.ts';

export function netWorthRoutes(app: FastifyInstance, db: Db, prices: Prices) {
  // Όλη η πορεία: ανά μήνα (από τον πρώτο με κινήσεις), ανά έτος, και σήμερα
  app.get('/api/networth', async (): Promise<NetWorthHistory> => {
    const allAccounts = db.select().from(accounts).all();
    const allTransactions = db.select().from(transactions).all();
    const allTrades = listTrades(db);
    const now = today();
    const startDate = firstActivityDate(allTransactions, allTrades);

    if (!startDate) {
      const current = netWorthBreakdown(allAccounts, computeBalances(allAccounts, []), 0);
      return { months: [], years: [], current, since: null };
    }

    const since = startDate.slice(0, 7);
    const months = monthRange(since, currentMonth());
    // Αφετηρία: οι τιμές της ημέρας έναρξης, και μετά το τέλος κάθε μήνα
    const dates = [startDate, ...months.map(m => monthValuationDate(m, now))];
    // Οι αρχικές θέσεις είναι αφετηρία: αποτιμώνται σαν να υπήρχαν από την αρχή της πορείας
    const stockValues = await valuesAt(db, prices, asStartingPoint(allTrades), dates);
    const result = computeNetWorthMonths(allAccounts, allTransactions, allTrades, months, now, startDate, stockValues);
    return { months: result, years: summarizeNetWorthYears(result), current: result.at(-1)!.end, since };
  });
}
