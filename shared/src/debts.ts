import type { Debt, DebtDirection, DebtPayment, Transaction } from './schemas.ts';

export interface DebtRow {
  id: number;
  direction: DebtDirection;
  person: string;
  reason: string;
  date: string;
}

/**
 * Ένα χρωστούμενο είναι συναλλαγές με τον λογαριασμό συστήματος (`debtAccountId`):
 * - δάνεισα: μεταφορά λογαριασμός → «Μου χρωστάνε», επιστροφή = μεταφορά πίσω, χαρίστηκε = έξοδο από το «Μου χρωστάνε»
 * - δανείστηκα: μεταφορά «Χρωστάω» → λογαριασμός, επιστροφή = μεταφορά λογαριασμός → «Χρωστάω», χαρίστηκε = έσοδο στο «Χρωστάω»
 * Το `transactions` πρέπει να περιέχει μόνο τις συναλλαγές αυτού του χρωστούμενου.
 */
export function buildDebt(row: DebtRow, transactions: Transaction[], debtAccountId: number): Debt | null {
  const lent = row.direction === 'lent';
  const isOpening = (t: Transaction) =>
    t.type === 'transfer' && (lent ? t.toAccountId === debtAccountId : t.accountId === debtAccountId);
  const opening = transactions.find(isOpening);
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
    amount: opening.amount,
    accountId: lent ? opening.accountId : opening.toAccountId!,
    settled,
    outstanding: opening.amount - settled,
    payments,
  };
}
