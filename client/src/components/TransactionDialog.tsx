import { useEffect, useState, type FormEvent } from 'react';
import {
  centsToInput,
  isDebtAccount,
  parseAmount,
  today,
  type AccountWithBalance,
  type Category,
  type Transaction,
  type TransactionInput,
} from '@budget/shared';
import { AccountSelect } from '@/components/AccountSelect';
import { AmountInput } from '@/components/AmountInput';
import { Field } from '@/components/Field';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAccounts, useCategories, useDeleteTransaction, useSaveTransaction } from '@/lib/api';
import { cn } from '@/lib/utils';

type EditableType = 'expense' | 'income' | 'transfer';

const TYPE_TABS: Array<{ value: EditableType; label: string }> = [
  { value: 'expense', label: 'Έξοδο' },
  { value: 'income', label: 'Έσοδο' },
  { value: 'transfer', label: 'Μεταφορά' },
];

interface FormState {
  type: EditableType;
  amount: string;
  date: string;
  accountId: string;
  toAccountId: string;
  categoryId: string;
  description: string;
}

function initialState(
  transaction: Transaction | undefined,
  defaultDate: string,
  accounts: AccountWithBalance[],
  categories: Category[],
): FormState {
  const active = accounts.filter(a => !a.archived && !isDebtAccount(a));
  const mainAccount = active.find(a => a.type === 'bank') ?? active[0];
  const savingsAccount = active.find(a => a.type === 'savings' && a.id !== mainAccount?.id);
  const firstCategory = (kind: 'income' | 'expense') => String(categories.find(c => c.kind === kind)?.id ?? '');

  if (transaction && transaction.type !== 'adjustment') {
    return {
      type: transaction.type,
      amount: centsToInput(transaction.amount),
      date: transaction.date,
      accountId: String(transaction.accountId),
      toAccountId: String(transaction.toAccountId ?? ''),
      categoryId: String(transaction.categoryId ?? firstCategory(transaction.type === 'income' ? 'income' : 'expense')),
      description: transaction.description,
    };
  }
  return {
    type: 'expense',
    amount: '',
    date: defaultDate,
    accountId: String(mainAccount?.id ?? ''),
    toAccountId: String(savingsAccount?.id ?? ''),
    categoryId: firstCategory('expense'),
    description: '',
  };
}

interface TransactionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Για επεξεργασία. Αν λείπει, δημιουργείται νέα συναλλαγή. */
  transaction?: Transaction;
  defaultDate?: string;
}

export function TransactionDialog({ open, onOpenChange, transaction, defaultDate = today() }: TransactionDialogProps) {
  const { data: accounts = [] } = useAccounts();
  const { data: categories = [] } = useCategories();
  const save = useSaveTransaction();
  const remove = useDeleteTransaction();
  const [form, setForm] = useState<FormState>(() => initialState(transaction, defaultDate, accounts, categories));
  const [error, setError] = useState<string | null>(null);

  // Επαναφορά της φόρμας κάθε φορά που ανοίγει (όχι όταν ανανεώνονται accounts/categories)
  useEffect(() => {
    if (open) {
      setForm(initialState(transaction, defaultDate, accounts, categories));
      setError(null);
    }
  }, [open, transaction]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm(f => ({ ...f, [key]: value }));

  const changeType = (type: EditableType) => {
    setForm(f => {
      if (type === 'transfer') return { ...f, type };
      const currentKind = categories.find(c => String(c.id) === f.categoryId)?.kind;
      const categoryId = currentKind === type ? f.categoryId : String(categories.find(c => c.kind === type)?.id ?? '');
      return { ...f, type, categoryId };
    });
  };

  const selectableAccounts = accounts.filter(a =>
    !isDebtAccount(a) && (!a.archived || String(a.id) === form.accountId || String(a.id) === form.toAccountId));
  const kindCategories = categories.filter(c => c.kind === (form.type === 'income' ? 'income' : 'expense'));

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const amount = parseAmount(form.amount);
    if (amount == null || amount <= 0) {
      setError('Γράψε ένα θετικό ποσό, π.χ. 25 ή 1.234,56');
      return;
    }
    const common = { date: form.date, amount, accountId: Number(form.accountId), description: form.description };
    const input: TransactionInput =
      form.type === 'transfer'
        ? { ...common, type: 'transfer', toAccountId: Number(form.toAccountId) }
        : { ...common, type: form.type, categoryId: Number(form.categoryId) };
    save.mutate({ id: transaction?.id, input }, { onSuccess: () => onOpenChange(false) });
  }

  function handleDelete() {
    if (transaction) remove.mutate(transaction, { onSuccess: () => onOpenChange(false) });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{transaction ? 'Επεξεργασία συναλλαγής' : 'Νέα συναλλαγή'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="grid gap-4">
          <div className="grid grid-cols-3 gap-1 rounded-full bg-muted p-1">
            {TYPE_TABS.map(tab => (
              <button
                key={tab.value}
                type="button"
                onClick={() => changeType(tab.value)}
                className={cn(
                  'rounded-full py-1.5 text-sm font-medium text-muted-foreground transition-colors',
                  form.type === tab.value && 'bg-card text-foreground shadow-soft dark:bg-accent',
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Ποσό" htmlFor="tx-amount">
              <AmountInput id="tx-amount" autoFocus value={form.amount} onChange={e => set('amount', e.target.value)} />
            </Field>
            <Field label="Ημερομηνία" htmlFor="tx-date">
              <Input id="tx-date" type="date" required value={form.date} onChange={e => set('date', e.target.value)} />
            </Field>
          </div>

          {form.type === 'transfer' ? (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Από">
                <AccountSelect accounts={selectableAccounts} value={form.accountId} onChange={v => set('accountId', v)} />
              </Field>
              <Field label="Προς">
                <AccountSelect accounts={selectableAccounts} value={form.toAccountId} onChange={v => set('toAccountId', v)} />
              </Field>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Κατηγορία">
                <Select value={form.categoryId} onValueChange={v => set('categoryId', v)}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="Επίλεξε" /></SelectTrigger>
                  <SelectContent>
                    {kindCategories.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label={form.type === 'expense' ? 'Πληρωμή με' : 'Σε λογαριασμό'}>
                <AccountSelect accounts={selectableAccounts} value={form.accountId} onChange={v => set('accountId', v)} />
              </Field>
            </div>
          )}

          <Field label="Περιγραφή" htmlFor="tx-description">
            <Input
              id="tx-description"
              placeholder="προαιρετικό"
              value={form.description}
              onChange={e => set('description', e.target.value)}
            />
          </Field>

          {error && <p className="text-sm text-negative">{error}</p>}

          <DialogFooter className="gap-2">
            {transaction && (
              <Button type="button" variant="ghost" className="mr-auto text-negative" onClick={handleDelete} disabled={remove.isPending}>
                Διαγραφή
              </Button>
            )}
            <Button type="submit" disabled={save.isPending}>Αποθήκευση</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
