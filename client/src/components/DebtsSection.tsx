import { Check, ChevronDown, Pencil, Plus, Trash2, Undo2 } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import {
  centsToInput,
  formatEur,
  isDebtAccount,
  parseAmount,
  today,
  type AccountWithBalance,
  type Debt,
  type DebtDirection,
} from '@budget/shared';
import { AccountSelect } from '@/components/AccountSelect';
import { Amount } from '@/components/Amount';
import { AmountInput } from '@/components/AmountInput';
import { Field } from '@/components/Field';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  useAccounts,
  useCategories,
  useDebtPayment,
  useDebts,
  useDeleteDebt,
  useDeleteDebtPayment,
  useForgiveDebt,
  useSaveDebt,
} from '@/lib/api';
import { cn } from '@/lib/utils';

const dateFormatter = new Intl.DateTimeFormat('el-GR', { day: 'numeric', month: 'short', year: 'numeric' });
const formatDate = (date: string) => dateFormatter.format(new Date(`${date}T00:00:00`));

const TEXT: Record<DebtDirection, { title: string; empty: string; tab: string; person: string; account: string; pay: string; payAccount: string }> = {
  lent: {
    title: 'Μου χρωστάνε',
    empty: 'Κανείς δεν σου χρωστάει.',
    tab: 'Δάνεισα',
    person: 'Σε ποιον',
    account: 'Από λογαριασμό',
    pay: 'Μου επέστρεψε',
    payAccount: 'Πού μπήκαν',
  },
  borrowed: {
    title: 'Χρωστάω',
    empty: 'Δεν χρωστάς σε κανέναν.',
    tab: 'Δανείστηκα',
    person: 'Από ποιον',
    account: 'Σε λογαριασμό',
    pay: 'Επέστρεψα',
    payAccount: 'Από πού βγήκαν',
  },
};

type DialogState =
  | { kind: 'closed' }
  | { kind: 'edit'; debt?: Debt; direction: DebtDirection }
  | { kind: 'pay'; debt: Debt };

