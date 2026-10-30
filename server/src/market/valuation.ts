import { computeHoldings, valueCents, type Trade } from '@budget/shared';
import type { Db } from '../db/index.ts';
import { instruments } from '../db/schema.ts';
import type { Prices } from './prices.ts';

/**
 * Αξία όλων των θέσεων σε μια ημερομηνία (cents), με τις τιμές κλεισίματος εκείνης της μέρας.
 * Αν λείπει τιμή, η θέση μετράει με το κόστος της (`incomplete`), για να μη φανεί ψεύτικη πτώση.
 */
export async function valueAt(db: Db, prices: Prices, allTrades: Trade[], date: string) {
  const holdings = computeHoldings(allTrades, date);
  if (holdings.length === 0) return { value: 0, incomplete: false };
  const byId = new Map(db.select().from(instruments).all().map(i => [i.id, i]));
  const points = await Promise.all(holdings.map(h => prices.priceOn(byId.get(h.instrumentId)!, date)));
  let value = 0;
  let incomplete = false;
  holdings.forEach((h, i) => {
    const p = points[i];
    if (p) value += valueCents(h.quantity, p.priceEur);
    else {
      value += h.costEur;
      incomplete = true;
    }
  });
  return { value, incomplete };
}

/**
 * Αξία των αρχικών θέσεων την ημέρα που μπήκαν. Μετράει σαν «εισροή» στη μεταβολή αξίας του μήνα:
 * οι μετοχές υπήρχαν ήδη, οπότε δεν πρέπει να φανούν ως κέρδος (ούτε το κόστος τους, που είναι παλιό).
 */
export async function openingsValue(db: Db, prices: Prices, openings: Trade[]) {
  const byId = new Map(db.select().from(instruments).all().map(i => [i.id, i]));
  const points = await Promise.all(openings.map(t => prices.priceOn(byId.get(t.instrumentId)!, t.date)));
  let value = 0;
  let incomplete = false;
  openings.forEach((t, i) => {
    const p = points[i];
    if (p) value += valueCents(t.quantity, p.priceEur);
    else {
      value += t.amountEur;
      incomplete = true;
    }
  });
  return { value, incomplete };
}

/**
 * Αξία των θέσεων σε πολλές ημερομηνίες (π.χ. τέλη μηνών). Πρώτα φέρνει με λίγες κλήσεις όσες τιμές
 * λείπουν από τη βάση (μία ανά μετοχή), μετά υπολογίζει κάθε ημερομηνία.
 */
export async function valuesAt(db: Db, prices: Prices, allTrades: Trade[], dates: string[]) {
  const byId = new Map(db.select().from(instruments).all().map(i => [i.id, i]));
  const needed = dates.flatMap(date =>
    computeHoldings(allTrades, date).map(h => ({ instrument: byId.get(h.instrumentId)!, date })));
  await prices.prefetch(needed);
  const entries = await Promise.all(dates.map(async date => [date, await valueAt(db, prices, allTrades, date)] as const));
  return new Map(entries);
}
