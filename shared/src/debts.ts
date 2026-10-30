import type { Debt, DebtDirection, DebtPayment, Transaction } from './schemas.ts';

export interface DebtRow {
  id: number;
  direction: DebtDirection;
  person: string;
  reason: string;
  date: string;
}

/** Η συναλλαγή που ανοίγει ένα χρωστούμενο: μεταφορά από/προς λογαριασμό, ή διόρθωση για παλιό χρέος. */
export function isDebtOpening(t: Transaction, direction: DebtDirection, debtAccountId: number) {
  if (t.type === 'adjustment') return t.accountId === debtAccountId;
  return t.type === 'transfer' && (direction === 'lent' ? t.toAccountId === debtAccountId : t.accountId === debtAccountId);
}

/**
 * Ένα χρωστούμενο είναι συναλλαγές με τον λογαριασμό συστήματος (`debtAccountId`):
 * - δάνεισα: μεταφορά λογαριασμός → «Μου χρωστάνε», επιστροφή = μεταφορά πίσω, χαρίστηκε = έξοδο από το «Μου χρωστάνε»
 * - δανείστηκα: μεταφορά «Χρωστάω» → λογαριασμός, επιστροφή = μεταφορά λογαριασμός → «Χρωστάω», χαρίστηκε = έσοδο στο «Χρωστάω»
 * Παλιό χρέος (υπήρχε πριν ξεκινήσει ο χρήστης): το άνοιγμα είναι διόρθωση (adjustment) στον λογαριασμό
 * συστήματος, ώστε να μη φύγουν λεφτά από κανέναν λογαριασμό και να μη μετρήσει πουθενά ως κίνηση.
 * Το `transactions` πρέπει να περιέχει μόνο τις συναλλαγές αυτού του χρωστούμενου.
 */
export function buildDebt(row: DebtRow, transactions: Transaction[], debtAccountId: number): Debt | null {
  const lent = row.direction === 'lent';
  const opening = transactions.find(t => isDebtOpening(t, row.direction, debtAccountId));
  if (!opening) return null;

  const payments: DebtPayment[] = transactions
    .filter(t => t !== opening)
    .map(t => ({
      transactionId: t.id,
      date: t.date,
      amount: t.amount,
      accountId: t.type === 'transfer' ? (lent ? t.toAccountId : t.accountId) : null,
      kind: t.type === 'transfer' ? 'payment' as const : 'forgiven' as const,
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.transactionId - b.transactionId);
  const settled = payments.reduce((sum, p) => sum + p.amount, 0);

  return {
    ...row,
    amount: Math.abs(opening.amount),
    accountId: opening.type === 'adjustment' ? null : lent ? opening.accountId : opening.toAccountId!,
    settled,
    outstanding: Math.abs(opening.amount) - settled,
    payments,
  };
}
