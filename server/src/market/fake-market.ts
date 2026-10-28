import { today, type InstrumentSearchResult } from '@budget/shared';
import type { Close, MarketData, Quote } from './market-data.ts';

const QUOTES: Record<string, Omit<Quote, 'symbol' | 'date'>> = {
  'VUSA.AS': { name: 'Vanguard S&P 500 UCITS ETF', currency: 'EUR', price: 100, change: 1 },
  MSFT: { name: 'Microsoft Corporation', currency: 'USD', price: 220, change: 2.2 },
  'EURUSD=X': { name: 'EUR/USD', currency: 'USD', price: 1.1, change: 0 },
  'BARC.L': { name: 'Barclays PLC', currency: 'GBp', price: 250, change: 5 },
  'EURGBP=X': { name: 'EUR/GBP', currency: 'GBP', price: 0.8, change: 0 },
};
for (const t of ['NVDA', 'AMZN', 'AAPL', 'GOOGL', 'AMD', 'INTC', 'META', 'TSLA']) {
  QUOTES[t] = { name: t, currency: 'USD', price: 110, change: 0 };
}

const HISTORY: Record<string, { currency: string; closes: Close[] }> = {
  'VUSA.AS': { currency: 'EUR', closes: [{ date: '2026-07-31', close: 80 }, { date: '2026-08-14', close: 85 }, { date: '2026-08-31', close: 90 }] },
  // Το κλείσιμο του Αυγούστου είναι Παρασκευή 28/8: η τιμή της 31/8 βρίσκεται με lookback
  MSFT: { currency: 'USD', closes: [{ date: '2026-07-31', close: 200 }, { date: '2026-08-28', close: 210 }] },
  'EURUSD=X': { currency: 'USD', closes: [{ date: '2026-07-31', close: 1 }, { date: '2026-08-28', close: 1.05 }] },
};

/** Σταθερές τιμές για tests, χωρίς δίκτυο. Με `failing: true` προσομοιώνει ότι το Yahoo δεν απαντάει. */
export function fakeMarket(options: { failing?: () => boolean } = {}): MarketData & { calls: string[] } {
  const calls: string[] = [];
  const check = () => {
    if (options.failing?.()) throw new Error('offline');
  };
  return {
    calls,
    async quotes(symbols) {
      calls.push(`quotes:${symbols.join(',')}`);
      check();
      return symbols.flatMap(symbol => (QUOTES[symbol] ? [{ symbol, date: today(), ...QUOTES[symbol] }] : []));
    },
    async history(symbol, from, to) {
      calls.push(`history:${symbol}:${from}:${to}`);
      check();
      const h = HISTORY[symbol];
      return { currency: h?.currency, closes: (h?.closes ?? []).filter(c => c.date >= from && c.date <= to) };
    },
    async search(query): Promise<InstrumentSearchResult[]> {
      check();
      return query.toLowerCase().startsWith('barc') ? [{ ticker: 'BARC.L', name: 'Barclays PLC', exchange: 'LSE', type: 'EQUITY' }] : [];
    },
  };
}
