import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { AccountType, CategoryColor, CategoryIcon, CategoryKind } from '@budget/shared';
import * as schema from './schema.ts';

// Υπόλοιπα 0: τα πραγματικά ποσά τα βάζει ο χρήστης μέσα από την εφαρμογή.
const DEFAULT_ACCOUNTS: Array<{ name: string; type: AccountType }> = [
  { name: 'Τράπεζα Πειραιώς', type: 'bank' },
  { name: 'Alpha Bank', type: 'savings' },
  { name: 'Revolut', type: 'broker' },
  { name: 'Trading 212', type: 'broker' },
];

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

/** Γεμίζει λογαριασμούς και κατηγορίες μόνο αν οι πίνακες είναι άδειοι (πρώτο τρέξιμο). */
export function seed(db: BetterSQLite3Database<typeof schema>) {
  if (!db.select().from(schema.accounts).limit(1).get()) {
    db.insert(schema.accounts)
      .values(DEFAULT_ACCOUNTS.map((a, i) => ({ ...a, initialBalance: 0, sortOrder: i })))
      .run();
  }
  if (!db.select().from(schema.categories).limit(1).get()) {
    const rows = Object.entries(DEFAULT_CATEGORIES).flatMap(([kind, items]) =>
      items.map(([name, icon, color]) => ({ name, kind: kind as CategoryKind, icon, color })));
    db.insert(schema.categories).values(rows).run();
  }
}
