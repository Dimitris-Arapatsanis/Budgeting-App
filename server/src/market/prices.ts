import { and, desc, eq, gte, lte } from 'drizzle-orm';
import { addDays, fxTicker, normalizeCurrency, toEur, today, type Instrument, type PricePoint } from '@budget/shared';
import type { Db } from '../db/index.ts';
import { fxCache, priceCache } from '../db/schema.ts';
import type { MarketData, Quote } from './market-data.ts';

export interface LivePrice extends PricePoint {
  /** Μεταβολή της ημέρας ανά μετοχή, σε EUR */
  changeEur: number;
}

const QUOTE_TTL_MS = 15 * 60_000;
// Πόσες μέρες πίσω ψάχνουμε κλείσιμο (Σαββατοκύριακα, αργίες)
const LOOKBACK_DAYS = 7;

/**
 * Τιμές μετοχών και ισοτιμίες με cache:
 * - τρέχουσες τιμές στη μνήμη για 15 λεπτά (και η τελευταία γνωστή στη βάση, για όταν το Yahoo δεν απαντάει)
 * - ιστορικά κλεισίματα μόνιμα στη βάση
 */
export class Prices {
  private quoteCache = new Map<string, { at: number; quote: Quote }>();
  private triedHistory = new Set<string>();

  constructor(
    private db: Db,
    private market: MarketData,
  ) {}

  /** Τρέχουσες τιμές. Αν το Yahoo δεν απαντήσει, χρησιμοποιεί την τελευταία γνωστή τιμή και `stale = true`. */
  async latest(instruments: Instrument[]): Promise<{ prices: Map<number, LivePrice>; stale: boolean }> {
    const currencies = [...new Set(instruments.map(i => i.currency).filter(c => c !== 'EUR'))];
    const quotes = await this.fetchQuotes([...instruments.map(i => i.ticker), ...currencies.map(fxTicker)]);
    let stale = !quotes.ok;

    const fx = new Map<string, number>([['EUR', 1]]);
    for (const currency of currencies) {
      const quote = quotes.bySymbol.get(fxTicker(currency));
      if (quote) {
        this.saveFx(currency, quote.date, quote.price);
        fx.set(currency, quote.price);
      } else {
        const cached = this.cachedFx(currency, today(), Infinity);
        if (cached) fx.set(currency, cached.rate);
        stale = true;
      }
    }

    const prices = new Map<number, LivePrice>();
    for (const instrument of instruments) {
      const fxRate = fx.get(instrument.currency);
      const quote = quotes.bySymbol.get(instrument.ticker);
      if (quote) {
        const { factor } = normalizeCurrency(quote.currency);
        const price = quote.price * factor;
        this.savePrice(instrument, quote.date, price);
        if (fxRate) {
          prices.set(instrument.id, {
            price, currency: instrument.currency, fxRate, priceEur: toEur(price, fxRate), date: quote.date,
            changeEur: toEur(quote.change * factor, fxRate),
          });
        }
        continue;
      }
      stale = true;
      const cached = this.cachedPrice(instrument.id, today(), Infinity);
      if (cached && fxRate) {
        prices.set(instrument.id, {
          price: cached.close, currency: instrument.currency, fxRate, priceEur: toEur(cached.close, fxRate), date: cached.date,
          changeEur: 0,
        });
      }
    }
    return { prices, stale };
  }

  /** Τιμή σε μια ημερομηνία: το κλείσιμο της ημέρας ή της τελευταίας ημέρας συναλλαγών πριν από αυτήν. */
  async priceOn(instrument: Instrument, date: string): Promise<PricePoint | null> {
    if (date >= today()) {
      const { prices } = await this.latest([instrument]);
      return prices.get(instrument.id) ?? null;
    }
    const [close, fxRate] = await Promise.all([this.closeOn(instrument, date), this.fxOn(instrument.currency, date)]);
    if (!close || !fxRate) return null;
    return { price: close.close, currency: instrument.currency, fxRate, priceEur: toEur(close.close, fxRate), date: close.date };
  }

  private async closeOn(instrument: Instrument, date: string) {
    const cached = this.cachedPrice(instrument.id, date);
    if (cached) return cached;
    const { currency, closes } = await this.fetchHistory(instrument.ticker, date);
    const { factor } = normalizeCurrency(currency);
    for (const c of closes) this.savePrice(instrument, c.date, c.close * factor);
    return this.cachedPrice(instrument.id, date);
  }

  private async fxOn(currency: string, date: string): Promise<number | null> {
    if (currency === 'EUR') return 1;
    const cached = this.cachedFx(currency, date);
    if (cached) return cached.rate;
    for (const c of (await this.fetchHistory(fxTicker(currency), date)).closes) this.saveFx(currency, c.date, c.close);
    return this.cachedFx(currency, date)?.rate ?? null;
  }

  private async fetchQuotes(symbols: string[]) {
    const bySymbol = new Map<string, Quote>();
    const now = Date.now();
    const missing = symbols.filter(s => {
      const hit = this.quoteCache.get(s);
      if (hit && now - hit.at < QUOTE_TTL_MS) bySymbol.set(s, hit.quote);
      return !bySymbol.has(s);
    });
    if (missing.length === 0) return { bySymbol, ok: true };
    try {
      for (const quote of await this.market.quotes(missing)) {
        this.quoteCache.set(quote.symbol, { at: now, quote });
        bySymbol.set(quote.symbol, quote);
      }
      return { bySymbol, ok: true };
    } catch {
      return { bySymbol, ok: false };
    }
  }

  /** Κλεισίματα γύρω από μια ημερομηνία. Κάθε διάστημα ζητείται μία φορά ανά εκκίνηση του server. */
  private async fetchHistory(symbol: string, date: string) {
    const key = `${symbol}:${date}`;
    const empty = { currency: undefined, closes: [] };
    if (this.triedHistory.has(key)) return empty;
    try {
      const result = await this.market.history(symbol, addDays(date, -LOOKBACK_DAYS - 3), date);
      this.triedHistory.add(key);
      return result;
    } catch {
      return empty;
    }
  }

  private cachedPrice(instrumentId: number, date: string, lookback = LOOKBACK_DAYS) {
    const from = Number.isFinite(lookback) ? addDays(date, -lookback) : '0000-00-00';
    return this.db.select().from(priceCache)
      .where(and(eq(priceCache.instrumentId, instrumentId), lte(priceCache.date, date), gte(priceCache.date, from)))
      .orderBy(desc(priceCache.date)).limit(1).get();
  }

  private cachedFx(currency: string, date: string, lookback = LOOKBACK_DAYS) {
    const from = Number.isFinite(lookback) ? addDays(date, -lookback) : '0000-00-00';
    return this.db.select().from(fxCache)
      .where(and(eq(fxCache.pair, `EUR${currency}`), lte(fxCache.date, date), gte(fxCache.date, from)))
      .orderBy(desc(fxCache.date)).limit(1).get();
  }

  // Η τελευταία τιμή μιας μέρας αντικαθιστά την προηγούμενη (ενδοημερήσια → κλείσιμο)
  private savePrice(instrument: Instrument, date: string, close: number) {
    this.db.insert(priceCache).values({ instrumentId: instrument.id, date, close, currency: instrument.currency })
      .onConflictDoUpdate({ target: [priceCache.instrumentId, priceCache.date], set: { close } }).run();
  }

  private saveFx(currency: string, date: string, rate: number) {
    this.db.insert(fxCache).values({ pair: `EUR${currency}`, date, rate })
      .onConflictDoUpdate({ target: [fxCache.pair, fxCache.date], set: { rate } }).run();
  }
}
