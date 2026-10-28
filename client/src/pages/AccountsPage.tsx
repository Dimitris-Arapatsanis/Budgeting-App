import { Archive, ArchiveRestore, Pencil, Plus, Scale, Trash2 } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import {
  ACCOUNT_TYPE_LABELS,
  ACCOUNT_TYPES,
  centsToInput,
  formatEurSigned,
  parseAmount,
  today,
  isDebtAccount,
  type AccountType,
  type UserAccountType,
  type AccountWithBalance,
} from '@budget/shared';
import { Amount } from '@/components/Amount';
import { AmountInput } from '@/components/AmountInput';
import { DebtsSection } from '@/components/DebtsSection';
import { DonutChart } from '@/components/DonutChart';
import { Field } from '@/components/Field';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ACCOUNT_ICON } from '@/lib/account-style';
import { useAccounts, useDeleteAccount, useReconcileAccount, useSaveAccount } from '@/lib/api';
import { toast } from 'sonner';

type DialogState =
  | { kind: 'closed' }
  | { kind: 'edit'; account?: AccountWithBalance }
  | { kind: 'reconcile'; account: AccountWithBalance };

export function AccountsPage() {
  const { data: accounts = [] } = useAccounts();
  const save = useSaveAccount();
  const remove = useDeleteAccount();
  const [dialog, setDialog] = useState<DialogState>({ kind: 'closed' });
  const close = () => setDialog({ kind: 'closed' });

  // Οι λογαριασμοί των χρωστούμενων φαίνονται στην ενότητα «Χρωστούμενα»
  const userAccounts = accounts.filter(a => !isDebtAccount(a));
  const active = userAccounts.filter(a => !a.archived);
  const archived = userAccounts.filter(a => a.archived);
  const assets = active.filter(a => a.type !== 'loan');
  const loans = active.filter(a => a.type === 'loan');
  const debt = loans.reduce((sum, a) => sum + a.balance, 0);
  const allZero = userAccounts.length > 0 && userAccounts.every(a => a.balance === 0);

  const toggleArchive = (a: AccountWithBalance) =>
    save.mutate({ id: a.id, input: { name: a.name, type: a.type as UserAccountType, initialBalance: a.initialBalance, archived: !a.archived } });

  const handleDelete = (a: AccountWithBalance) => {
    if (confirm(`Διαγραφή του λογαριασμού «${a.name}»;`)) remove.mutate(a.id);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-xs font-medium text-muted-foreground">Πού είναι τα λεφτά σου</div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Λογαριασμοί</h1>
        </div>
        <Button className="rounded-full shadow-soft" onClick={() => setDialog({ kind: 'edit' })}>
          <Plus className="size-4" /> Νέος λογαριασμός
        </Button>
      </div>

      {allZero && (
        <p className="rounded-2xl bg-accent px-4 py-3 text-sm text-accent-foreground">
          Ξεκίνα βάζοντας το <strong>αρχικό υπόλοιπο</strong> κάθε λογαριασμού: πόσα είχε πριν την πρώτη συναλλαγή
          που θα καταχωρήσεις. Πάτα το <Pencil className="inline size-3.5" /> δίπλα σε κάθε λογαριασμό.
        </p>
      )}

      <Card>
        <CardHeader><CardTitle>Υπόλοιπα</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <DonutChart
            centerLabel="Σύνολο"
            data={assets.map(a => ({ name: a.name, value: Math.max(a.balance, 0) }))}
            emptyText="Δεν υπάρχουν υπόλοιπα ακόμα"
          />
          {loans.length > 0 && (
            <div className="flex justify-between border-t pt-4 text-sm">
              <span className="text-muted-foreground">Χρέη</span>
              <Amount cents={debt} colored />
            </div>
          )}
        </CardContent>
      </Card>

      <ul className="surface divide-y overflow-hidden">
        {active.map(a => (
          <AccountRow
            key={a.id}
            account={a}
            onEdit={() => setDialog({ kind: 'edit', account: a })}
            onReconcile={() => setDialog({ kind: 'reconcile', account: a })}
            onArchive={() => toggleArchive(a)}
            onDelete={() => handleDelete(a)}
          />
        ))}
      </ul>

      <DebtsSection />

      {archived.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-bold tracking-tight">Αρχειοθετημένοι</h2>
          <ul className="surface divide-y overflow-hidden opacity-60">
            {archived.map(a => (
              <AccountRow
                key={a.id}
                account={a}
                onEdit={() => setDialog({ kind: 'edit', account: a })}
                onArchive={() => toggleArchive(a)}
                onDelete={() => handleDelete(a)}
              />
            ))}
          </ul>
        </section>
      )}

      <AccountDialog open={dialog.kind === 'edit'} account={dialog.kind === 'edit' ? dialog.account : undefined} onClose={close} />
      <ReconcileDialog account={dialog.kind === 'reconcile' ? dialog.account : undefined} onClose={close} />
    </div>
  );
}

