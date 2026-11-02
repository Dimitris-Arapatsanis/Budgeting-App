import { and, eq, sum } from 'drizzle-orm';
import type { Db } from './db/index.ts';
import { categories, trades, transactions } from './db/schema.ts';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export const FEE_CATEGORY = 'Χρεώσεις';

/** Η κατηγορία εξόδων «Χρεώσεις». Αν ο χρήστης την έσβησε, ξαναφτιάχνεται. */
function feeCategoryId(tx: Tx): number {
  const existing = tx.select({ id: categories.id }).from(categories)
    .where(and(eq(categories.name, FEE_CATEGORY), eq(categories.kind, 'expense'))).get();
  if (existing) return existing.id;
  return tx.insert(categories).values({ name: FEE_CATEGORY, kind: 'expense', icon: 'landmark', color: 'red' })
    .returning({ id: categories.id }).get().id;
}

interface FeeParent {
  id: number;
  date: string;
  type: string;
  accountId: number;
  categoryId?: number | null;
  description: string;
}

/**
 * Η χρέωση (fee) μιας συναλλαγής: ξεχωριστό έξοδο στην κατηγορία «Χρεώσεις», από τον ίδιο λογαριασμό και την
 * ίδια μέρα, συνδεδεμένο με `feeForId`. 0 = χωρίς χρέωση (σβήνεται αν υπήρχε).
 */
export function setFee(tx: Tx, parent: FeeParent, amount: number) {
  const existing = tx.select({ id: transactions.id }).from(transactions).where(eq(transactions.feeForId, parent.id)).get();
  if (amount <= 0) {
    if (existing) tx.delete(transactions).where(eq(transactions.id, existing.id)).run();
    return;
  }
  // Σε τι ανήκει η χρέωση: η περιγραφή της συναλλαγής, αλλιώς «Μεταφορά» ή η κατηγορία του εξόδου
  const category = parent.categoryId != null
    ? tx.select({ name: categories.name }).from(categories).where(eq(categories.id, parent.categoryId)).get()?.name
    : undefined;
  const description = parent.description || (parent.type === 'transfer' ? 'Μεταφορά' : category ?? '');
  const row = {
    date: parent.date,
    type: 'expense' as const,
    amount,
    accountId: parent.accountId,
    toAccountId: null,
    description,
    feeForId: parent.id,
  };
  if (existing) {
    tx.update(transactions).set(row).where(eq(transactions.id, existing.id)).run();
  } else {
    tx.insert(transactions).values({ ...row, categoryId: feeCategoryId(tx) }).run();
  }
}

export function deleteFee(tx: Tx, parentId: number) {
  tx.delete(transactions).where(eq(transactions.feeForId, parentId)).run();
}

/** Η χρέωση μιας μεταφοράς «Χρήματα από» = το άθροισμα των `fundingFee` των αγορών που χρηματοδοτεί. */
export function syncFundingFee(tx: Tx, transferId: number) {
  const transfer = tx.select().from(transactions).where(eq(transactions.id, transferId)).get();
  if (!transfer) return;
  const total = tx.select({ total: sum(trades.fundingFee) }).from(trades).where(eq(trades.fundingTransactionId, transferId)).get();
  setFee(tx, transfer, Number(total?.total ?? 0));
}
