import type { PieSlice, Trade } from './schemas.ts';

export interface Holding {
  accountId: number;
  instrumentId: number;
  quantity: number;
  /** Κόστος κτήσης σε cents (μέση τιμή) */
  costEur: number;
}

// Οι ποσότητες είναι δεκαδικές: στρογγυλεύουμε για να μη μένουν υπόλοιπα τύπου 1e-12
const QTY_DECIMALS = 8;
export const roundQuantity = (q: number) => Number(q.toFixed(QTY_DECIMALS));

/**
 * Θέσεις ανά (λογαριασμό, μετοχή) από τα trades μέχρι και την ημερομηνία `until`.
 * Κόστος με μέση τιμή: η πώληση αφαιρεί κόστος ανάλογα με την ποσότητα που πουλήθηκε.
 * Επιστρέφει μόνο θέσεις με ποσότητα > 0.
 */
export function computeHoldings(trades: Trade[], until?: string): Holding[] {
  const sorted = trades.filter(t => !until || t.date <= until).sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  const map = new Map<string, Holding>();
  for (const t of sorted) {
    const key = `${t.accountId}:${t.instrumentId}`;
    const h = map.get(key) ?? { accountId: t.accountId, instrumentId: t.instrumentId, quantity: 0, costEur: 0 };
    if (t.side === 'sell') {
      const sold = Math.min(t.quantity, h.quantity);
      h.costEur -= h.quantity > 0 ? Math.round((h.costEur * sold) / h.quantity) : 0;
      h.quantity = roundQuantity(h.quantity - sold);
    } else {
      h.quantity = roundQuantity(h.quantity + t.quantity);
      h.costEur += t.amountEur;
    }
    map.set(key, h);
  }
  return [...map.values()].filter(h => h.quantity > 0);
}

/**
 * Μοιράζει ένα ποσό (cents) στα κομμάτια του pie με βάση το ποσοστό-στόχο.
 * Μέθοδος μεγαλύτερου υπολοίπου, ώστε το άθροισμα να είναι ακριβώς το ποσό.
 */
export function splitPieAmount(amountEur: number, slices: PieSlice[]): number[] {
  const total = slices.reduce((sum, s) => sum + s.targetPercent, 0);
  const exact = slices.map(s => (amountEur * s.targetPercent) / total);
  const result = exact.map(Math.floor);
  let rest = amountEur - result.reduce((a, b) => a + b, 0);
  const order = exact.map((v, i) => [v - Math.floor(v), i] as const).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) {
    if (rest <= 0) break;
    result[i]! += 1;
    rest -= 1;
  }
  return result;
}

/**
 * Κανονικοποιεί το νόμισμα του Yahoo. Οι μετοχές του Λονδίνου έχουν τιμή σε πένες (GBp/GBX):
 * τότε η τιμή διαιρείται με 100 και το νόμισμα γίνεται GBP.
 */
export function normalizeCurrency(currency: string | undefined): { currency: string; factor: number } {
  if (currency === 'GBp' || currency === 'GBX') return { currency: 'GBP', factor: 0.01 };
  return { currency: (currency ?? 'EUR').toUpperCase(), factor: 1 };
}

/** Yahoo symbol της ισοτιμίας: μονάδες `currency` ανά 1 EUR. */
export const fxTicker = (currency: string) => `EUR${currency}=X`;

/** Τιμή σε άλλο νόμισμα → EUR. `fxRate` = μονάδες νομίσματος ανά 1 EUR. */
export const toEur = (price: number, fxRate: number) => price / fxRate;

/** Αξία σε cents: ποσότητα × τιμή σε EUR. */
export const valueCents = (quantity: number, priceEur: number) => Math.round(quantity * priceEur * 100);

/** Πόσες μετοχές αγοράζει ένα ποσό (cents) σε τιμή EUR. */
export const quantityFor = (amountEur: number, priceEur: number) => roundQuantity(amountEur / 100 / priceEur);