function AccountRow({
  account: a,
  onEdit,
  onReconcile,
  onArchive,
  onDelete,
}: {
  account: AccountWithBalance;
  onEdit: () => void;
  onReconcile?: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  return (
    <li className="group flex items-center gap-3 px-4 py-3">
      <AccountIcon type={a.type} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{a.name}</div>
        <div className="text-xs text-muted-foreground">{ACCOUNT_TYPE_LABELS[a.type]}</div>
      </div>
      <Amount cents={a.balance} colored={a.type === 'loan'} className="text-sm font-semibold" />
      <div className="flex">
        {onReconcile && (
          <Button variant="ghost" size="icon" title="Διόρθωση υπολοίπου" onClick={onReconcile}><Scale className="size-4" /></Button>
        )}
        <Button variant="ghost" size="icon" title="Επεξεργασία" onClick={onEdit}><Pencil className="size-4" /></Button>
        <Button variant="ghost" size="icon" title={a.archived ? 'Επαναφορά' : 'Αρχειοθέτηση'} onClick={onArchive}>
          {a.archived ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />}
        </Button>
        <Button variant="ghost" size="icon" title="Διαγραφή" onClick={onDelete}><Trash2 className="size-4" /></Button>
      </div>
    </li>
  );
}

function AccountIcon({ type }: { type: AccountType }) {
  const Icon = ACCOUNT_ICON[type];
  return (
    <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/12 text-primary">
      <Icon className="size-4" />
    </span>
  );
}

function AccountDialog({ open, account, onClose }: { open: boolean; account?: AccountWithBalance; onClose: () => void }) {
  const save = useSaveAccount();
  const [name, setName] = useState('');
  const [type, setType] = useState<UserAccountType>('bank');
  const [initial, setInitial] = useState('');
  const [error, setError] = useState<string | null>(null);
  const isLoan = type === 'loan';

  useEffect(() => {
    if (!open) return;
    setName(account?.name ?? '');
    setType((account?.type as UserAccountType | undefined) ?? 'bank');
    // Τα δάνεια αποθηκεύονται αρνητικά, αλλά ο χρήστης γράφει την οφειλή θετική
    setInitial(account ? centsToInput(Math.abs(account.initialBalance)) : '');
    setError(null);
  }, [open, account]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const amount = initial.trim() ? parseAmount(initial) : 0;
    if (amount == null) {
      setError('Μη έγκυρο ποσό');
      return;
    }
    const initialBalance = isLoan ? -Math.abs(amount) : amount;
    save.mutate(
      { id: account?.id, input: { name, type, initialBalance, archived: account?.archived ?? false } },
      { onSuccess: onClose },
    );
  }

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{account ? 'Επεξεργασία λογαριασμού' : 'Νέος λογαριασμός'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="grid gap-4">
          <Field label="Όνομα" htmlFor="acc-name">
            <Input id="acc-name" required autoFocus value={name} onChange={e => setName(e.target.value)} />
          </Field>
          <Field label="Είδος">
            <Select value={type} onValueChange={v => setType(v as UserAccountType)}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {ACCOUNT_TYPES.map(t => <SelectItem key={t} value={t}>{ACCOUNT_TYPE_LABELS[t]}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field
            label={isLoan ? 'Αρχική οφειλή' : 'Αρχικό υπόλοιπο'}
            htmlFor="acc-initial"
            hint="Το υπόλοιπο πριν την πρώτη συναλλαγή που θα καταχωρήσεις σε αυτόν τον λογαριασμό."
          >
            <AmountInput id="acc-initial" value={initial} onChange={e => setInitial(e.target.value)} />
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

function ReconcileDialog({ account, onClose }: { account?: AccountWithBalance; onClose: () => void }) {
  const reconcile = useReconcileAccount();
  const [actual, setActual] = useState('');
  const [date, setDate] = useState(today());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!account) return;
    setActual(centsToInput(account.balance));
    setDate(today());
    setError(null);
  }, [account]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const actualBalance = parseAmount(actual);
    if (!account || actualBalance == null) {
      setError('Μη έγκυρο ποσό');
      return;
    }
    reconcile.mutate(
      { id: account.id, input: { actualBalance, date } },
      {
        onSuccess: ({ adjustment }) => {
          toast.success(adjustment === 0 ? 'Το υπόλοιπο ήταν ήδη σωστό' : `Διόρθωση ${formatEurSigned(adjustment)}`);
          onClose();
        },
      },
    );
  }

  return (
    <Dialog open={!!account} onOpenChange={o => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Διόρθωση υπολοίπου</DialogTitle>
          <DialogDescription>
            Γράψε το πραγματικό υπόλοιπο του λογαριασμού «{account?.name}». Η διαφορά καταχωρείται ως διόρθωση
            και δεν μετράει ως έσοδο ή έξοδο.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="grid gap-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Πραγματικό υπόλοιπο" htmlFor="rec-amount">
              <AmountInput id="rec-amount" autoFocus value={actual} onChange={e => setActual(e.target.value)} />
            </Field>
            <Field label="Στις" htmlFor="rec-date">
              <Input id="rec-date" type="date" required value={date} onChange={e => setDate(e.target.value)} />
            </Field>
          </div>
          {error && <p className="text-sm text-negative">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={reconcile.isPending}>Διόρθωση</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
