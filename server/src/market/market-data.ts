import YahooFinance from 'yahoo-finance2';
import { addDays, toIsoDate, type InstrumentSearchResult } from '@budget/shared';

export interface Quote {
  symbol: string;
  name: string;
  /** Όπως το δίνει το Yahoo (π.χ. "USD", "GBp") */
  currency: string | undefined;
  price: number;
  /** Μεταβολή από το χθεσινό κλείσιμο */
  change: number;
  /** Ημερομηνία της τιμής (YYYY-MM-DD) */
  date: string;
}

export interface Close {
  date: string;
  close: number;
}

/** Πηγή τιμών. Στα tests αντικαθίσταται με fake, ώστε να μη γίνονται κλήσεις στο δίκτυο. */
export interface MarketData {
  /** Τρέχουσες τιμές. Τα σύμβολα που δεν βρέθηκαν απλώς λείπουν από το αποτέλεσμα. */
  quotes(symbols: string[]): Promise<Quote[]>;
  /** Τιμές κλεισίματος στο διάστημα [from, to], στο νόμισμα `currency` (όπως το δίνει το Yahoo) */
  history(symbol: string, from: string, to: string): Promise<{ currency: string | undefined; closes: Close[] }>;
  search(query: string): Promise<InstrumentSearchResult[]>;
}

const SEARCH_TYPES = new Set(['EQUITY', 'ETF']);

export function yahooMarketData(): MarketData {
  const yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] });
  return {
    async quotes(symbols) {
      if (symbols.length === 0) return [];
      const rows = await yf.quote(symbols, { return: 'array' });
      return rows.flatMap(q =>
        q.regularMarketPrice == null
          ? []
          : [{
              symbol: q.symbol,
              name: q.longName ?? q.shortName ?? q.symbol,
              currency: q.currency,
              price: q.regularMarketPrice,
              change: q.regularMarketChange ?? 0,
              date: toIsoDate(q.regularMarketTime ?? new Date()),
            }]);
    },
    async history(symbol, from, to) {
      const chart = await yf.chart(symbol, { period1: from, period2: addDays(to, 1), interval: '1d' });
      return {
        currency: chart.meta.currency,
        closes: chart.quotes.flatMap(q => (q.close == null ? [] : [{ date: q.date.toISOString().slice(0, 10), close: q.close }])),
      };
    },
    async search(query) {
      const result = await yf.search(query, { quotesCount: 10, newsCount: 0 });
      return result.quotes.flatMap(q =>
        'symbol' in q && typeof q.symbol === 'string' && SEARCH_TYPES.has(String(q.quoteType))
          ? [{
              ticker: q.symbol,
              name: String(('longname' in q && q.longname) || ('shortname' in q && q.shortname) || q.symbol),
              exchange: String(('exchDisp' in q && q.exchDisp) || ('exchange' in q && q.exchange) || ''),
              type: String(q.quoteType),
            }]
          : []);
    },
  };
}
