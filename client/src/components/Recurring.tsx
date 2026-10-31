import { ArrowLeftRight, ChartLine, ChartPie, Check, Pause, Pencil, Play, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import {
  centsToInput,
  formatEur,
  isDebtAccount,
  parseAmount,
  recurringEffect,
  RECURRING_KIND_LABELS,
  RECURRING_KINDS,
  today,
  type Recurring,
  type RecurringDue,
  type RecurringFrequency,
  type RecurringKind,
} from '@budget/shared';
import { AccountSelect } from '@/components/AccountSelect';
import { Amount } from '@/components/Amount';
import { AmountInput } from '@/components/AmountInput';
import { CategoryBadge } from '@/components/CategoryBadge';
import { Field } from '@/components/Field';
import { BROKER_CASH, defaultFunding, FundingSelect, toFundingAccountId } from '@/components/FundingSelect';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  useAccounts,
  useCategories,
  useDeleteRecurring,
  useInstruments,
  usePies,
  useRecurring,
  useRecurringDue,
  useSaveRecurring,
  useSkipRecurring,
} from '@/lib/api';
import { cn } from '@/lib/utils';

const MONTHS = ['Ιανουάριος', 'Φεβρουάριος', 'Μάρτιος', 'Απρίλιος', 'Μάιος', 'Ιούνιος', 'Ιούλιος', 'Αύγουστος', 'Σεπτέμβριος', 'Οκτώβριος', 'Νοέμβριος', 'Δεκέμβριος'];
const dayFormatter = new Intl.DateTimeFormat('el-GR', { day: 'numeric', month: 'short' });
const formatDay = (date: string) => dayFormatter.format(new Date(`${date}T00:00:00`));

/** Όνομα, εικονίδιο και λογαριασμός ενός κανόνα, με βάση τα δεδομένα της εφαρμογής. */
function useRecurringLabels() {
  const { data: accounts = [] } = useAccounts();
  const { data: categories = [] } = useCategories();
  const { data: instruments = [] } = useInstruments();
  const { data: pies = [] } = usePies();
  const accountName = (id: number | null) => accounts.find(a => a.id === id)?.name ?? '—';
  return {
    name: (r: Recurring) =>
      r.description
      || (r.kind === 'buy' ? instruments.find(i => i.id === r.instrumentId)?.name
        : r.kind === 'pie' ? pies.find(p => p.id === r.pieId)?.name
        : r.kind === 'transfer' ? `${accountName(r.accountId)} → ${accountName(r.toAccountId)}`
        : categories.find(c => c.id === r.categoryId)?.name)
      || '—',
    where: (r: Recurring) =>
      r.kind === 'transfer' ? 'Μεταφορά'
        : r.kind === 'buy' || r.kind === 'pie'
          ? `${accountName(r.accountId)}${r.fundingAccountId != null ? ` · από ${accountName(r.fundingAccountId)}` : ''}`
          : accountName(r.accountId),
    category: (r: Recurring) => categories.find(c => c.id === r.categoryId),
  };
}

function RecurringIcon({ rule }: { rule: Recurring }) {
  const { category } = useRecurringLabels();
  if (rule.kind === 'income' || rule.kind === 'expense') {
    const c = category(rule);
    return <CategoryBadge icon={c?.icon ?? 'tag'} color={c?.color ?? 'slate'} />;
  }
  const Icon = rule.kind === 'transfer' ? ArrowLeftRight : rule.kind === 'pie' ? ChartPie : ChartLine;
  return (
    <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/12 text-primary">
      <Icon className="size-4" />
    </span>
  );
}

const frequencyLabel = (r: Pick<Recurring, 'frequency' | 'day' | 'month'>) =>
  r.frequency === 'monthly' ? `κάθε μήνα στις ${r.day}` : `κάθε χρόνο, ${r.day} ${MONTHS[(r.month ?? 1) - 1]!.slice(0, 3)}`;