/** Ενότητα «Χρωστούμενα» στη σελίδα Λογαριασμοί: όσα μου χρωστάνε και όσα χρωστάω. */
export function DebtsSection() {
  const { data: debts = [] } = useDebts();
  const { data: accounts = [] } = useAccounts();
  const remove = useDeleteDebt();
  const [dialog, setDialog] = useState<DialogState>({ kind: 'closed' });
  const [showSettled, setShowSettled] = useState(false);
  const close = () => setDialog({ kind: 'closed' });

  const userAccounts = accounts.filter(a => !isDebtAccount(a) && !a.archived);
  const accountName = (id: number | null) => accounts.find(a => a.id === id)?.name ?? '—';
  const open = debts.filter(d => d.outstanding > 0);
  const settled = debts.filter(d => d.outstanding <= 0);

  const handleDelete = (d: Debt) => {
    if (confirm(`Διαγραφή του χρωστούμενου «${d.person}» μαζί με τις επιστροφές του;`)) remove.mutate(d.id);
  };
  const rowProps = (d: Debt) => ({
    debt: d,
    accountName,
    onPay: () => setDialog({ kind: 'pay', debt: d }),
    onEdit: () => setDialog({ kind: 'edit', debt: d, direction: d.direction }),
    onDelete: () => handleDelete(d),
  });

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold tracking-tight">Χρωστούμενα</h2>
        <Button variant="outline" size="sm" className="rounded-full" onClick={() => setDialog({ kind: 'edit', direction: 'lent' })}>
          <Plus className="size-4" /> Νέο
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {(['lent', 'borrowed'] as const).map(direction => {
          const items = open.filter(d => d.direction === direction);
          const total = items.reduce((sum, d) => sum + d.outstanding, 0);
          return (
            <div key={direction} className="surface overflow-hidden">
              <div className="flex items-baseline justify-between px-4 pt-4 pb-3">
                <span className="text-sm text-muted-foreground">{TEXT[direction].title}</span>
                <Amount cents={total} className="text-xl font-bold tracking-tight" />
              </div>
              {items.length === 0 ? (
                <p className="border-t px-4 py-6 text-center text-sm text-muted-foreground">{TEXT[direction].empty}</p>
              ) : (
                <ul className="divide-y border-t">
                  {items.map(d => <DebtRow key={d.id} {...rowProps(d)} />)}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      {settled.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowSettled(s => !s)}
            className="flex items-center gap-1 px-1 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            Εξοφλημένα ({settled.length})
            <ChevronDown className={cn('size-4 transition-transform', showSettled && 'rotate-180')} />
          </button>
          {showSettled && (
            <ul className="surface mt-2 divide-y overflow-hidden">
              {settled.map(d => <DebtRow key={d.id} {...rowProps(d)} />)}
            </ul>
          )}
        </div>
      )}

      <DebtDialog
        open={dialog.kind === 'edit'}
        debt={dialog.kind === 'edit' ? dialog.debt : undefined}
        defaultDirection={dialog.kind === 'edit' ? dialog.direction : 'lent'}
        accounts={userAccounts}
        onClose={close}
      />
      <PaymentDialog debt={dialog.kind === 'pay' ? dialog.debt : undefined} accounts={userAccounts} onClose={close} />
    </section>
  );
}

function DebtRow({
  debt: d,
  accountName,
  onPay,
  onEdit,
  onDelete,
}: {
  debt: Debt;
  accountName: (id: number | null) => string;
  onPay: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const undo = useDeleteDebtPayment();
  const isSettled = d.outstanding <= 0;
  const forgiven = d.payments.some(p => p.kind === 'forgiven');

  return (
    <li>
      <div className="group flex items-center gap-3 px-4 py-3">
        <button type="button" onClick={() => setExpanded(e => !e)} aria-expanded={expanded} className="flex min-w-0 flex-1 items-center gap-3 text-left outline-none">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/12 text-sm font-bold text-primary">
            {d.person.trim().charAt(0).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">
              {d.person}
              {d.reason && <span className="font-normal text-muted-foreground"> · {d.reason}</span>}
            </div>
            <div className="truncate text-xs text-muted-foreground">
              {formatDate(d.date)} · {d.direction === 'lent' ? 'από' : 'σε'} {accountName(d.accountId)}
              {isSettled && (forgiven ? ' · χαρίστηκε' : ' · εξοφλήθηκε')}
            </div>
            {!isSettled && d.settled > 0 && (
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-positive" style={{ width: `${(d.settled / d.amount) * 100}%` }} />
              </div>
            )}
          </div>
          <div className="text-right">
            <Amount cents={isSettled ? d.amount : d.outstanding} className={cn('text-sm font-semibold', isSettled && 'font-normal text-muted-foreground')} />
            {!isSettled && d.settled > 0 && <div className="text-xs text-muted-foreground">από {formatEur(d.amount)}</div>}
          </div>
        </button>
        <div className="flex">
          {!isSettled && (
            <Button variant="ghost" size="icon-sm" title={TEXT[d.direction].pay} className="rounded-full text-positive hover:bg-positive/10 hover:text-positive" onClick={onPay}>
              <Check className="size-4" />
            </Button>
          )}
          <Button variant="ghost" size="icon-sm" title="Επεξεργασία" className="rounded-full" onClick={onEdit}><Pencil className="size-4" /></Button>
          <Button variant="ghost" size="icon-sm" title="Διαγραφή" className="rounded-full hover:text-negative" onClick={onDelete}><Trash2 className="size-4" /></Button>
        </div>
      </div>
      {expanded && (
        <ul className="space-y-1 bg-muted/30 px-4 py-2 pl-16 text-xs">
          <li className="flex items-center justify-between gap-2 text-muted-foreground">
            <span>{formatDate(d.date)} · {TEXT[d.direction].tab} {d.direction === 'lent' ? 'από' : 'σε'} {accountName(d.accountId)}</span>
            <span className="mr-8 tabular-nums">{formatEur(d.amount)}</span>
          </li>
          {d.payments.map(p => (
            <li key={p.transactionId} className="flex items-center justify-between gap-2">
              <span>
                {formatDate(p.date)} · {p.kind === 'forgiven' ? 'Χαρίστηκε' : `${TEXT[d.direction].pay} ${d.direction === 'lent' ? 'σε' : 'από'} ${accountName(p.accountId)}`}
              </span>
              <span className="flex items-center gap-1">
                <span className="tabular-nums">−{formatEur(p.amount)}</span>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  title="Αναίρεση"
                  className="rounded-full text-muted-foreground"
                  disabled={undo.isPending}
                  onClick={() => undo.mutate({ id: d.id, transactionId: p.transactionId })}
                >
                  <Undo2 />
                </Button>
              </span>
            </li>
          ))}
          {d.payments.length === 0 && <li className="text-muted-foreground">Καμία επιστροφή ακόμα.</li>}
        </ul>
      )}
    </li>
  );
}

function DebtDialog({
  open,
  debt,
  defaultDirection,
  accounts,
  onClose,
}: {
  open: boolean;
  debt?: Debt;
  defaultDirection: DebtDirection;
  accounts: AccountWithBalance[];
  onClose: () => void;
}) {
  const save = useSaveDebt();
  const [direction, setDirection] = useState<DebtDirection>('lent');
  const [person, setPerson] = useState('');
  const [reason, setReason] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today());
  const [accountId, setAccountId] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDirection(debt?.direction ?? defaultDirection);
    setPerson(debt?.person ?? '');
    setReason(debt?.reason ?? '');
    setAmount(debt ? centsToInput(debt.amount) : '');
    setDate(debt?.date ?? today());
    // Συνήθως τα δανεικά δίνονται σε μετρητά
    setAccountId(String(debt?.accountId ?? (accounts.find(a => a.type === 'cash') ?? accounts[0])?.id ?? ''));
    setError(null);
  }, [open, debt]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const cents = parseAmount(amount);
    if (cents == null || cents <= 0) return setError('Γράψε ένα θετικό ποσό, π.χ. 50');
    save.mutate(
      { id: debt?.id, input: { direction, person, reason, amount: cents, date, accountId: Number(accountId) } },
      { onSuccess: onClose },
    );
  }

  const t = TEXT[direction];
  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{debt ? 'Επεξεργασία χρωστούμενου' : 'Νέο χρωστούμενο'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="grid gap-4">
          {!debt && (
            <div className="grid grid-cols-2 gap-1 rounded-full bg-muted p-1">
              {(['lent', 'borrowed'] as const).map(d => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDirection(d)}
                  className={cn(
                    'rounded-full py-1.5 text-sm font-medium text-muted-foreground transition-colors',
                    direction === d && 'bg-card text-foreground shadow-soft dark:bg-accent',
                  )}
                >
                  {TEXT[d].tab}
                </button>
              ))}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label={t.person} htmlFor="debt-person">
              <Input id="debt-person" required autoFocus value={person} onChange={e => setPerson(e.target.value)} />
            </Field>
            <Field label="Ποσό" htmlFor="debt-amount">
              <AmountInput id="debt-amount" value={amount} onChange={e => setAmount(e.target.value)} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t.account}>
              <AccountSelect accounts={accounts} value={accountId} onChange={setAccountId} />
            </Field>
            <Field label="Ημερομηνία" htmlFor="debt-date">
              <Input id="debt-date" type="date" required value={date} onChange={e => setDate(e.target.value)} />
            </Field>
          </div>
          <Field label="Γιατί" htmlFor="debt-reason">
            <Input id="debt-reason" placeholder="προαιρετικό, π.χ. εισιτήρια συναυλίας" value={reason} onChange={e => setReason(e.target.value)} />
          </Field>
          {error && <p className="text-sm text-negative">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={save.isPending}>Αποθήκευση</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** ✓: επιστροφή (όλο ή μέρος) ή «χαρίστηκε». */
function PaymentDialog({ debt, accounts, onClose }: { debt?: Debt; accounts: AccountWithBalance[]; onClose: () => void }) {
  const { data: categories = [] } = useCategories();
  const pay = useDebtPayment();
  const forgive = useForgiveDebt();
  const [mode, setMode] = useState<'payment' | 'forgiven'>('payment');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today());
  const [accountId, setAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const kind = debt?.direction === 'borrowed' ? 'income' : 'expense';
  const kindCategories = categories.filter(c => c.kind === kind);

  useEffect(() => {
    if (!debt) return;
    setMode('payment');
    setAmount(centsToInput(debt.outstanding));
    setDate(today());
    // Πρόταση: ο λογαριασμός του δανεισμού
    setAccountId(String(debt.accountId));
    const fallback = kindCategories.find(c => c.name === (kind === 'expense' ? 'Άλλα' : 'Άλλα έσοδα')) ?? kindCategories[0];
    setCategoryId(String(fallback?.id ?? ''));
    setError(null);
  }, [debt]);

  if (!debt) return <Dialog open={false} />;
  const t = TEXT[debt.direction];

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!debt) return;
    if (mode === 'forgiven') {
      forgive.mutate({ id: debt.id, input: { date, categoryId: Number(categoryId) } }, { onSuccess: onClose });
      return;
    }
    const cents = parseAmount(amount);
    if (cents == null || cents <= 0) return setError('Γράψε ένα θετικό ποσό');
    if (cents > debt.outstanding) return setError(`Απομένουν ${formatEur(debt.outstanding)}`);
    pay.mutate({ id: debt.id, input: { date, amount: cents, accountId: Number(accountId) } }, { onSuccess: onClose });
  }

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{debt.person}</DialogTitle>
          <DialogDescription>
            Απομένουν {formatEur(debt.outstanding)}{debt.settled > 0 && <> από {formatEur(debt.amount)}</>}.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="grid gap-4">
          <div className="grid grid-cols-2 gap-1 rounded-full bg-muted p-1">
            {([['payment', t.pay], ['forgiven', 'Χαρίστηκε']] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setMode(value)}
                className={cn(
                  'rounded-full py-1.5 text-sm font-medium text-muted-foreground transition-colors',
                  mode === value && 'bg-card text-foreground shadow-soft dark:bg-accent',
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {mode === 'payment' ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Ποσό" htmlFor="pay-amount" hint="Για επιστροφή σε δόσεις, γράψε μόνο όσα δόθηκαν τώρα.">
                  <AmountInput id="pay-amount" autoFocus value={amount} onChange={e => setAmount(e.target.value)} />
                </Field>
                <Field label="Ημερομηνία" htmlFor="pay-date">
                  <Input id="pay-date" type="date" required value={date} onChange={e => setDate(e.target.value)} />
                </Field>
              </div>
              <Field label={t.payAccount}>
                <AccountSelect accounts={accounts} value={accountId} onChange={setAccountId} />
              </Field>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Τα {formatEur(debt.outstanding)} που απομένουν καταχωρούνται ως <strong>{kind === 'expense' ? 'έξοδο' : 'έσοδο'}</strong> στην
                κατηγορία που θα διαλέξεις, στον μήνα της ημερομηνίας.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Κατηγορία">
                  <Select value={categoryId} onValueChange={setCategoryId}>
                    <SelectTrigger className="w-full"><SelectValue placeholder="Επίλεξε" /></SelectTrigger>
                    <SelectContent>
                      {kindCategories.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Ημερομηνία" htmlFor="forgive-date">
                  <Input id="forgive-date" type="date" required value={date} onChange={e => setDate(e.target.value)} />
                </Field>
              </div>
            </>
          )}
          {error && <p className="text-sm text-negative">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={pay.isPending || forgive.isPending}>
              {mode === 'payment' ? 'Καταχώριση' : 'Χαρίστηκε'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
