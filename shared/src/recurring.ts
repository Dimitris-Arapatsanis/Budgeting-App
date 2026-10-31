import { lastDayOfMonth } from './month.ts';
import type { Recurring, RecurringKind } from './schemas.ts';

/**
 * Η λήξη ενός κανόνα μέσα σε έναν μήνα (YYYY-MM-DD), ή null αν δεν λήγει εκείνον τον μήνα.
 * Ημέρα πέρα από το τέλος του μήνα (π.χ. 31 τον Φεβρουάριο) = τελευταία μέρα του μήνα.
 * Η πρώτη λήξη είναι η πρώτη μετά ή την ίδια μέρα με την έναρξη, η τελευταία έως και τη λήξη του κανόνα.
 */
export function dueDateIn(rule: Pick<Recurring, 'active' | 'frequency' | 'day' | 'month' | 'startDate' | 'endDate'>, month: string): string | null {
  if (!rule.active) return null;
  if (rule.frequency === 'yearly' && Number(month.slice(5, 7)) !== rule.month) return null;
  const last = lastDayOfMonth(month);
  const day = Math.min(rule.day, Number(last.slice(8)));
  const due = `${month}-${String(day).padStart(2, '0')}`;
  if (due < rule.startDate) return null;
  if (rule.endDate && due > rule.endDate) return null;
  return due;
}

/** Πόσο επηρεάζει μια λήξη τα αναμενόμενα του μήνα: έσοδα θετικά, έξοδα αρνητικά, μεταφορές/αγορές 0. */
export function recurringEffect(rule: Pick<Recurring, 'kind' | 'amount'>): { income: number; expense: number } {
  const kind: RecurringKind = rule.kind;
  return { income: kind === 'income' ? rule.amount : 0, expense: kind === 'expense' ? rule.amount : 0 };
}