/** Ποσό όπως στις συναλλαγές: έσοδο +πράσινο, έξοδο −, τα υπόλοιπα ουδέτερα. */
function RecurringAmount({ rule }: { rule: Recurring }) {
  if (rule.kind === 'income') return <Amount cents={rule.amount} signed colored className="text-sm font-semibold" />;
  if (rule.kind === 'expense') return <Amount cents={-rule.amount} signed className="text-sm font-semibold" />;
  return <Amount cents={rule.amount} className="text-sm text-muted-foreground" />;
}

// ---------- Μήνας: «Αναμένονται» ----------

/**
 * Λήξεις του μήνα που δεν έχουν καταχωριστεί: ✓ ανοίγει τη φόρμα συμπληρωμένη, ✕ «όχι αυτόν τον μήνα».
 * Δεν μετράνε στα στατιστικά πριν καταχωριστούν.
 */
export function RecurringDueSection({ month, onRecord }: { month: string; onRecord: (due: RecurringDue) => void }) {
  const { data: dues = [] } = useRecurringDue(month);
  const skip = useSkipRecurring();
  const labels = useRecurringLabels();
  if (dues.length === 0) return null;

  const totals = dues.reduce((acc, d) => {
    const e = recurringEffect(d.recurring);
    return { income: acc.income + e.income, expense: acc.expense + e.expense };
  }, { income: 0, expense: 0 });
  const now = today();

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-lg font-bold tracking-tight">Αναμένονται</h2>
        <span className="text-xs text-muted-foreground">
          {[totals.income > 0 && `έσοδα +${formatEur(totals.income)}`, totals.expense > 0 && `έξοδα −${formatEur(totals.expense)}`]
            .filter(Boolean).join(' · ') || 'δεν μετράνε ακόμα στα στατιστικά'}
        </span>
      </div>
      <ul className="surface divide-y overflow-hidden">
        {dues.map(d => {
          const overdue = d.dueDate < now;
          return (
            <li key={`${d.recurring.id}:${d.dueDate}`} className="flex items-center gap-3 py-3 pr-2 pl-4">
              <RecurringIcon rule={d.recurring} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">
                  {labels.name(d.recurring)}
                  {labels.name(d.recurring) !== RECURRING_KIND_LABELS[d.recurring.kind] && (
                    <span className="font-normal text-muted-foreground"> · {RECURRING_KIND_LABELS[d.recurring.kind]}</span>
                  )}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  <span className={cn(overdue && 'font-medium text-warning')}>{formatDay(d.dueDate)}</span> · {labels.where(d.recurring)}
                </div>
              </div>
              <RecurringAmount rule={d.recurring} />
              <div className="flex">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  title="Καταχώριση"
                  className="rounded-full text-positive hover:bg-positive/10 hover:text-positive"
                  onClick={() => onRecord(d)}
                >
                  <Check className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  title="Όχι αυτόν τον μήνα"
                  className="rounded-full text-muted-foreground"
                  disabled={skip.isPending}
                  onClick={() => skip.mutate(d)}
                >
                  <X className="size-4" />
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ---------- Κατηγορίες: λίστα κανόνων ----------

export function RecurringSection() {
  const { data: rules = [] } = useRecurring();
  const save = useSaveRecurring();
  const remove = useDeleteRecurring();
  const labels = useRecurringLabels();
  const [dialog, setDialog] = useState<{ open: boolean; rule?: Recurring }>({ open: false });

  const toggle = (r: Recurring) => save.mutate({ id: r.id, input: { ...r, active: !r.active } });
  const handleDelete = (r: Recurring) => {
    if (confirm(`Διαγραφή της επανάληψης «${labels.name(r)}»; Οι συναλλαγές που έχεις ήδη καταχωρίσει μένουν.`)) remove.mutate(r.id);
  };

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold tracking-tight">Επαναλαμβανόμενες</h2>
          <p className="text-xs text-muted-foreground">Εμφανίζονται στα «Αναμένονται» του μήνα. Τίποτα δεν καταχωρείται χωρίς ✓.</p>
        </div>
        <Button variant="outline" size="sm" className="rounded-full" onClick={() => setDialog({ open: true })}>
          <Plus className="size-4" /> Νέα
        </Button>
      </div>
      {rules.length === 0 ? (
        <p className="rounded-2xl border-2 border-dashed p-6 text-center text-sm text-muted-foreground">
          Καμία ακόμα. Φτιάξε μία εδώ ή από τη «Νέα συναλλαγή» → «Επανάληψη».
        </p>
      ) : (
        <ul className="surface divide-y overflow-hidden">
          {rules.map(r => (
            <li key={r.id} className={cn('flex items-center gap-3 py-3 pr-2 pl-4', !r.active && 'opacity-60')}>
              <RecurringIcon rule={r} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">
                  {labels.name(r)}
                  {labels.name(r) !== RECURRING_KIND_LABELS[r.kind] && (
                    <span className="font-normal text-muted-foreground"> · {RECURRING_KIND_LABELS[r.kind]}</span>
                  )}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {frequencyLabel(r)} · {labels.where(r)}
                  {!r.active && ' · σε παύση'}
                  {r.endDate && ` · έως ${new Date(`${r.endDate}T00:00:00`).toLocaleDateString('el-GR')}`}
                </div>
              </div>
              <RecurringAmount rule={r} />
              <div className="flex">
                <Button variant="ghost" size="icon-sm" title={r.active ? 'Παύση' : 'Συνέχεια'} className="rounded-full" onClick={() => toggle(r)}>
                  {r.active ? <Pause className="size-4" /> : <Play className="size-4" />}
                </Button>
                <Button variant="ghost" size="icon-sm" title="Επεξεργασία" className="rounded-full" onClick={() => setDialog({ open: true, rule: r })}>
                  <Pencil className="size-4" />
                </Button>
                <Button variant="ghost" size="icon-sm" title="Διαγραφή" className="rounded-full hover:text-negative" onClick={() => handleDelete(r)}>
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <RecurringDialog open={dialog.open} rule={dialog.rule} onClose={() => setDialog({ open: false })} />
    </section>
  );
}

interface FormState {
  kind: RecurringKind;
  description: string;
  amount: string;
  accountId: string;
  toAccountId: string;
  categoryId: string;
  instrumentId: string;
  pieId: string;
  funding: string;
  frequency: RecurringFrequency;
  day: string;
  month: string;
  startDate: string;
  endDate: string;
}

function RecurringDialog({ open, rule, onClose }: { open: boolean; rule?: Recurring; onClose: () => void }) {
  const { data: accounts = [] } = useAccounts();
  const { data: categories = [] } = useCategories();
  const { data: instruments = [] } = useInstruments();
  const { data: pies = [] } = usePies();
  const save = useSaveRecurring();
  const [form, setForm] = useState<FormState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const userAccounts = accounts.filter(a => !isDebtAccount(a) && !a.archived);
  const brokers = userAccounts.filter(a => a.type === 'broker');

  useEffect(() => {
    if (!open) return;
    const bank = userAccounts.find(a => a.type === 'bank') ?? userAccounts[0];
    const str = (v: number | null | undefined, fallback = '') => (v == null ? fallback : String(v));
    setForm({
      kind: rule?.kind ?? 'expense',
      description: rule?.description ?? '',
      amount: rule ? centsToInput(rule.amount) : '',
      accountId: str(rule?.accountId, str(bank?.id)),
      toAccountId: str(rule?.toAccountId, str(userAccounts.find(a => a.type === 'savings')?.id)),
      categoryId: str(rule?.categoryId, str(categories.find(c => c.kind === (rule?.kind === 'income' ? 'income' : 'expense'))?.id)),
      instrumentId: str(rule?.instrumentId, str(instruments.find(i => !pies.some(p => p.slices.some(s => s.instrumentId === i.id)))?.id)),
      pieId: str(rule?.pieId, str(pies[0]?.id)),
      funding: rule ? (rule.fundingAccountId == null ? BROKER_CASH : String(rule.fundingAccountId)) : defaultFunding(accounts),
      frequency: rule?.frequency ?? 'monthly',
      day: str(rule?.day, String(Number(today().slice(8)))),
      month: str(rule?.month, String(Number(today().slice(5, 7)))),
      startDate: rule?.startDate ?? today(),
      endDate: rule?.endDate ?? '',
    });
    setError(null);
  }, [open, rule]);

  if (!form) return <Dialog open={false} />;
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm(f => f && { ...f, [key]: value });

  function changeKind(kind: RecurringKind) {
    setForm(f => {
      if (!f) return f;
      const next = { ...f, kind };
      // Η κατηγορία πρέπει να είναι του σωστού είδους, ο λογαριασμός μιας αγοράς broker
      if ((kind === 'income' || kind === 'expense') && categories.find(c => String(c.id) === f.categoryId)?.kind !== kind) {
        next.categoryId = String(categories.find(c => c.kind === kind)?.id ?? '');
      }
      if (kind === 'buy' && !brokers.some(b => String(b.id) === f.accountId)) next.accountId = String(brokers[0]?.id ?? '');
      if (kind !== 'buy' && kind !== 'pie' && brokers.some(b => String(b.id) === f.accountId)) {
        next.accountId = String((userAccounts.find(a => a.type === 'bank') ?? userAccounts[0])?.id ?? '');
      }
      return next;
    });
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    const amount = parseAmount(form.amount);
    if (amount == null || amount <= 0) return setError('Γράψε ένα θετικό ποσό');
    const day = Number(form.day);
    if (!Number.isInteger(day) || day < 1 || day > 31) return setError('Η ημέρα πρέπει να είναι από 1 έως 31');
    const pie = pies.find(p => String(p.id) === form.pieId);
    const id = (v: string) => (v ? Number(v) : null);
    save.mutate(
      {
        id: rule?.id,
        input: {
          kind: form.kind,
          description: form.description,
          amount,
          accountId: form.kind === 'pie' ? pie?.accountId ?? 0 : Number(form.accountId),
          toAccountId: id(form.toAccountId),
          categoryId: id(form.categoryId),
          instrumentId: id(form.instrumentId),
          pieId: id(form.pieId),
          fundingAccountId: toFundingAccountId(form.funding),
          frequency: form.frequency,
          day,
          month: form.frequency === 'yearly' ? Number(form.month) : null,
          startDate: form.startDate,
          endDate: form.endDate || null,
          active: rule?.active ?? true,
        },
      },
      { onSuccess: onClose },
    );
  }

  const isTrade = form.kind === 'buy' || form.kind === 'pie';
  const kindCategories = categories.filter(c => c.kind === (form.kind === 'income' ? 'income' : 'expense'));
  const broker = form.kind === 'pie'
    ? accounts.find(a => a.id === pies.find(p => String(p.id) === form.pieId)?.accountId)
    : accounts.find(a => String(a.id) === form.accountId);

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{rule ? 'Επεξεργασία επανάληψης' : 'Νέα επανάληψη'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="grid gap-4">
          <div className="grid grid-cols-5 gap-1 rounded-full bg-muted p-1">
            {RECURRING_KINDS.map(kind => (
              <button
                key={kind}
                type="button"
                onClick={() => changeKind(kind)}
                className={cn(
                  'rounded-full py-1.5 text-xs font-medium text-muted-foreground transition-colors sm:text-sm',
                  form.kind === kind && 'bg-card text-foreground shadow-soft dark:bg-accent',
                )}
              >
                {RECURRING_KIND_LABELS[kind]}
              </button>
            ))}
          </div>
          {isTrade && (
            <p className="-mt-1 text-xs text-muted-foreground">
              Υπενθύμιση: με ✓ ανοίγει η {form.kind === 'pie' ? '«Αγορά στο pie»' : 'αγορά'} με το ποσό. Την ποσότητα τη γράφεις εσύ από τον broker.
            </p>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Όνομα" htmlFor="rec-name">
              <Input id="rec-name" placeholder="π.χ. Netflix, ενοίκιο" value={form.description} onChange={e => set('description', e.target.value)} />
            </Field>
            <Field label={isTrade ? 'Ποσό αγοράς' : 'Ποσό'} htmlFor="rec-amount">
              <AmountInput id="rec-amount" value={form.amount} onChange={e => set('amount', e.target.value)} />
            </Field>
          </div>

          {(form.kind === 'income' || form.kind === 'expense') && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Κατηγορία">
                <Select value={form.categoryId} onValueChange={v => set('categoryId', v)}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="Επίλεξε" /></SelectTrigger>
                  <SelectContent>
                    {kindCategories.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label={form.kind === 'expense' ? 'Πληρωμή με' : 'Σε λογαριασμό'}>
                <AccountSelect accounts={userAccounts} value={form.accountId} onChange={v => set('accountId', v)} />
              </Field>
            </div>
          )}

          {form.kind === 'transfer' && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Από"><AccountSelect accounts={userAccounts} value={form.accountId} onChange={v => set('accountId', v)} /></Field>
              <Field label="Προς"><AccountSelect accounts={userAccounts} value={form.toAccountId} onChange={v => set('toAccountId', v)} /></Field>
            </div>
          )}

          {form.kind === 'buy' && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Μετοχή">
                <Select value={form.instrumentId} onValueChange={v => set('instrumentId', v)}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="Επίλεξε" /></SelectTrigger>
                  <SelectContent>
                    {instruments.map(i => <SelectItem key={i.id} value={String(i.id)}>{i.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Πλατφόρμα"><AccountSelect accounts={brokers} value={form.accountId} onChange={v => set('accountId', v)} /></Field>
            </div>
          )}

          {form.kind === 'pie' && (
            <Field label="Pie">
              <Select value={form.pieId} onValueChange={v => set('pieId', v)}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Επίλεξε" /></SelectTrigger>
                <SelectContent>
                  {pies.map(p => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.name} · {accounts.find(a => a.id === p.accountId)?.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}

          {isTrade && (
            <Field label="Χρήματα από">
              <FundingSelect accounts={accounts} broker={broker} value={form.funding} onChange={v => set('funding', v)} />
            </Field>
          )}

          <div className="grid grid-cols-3 gap-3">
            <Field label="Συχνότητα">
              <Select value={form.frequency} onValueChange={v => set('frequency', v as RecurringFrequency)}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly">Κάθε μήνα</SelectItem>
                  <SelectItem value="yearly">Κάθε χρόνο</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Ημέρα" htmlFor="rec-day">
              <Input id="rec-day" inputMode="numeric" className="tabular-nums" value={form.day} onChange={e => set('day', e.target.value)} />
            </Field>
            {form.frequency === 'yearly' && (
              <Field label="Μήνας">
                <Select value={form.month} onValueChange={v => set('month', v)}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MONTHS.map((m, i) => <SelectItem key={m} value={String(i + 1)}>{m}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Από" htmlFor="rec-start">
              <Input id="rec-start" type="date" required value={form.startDate} onChange={e => set('startDate', e.target.value)} />
            </Field>
            <Field label="Έως (προαιρετικό)" htmlFor="rec-end">
              <Input id="rec-end" type="date" value={form.endDate} onChange={e => set('endDate', e.target.value)} />
            </Field>
          </div>

          {error && <p className="text-sm text-negative">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={save.isPending}>Αποθήκευση</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
