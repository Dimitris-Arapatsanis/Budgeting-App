import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { AccountType, CategoryColor, CategoryIcon, CategoryKind } from '@budget/shared';
import * as schema from './schema.ts';

/**
 * Τι υπάρχει σε μια καινούργια βάση. `default`: γενικά (μία τράπεζα και μετρητά, χωρίς μετοχές), ώστε ο κάθε
 * χρήστης να προσθέσει τα δικά του στον οδηγό «Ξεκίνα». `demo`: οι λογαριασμοί, οι μετοχές και το pie
 * του αρχικού χρήστη, για τα tests.
 */
export type SeedProfile = 'default' | 'demo';

// Υπόλοιπα 0: τα πραγματικά ποσά τα βάζει ο χρήστης μέσα από την εφαρμογή.
const ACCOUNTS: Record<SeedProfile, Array<{ name: string; type: AccountType }>> = {
  default: [
    { name: 'Τράπεζα', type: 'bank' },
    { name: 'Μετρητά', type: 'cash' },
  ],
  demo: [
  { name: 'Τράπεζα Πειραιώς', type: 'bank' },
  { name: 'Alpha Bank', type: 'savings' },
  { name: 'Μετρητά', type: 'cash' },
  { name: 'Revolut', type: 'broker' },
  { name: 'Trading 212', type: 'broker' },
  ],
};

type CategorySeed = [name: string, icon: CategoryIcon, color: CategoryColor];

// Ίδιες τιμές με το UPDATE του migration 0001, για βάσεις που υπήρχαν πριν μπουν εικονίδια/χρώματα
export const DEFAULT_CATEGORIES: Record<CategoryKind, CategorySeed[]> = {
  income: [
    ['Μισθός', 'briefcase', 'green'],
    ['Bonus', 'gift', 'emerald'],
    ['Τόκοι/Μερίσματα', 'trending-up', 'teal'],
    ['Άλλα έσοδα', 'dollar', 'blue'],
  ],
  expense: [
    ['Στέγαση', 'house', 'indigo'],
    ['Σούπερ μάρκετ', 'shopping-cart', 'emerald'],
    ['Λογαριασμοί', 'zap', 'amber'],
    ['Μεταφορές', 'car', 'blue'],
    ['Φαγητό έξω', 'utensils', 'orange'],
    ['Διασκέδαση', 'clapperboard', 'violet'],
    ['Υγεία', 'heart-pulse', 'red'],
    ['Ρούχα', 'shirt', 'pink'],
    ['Συνδρομές', 'repeat', 'teal'],
    ['Ταξίδια', 'plane', 'brown'],
    ['Άλλα', 'tag', 'slate'],
  ],
};

// Μετοχές/ETF και η σύνθεση του pie στο Trading 212 (ποσοστά-στόχοι, όχι ποσά)
const DEFAULT_INSTRUMENTS: Array<{ ticker: string; name: string; currency: string; piePercent?: number }> = [
  { ticker: 'VUSA.AS', name: 'Vanguard S&P 500 (VUSA)', currency: 'EUR' },
  { ticker: 'MSFT', name: 'Microsoft', currency: 'USD', piePercent: 15 },
  { ticker: 'NVDA', name: 'NVIDIA', currency: 'USD', piePercent: 15 },
  { ticker: 'AMZN', name: 'Amazon', currency: 'USD', piePercent: 14 },
  { ticker: 'AAPL', name: 'Apple', currency: 'USD', piePercent: 14 },
  { ticker: 'GOOGL', name: 'Alphabet (Class A)', currency: 'USD', piePercent: 12 },
  { ticker: 'AMD', name: 'AMD', currency: 'USD', piePercent: 10 },
  { ticker: 'INTC', name: 'Intel', currency: 'USD', piePercent: 8 },
  { ticker: 'META', name: 'Meta', currency: 'USD', piePercent: 7 },
  { ticker: 'TSLA', name: 'Tesla', currency: 'USD', piePercent: 5 },
];

/** Γεμίζει λογαριασμούς και κατηγορίες μόνο αν οι πίνακες είναι άδειοι (πρώτο τρέξιμο). */
export function seed(db: BetterSQLite3Database<typeof schema>, profile: SeedProfile = 'default') {
  if (!db.select().from(schema.accounts).limit(1).get()) {
    db.insert(schema.accounts)
      .values(ACCOUNTS[profile].map((a, i) => ({ ...a, initialBalance: 0, sortOrder: i })))
      .run();
  }
  if (!db.select().from(schema.categories).limit(1).get()) {
    const rows = Object.entries(DEFAULT_CATEGORIES).flatMap(([kind, items]) =>
      items.map(([name, icon, color]) => ({ name, kind: kind as CategoryKind, icon, color })));
    db.insert(schema.categories).values(rows).run();
  }
  if (profile === 'demo' && !db.select().from(schema.instruments).limit(1).get()) {
    const rows = db.insert(schema.instruments)
      .values(DEFAULT_INSTRUMENTS.map(({ ticker, name, currency }) => ({ ticker, name, currency })))
      .returning().all();
    const t212 = db.select().from(schema.accounts).where(eq(schema.accounts.name, 'Trading 212')).get();
    if (t212 && !db.select().from(schema.pies).limit(1).get()) {
      const pie = db.insert(schema.pies).values({ name: 'Pie', accountId: t212.id }).returning().get();
      db.insert(schema.pieSlices).values(DEFAULT_INSTRUMENTS.flatMap((d, i) =>
        d.piePercent ? [{ pieId: pie.id, instrumentId: rows[i]!.id, targetPercent: d.piePercent }] : [])).run();
    }
  }
}
