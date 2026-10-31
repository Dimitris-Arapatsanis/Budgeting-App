import { useEffect, useState, type FormEvent } from 'react';
import {
  centsToInput,
  isDebtAccount,
  parseAmount,
  today,
  type AccountWithBalance,
  type Category,
  type RecurringFrequency,
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
import { useAccounts, useCategories, useDeleteTransaction, useSaveRecurring, useSaveTransaction } from '@/lib/api';
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

/** Νέα συναλλαγή συμπληρωμένη από κανόνα επανάληψης (✓ στα «Αναμένονται»). */
export interface TransactionTemplate {
  type: EditableType;
  amount: number;
  date: string;
  accountId: number;
  toAccountId: number | null;
  categoryId: number | null;
  description: string;
  recurringId: number;
  recurringDue: string;
}

function initialState(
  transaction: Transaction | undefined,
  defaultDate: string,
  accounts: AccountWithBalance[],
  categories: Category[],
  template?: TransactionTemplate,
): FormState {
  const active = accounts.filter(a => !a.archived && !isDebtAccount(a));
  const mainAccount = active.find(a => a.type === 'bank') ?? active[0];
  const savingsAccount = active.find(a => a.type === 'savings' && a.id !== mainAccount?.id);
  const firstCategory = (kind: 'income' | 'expense') => String(categories.find(c => c.kind === kind)?.id ?? '');

  if (template) {
    return {
      type: template.type,
      amount: centsToInput(template.amount),
      date: template.date,
      accountId: String(template.accountId),
      toAccountId: String(template.toAccountId ?? savingsAccount?.id ?? ''),
      categoryId: String(template.categoryId ?? firstCategory(template.type === 'income' ? 'income' : 'expense')),
      description: template.description,
    };
  }
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
  /** Νέα συναλλαγή από κανόνα επανάληψης */
  template?: TransactionTemplate;
  defaultDate?: string;
}

export function TransactionDialog({ open, onOpenChange, transaction, template, defaultDate = today() }: TransactionDialogProps) {
  const { data: accounts = [] } = useAccounts();
  const { data: categories = [] } = useCategories();
  const save = useSaveTransaction();
  const remove = useDeleteTransaction();
  const saveRecurring = useSaveRecurring();
  const [form, setForm] = useState<FormState>(() => initialState(transaction, defaultDate, accounts, categories, template));
  // Επανάληψη μόνο για εντελώς νέα συναλλαγή (όχι επεξεργασία, όχι από κανόνα που υπάρχει ήδη)
  const [repeat, setRepeat] = useState<'none' | RecurringFrequency>('none');
  const [error, setError] = useState<string | null>(null);
  const canRepeat = !transaction && !template;

  // Επαναφορά της φόρμας κάθε φορά που ανοίγει (όχι όταν ανανεώνονται accounts/categories)
  useEffect(() => {
    if (open) {
      setForm(initialState(transaction, defaultDate, accounts, categories, template));
      setRepeat('none');
      setError(null);
    }
  }, [open, transaction, template]);

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
    // Η σύνδεση με τον κανόνα επανάληψης μένει και στην επεξεργασία
    const link = {
      recurringId: transaction?.recurringId ?? template?.recurringId ?? null,
      recurringDue: transaction?.recurringDue ?? template?.recurringDue ?? null,
    };
    const common = { date: form.date, amount, accountId: Number(form.accountId), description: form.description, ...link };
    const build = (recurringId: number | null, recurringDue: string | null): TransactionInput =>
      form.type === 'transfer'
        ? { ...common, recurringId, recurringDue, type: 'transfer', toAccountId: Number(form.toAccountId) }
        : { ...common, recurringId, recurringDue, type: form.type, categoryId: Number(form.categoryId) };
    const close = { onSuccess: () => onOpenChange(false) };

    if (canRepeat && repeat !== 'none') {
      // Πρώτα ο κανόνας, μετά η συναλλαγή ως η πρώτη του λήξη
      saveRecurring.mutate(
        {
          input: {
            kind: form.type,
            description: form.description,
            amount,
            accountId: Number(form.accountId),
            toAccountId: form.type === 'transfer' ? Number(form.toAccountId) : null,
            categoryId: form.type === 'transfer' ? null : Number(form.categoryId),
            frequency: repeat,
            day: Number(form.date.slice(8)),
            month: repeat === 'yearly' ? Number(form.date.slice(5, 7)) : null,
            startDate: form.date,
          },
        },
        { onSuccess: rule => save.mutate({ input: build(rule.id, form.date) }, close) },
      );
      return;
    }
    save.mutate({ id: transaction?.id, input: build(link.recurringId, link.recurringDue) }, close);
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

          {canRepeat && (
            <Field label="Επανάληψη">
              <Select value={repeat} onValueChange={v => setRepeat(v as typeof repeat)}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Καμία</SelectItem>
                  <SelectItem value="monthly">Κάθε μήνα, στις {Number(form.date.slice(8)) || '…'}</SelectItem>
                  <SelectItem value="yearly">Κάθε χρόνο, {form.date.slice(8, 10)}/{form.date.slice(5, 7)}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          )}

          {error && <p className="text-sm text-negative">{error}</p>}

          <DialogFooter className="gap-2">
            {transaction && (
              <Button type="button" variant="ghost" className="mr-auto text-negative" onClick={handleDelete} disabled={remove.isPending}>
                Διαγραφή
              </Button>
            )}
            <Button type="submit" disabled={save.isPending || saveRecurring.isPending}>Αποθήκευση</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
