import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  PiggyBank,
  Plus,
  Scale,
  Trash2,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { Navigate, useParams } from 'react-router';
import {
  currentMonth,
  formatEur,
  formatEurSigned,
  formatMonth,
  lastDayOfMonth,
  MONTH_KEY_RE,
  shiftMonth,
  today,
  type Category,
  type MonthSummary,
  type Transaction,
} from '@budget/shared';
import { Amount } from '@/components/Amount';
import { CategoryBadge } from '@/components/CategoryBadge';
import { DonutChart } from '@/components/DonutChart';
import { PeriodNav } from '@/components/PeriodNav';
import { SavingsAllocationChart } from '@/components/SavingsAllocationChart';
import { StatCard } from '@/components/StatCard';
import { TransactionDialog } from '@/components/TransactionDialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAccounts, useCategories, useDeleteTransaction, useSummary, useTransactions } from '@/lib/api';
import { cn } from '@/lib/utils';

const dayFormatter = new Intl.DateTimeFormat('el-GR', { weekday: 'long', day: 'numeric', month: 'long' });
const formatDay = (date: string) => dayFormatter.format(new Date(`${date}T00:00:00`));

export function MonthPage() {
  const { month = '' } = useParams();
  if (!MONTH_KEY_RE.test(month)) return <Navigate to={`/month/${currentMonth()}`} replace />;
  return <MonthView key={month} month={month} />;
}

function MonthView({ month }: { month: string }) {
  const { data: summary } = useSummary(month);
  const { data: transactions = [], isLoading } = useTransactions(month);
  const { data: categories = [] } = useCategories();
  const [dialog, setDialog] = useState<{ open: boolean; transaction?: Transaction }>({ open: false });

  const category = (id: number | null) => categories.find(c => c.id === id);
  const categoryName = (id: number | null) => category(id)?.name ?? '—';
  // Νέα συναλλαγή: σημερινή ημερομηνία αν είμαστε στον τρέχοντα μήνα, αλλιώς η τελευταία μέρα του μήνα
  const defaultDate = month === currentMonth() ? today() : month < currentMonth() ? lastDayOfMonth(month) : `${month}-01`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PeriodNav
          eyebrow="Μηνιαία εικόνα"
          title={formatMonth(month)}
          prev={{ to: `/month/${shiftMonth(month, -1)}`, title: 'Προηγούμενος μήνας' }}
          next={{ to: `/month/${shiftMonth(month, 1)}`, title: 'Επόμενος μήνας' }}
          current={month !== currentMonth() ? { to: `/month/${currentMonth()}`, label: 'Σήμερα' } : undefined}
        />
        <Button className="rounded-full shadow-soft" onClick={() => setDialog({ open: true })}>
          <Plus className="size-4" /> Νέα συναλλαγή
        </Button>
      </div>

      {summary && <MonthStats summary={summary} />}
      {summary && <StatusMessage summary={summary} />}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Πού πήγε η αποταμίευση</CardTitle></CardHeader>
          <CardContent>{summary && <SavingsAllocationChart summary={summary} />}</CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Έξοδα ανά κατηγορία</CardTitle></CardHeader>
          <CardContent>
            <DonutChart
              centerLabel="Έξοδα"
              data={(summary?.expensesByCategory ?? []).map(c => ({ name: categoryName(c.categoryId), value: c.amount, color: category(c.categoryId)?.color }))}
              emptyText="Κανένα έξοδο αυτόν τον μήνα"
            />
          </CardContent>
        </Card>
      </div>

      <section className="pt-2">
        <h2 className="mb-3 text-lg font-bold tracking-tight">Συναλλαγές</h2>
        {!isLoading && transactions.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed p-10 text-center text-sm text-muted-foreground">
            Δεν υπάρχουν συναλλαγές αυτόν τον μήνα.
            <div className="mt-4">
              <Button variant="outline" className="rounded-full" onClick={() => setDialog({ open: true })}>
                <Plus className="size-4" /> Πρόσθεσε τον μισθό σου
              </Button>
            </div>
          </div>
        ) : (
          <TransactionList
            transactions={transactions}
            category={category}
            onSelect={t => setDialog({ open: true, transaction: t })}
          />
        )}
      </section>

      <TransactionDialog
        open={dialog.open}
        onOpenChange={open => setDialog(d => ({ ...d, open }))}
        transaction={dialog.transaction}
        defaultDate={defaultDate}
      />
    </div>
  );
}

function MonthStats({ summary: s }: { summary: MonthSummary }) {
  const rate = s.savingsRate == null ? null : `${Math.round(s.savingsRate * 100)}% των εσόδων`;
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
      <StatCard label="Έσοδα" icon={ArrowDownLeft} tone="positive"><Amount cents={s.income} /></StatCard>
      <StatCard label="Έξοδα" icon={ArrowUpRight} tone="negative"><Amount cents={s.expenses} /></StatCard>
      <StatCard
        label="Αποταμίευση"
        icon={s.savings < 0 ? TrendingDown : TrendingUp}
        tone={s.savings < 0 ? 'negative' : 'primary'}
        sub={[rate, s.adjustments !== 0 && `διορθώσεις ${formatEurSigned(s.adjustments)}`].filter(Boolean).join(' · ') || undefined}
      >
        <Amount cents={s.savings} signed colored />
      </StatCard>
      <StatCard label="Στην άκρη" icon={PiggyBank} tone="neutral" sub="μεταφορές σε αποταμίευση">
        <Amount cents={s.setAside} />
      </StatCard>
    </div>
  );
}

function StatusMessage({ summary: s }: { summary: MonthSummary }) {
  if (s.income === 0 && s.expenses === 0) return null;
  if (s.status === 'overspent') {
    return (
      <p className="flex items-start gap-3 rounded-2xl bg-negative/10 px-4 py-3 text-sm text-negative">
        <TrendingDown className="mt-0.5 size-4 shrink-0" />
        <span>Ξεπέρασες τα έσοδα κατά {formatEur(s.fromSavings)}. Η διαφορά βγήκε από τα μαζεμένα.</span>
      </p>
    );
  }
  if (s.status === 'below-set-aside') {
    return (
      <p className="flex items-start gap-3 rounded-2xl bg-warning/10 px-4 py-3 text-sm text-warning">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        <span>Έβαλες στην άκρη {formatEur(s.setAside)}, αλλά τελικά αποταμίευσες {formatEur(s.savings)}.
        {' '}{formatEur(s.fromSavings)} ήρθαν από τα μαζεμένα.</span>
      </p>
    );
  }
  return null;
}

function TransactionList({
  transactions,
  category,
  onSelect,
}: {
  transactions: Transaction[];
  category: (id: number | null) => Category | undefined;
  onSelect: (t: Transaction) => void;
}) {
  const { data: accounts = [] } = useAccounts();
  const remove = useDeleteTransaction();
  const accountName = (id: number | null) => accounts.find(a => a.id === id)?.name ?? '—';

  const byDay = useMemo(() => {
    const groups = new Map<string, Transaction[]>();
    for (const t of transactions) groups.set(t.date, [...(groups.get(t.date) ?? []), t]);
    return [...groups];
  }, [transactions]);

  return (
    <div className="space-y-5">
      {byDay.map(([date, items]) => (
        <div key={date}>
          <div className="mb-2 px-1 text-xs font-semibold text-muted-foreground first-letter:uppercase">{formatDay(date)}</div>
          <ul className="surface divide-y overflow-hidden">
            {items.map(t => (
              <li key={t.id} className="group flex items-center transition-colors hover:bg-muted/60">
                <button
                  type="button"
                  onClick={() => t.type !== 'adjustment' && onSelect(t)}
                  className={cn(
                    'flex min-w-0 flex-1 items-center gap-3 py-3 pl-4 text-left outline-none',
                    t.type === 'adjustment' && 'cursor-default',
                  )}
                >
                  <TransactionIcon transaction={t} category={category(t.categoryId)} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">
                      {t.type === 'transfer' ? 'Μεταφορά' : t.type === 'adjustment' ? 'Διόρθωση υπολοίπου' : category(t.categoryId)?.name ?? '—'}
                      {t.description && t.type !== 'adjustment' && <span className="font-normal text-muted-foreground"> · {t.description}</span>}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {t.type === 'transfer' ? `${accountName(t.accountId)} → ${accountName(t.toAccountId)}` : accountName(t.accountId)}
                    </div>
                  </div>
                  <TransactionAmount transaction={t} />
                </button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  title="Διαγραφή"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(t)}
                  className="mx-2 rounded-full text-muted-foreground hover:bg-negative/10 hover:text-negative focus-visible:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                >
                  <Trash2 className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

// Για συναλλαγές χωρίς κατηγορία (μεταφορές, διορθώσεις)
const TX_ICON = {
  transfer: { icon: ArrowLeftRight, className: 'bg-primary/12 text-primary' },
  adjustment: { icon: Scale, className: 'bg-muted text-muted-foreground' },
} as const;

function TransactionIcon({ transaction: t, category }: { transaction: Transaction; category?: Category }) {
  if (t.type === 'income' || t.type === 'expense') {
    return <CategoryBadge icon={category?.icon ?? 'tag'} color={category?.color ?? 'slate'} />;
  }
  const { icon: Icon, className } = TX_ICON[t.type];
  return (
    <span className={cn('grid size-9 shrink-0 place-items-center rounded-full', className)}>
      <Icon className="size-4" />
    </span>
  );
}

function TransactionAmount({ transaction: t }: { transaction: Transaction }) {
  switch (t.type) {
    case 'income':
      return <Amount cents={t.amount} signed colored className="text-sm font-semibold" />;
    case 'expense':
      return <Amount cents={-t.amount} signed className="text-sm font-semibold" />;
    case 'transfer':
      return <Amount cents={t.amount} className="text-sm text-muted-foreground" />;
    case 'adjustment':
      return <Amount cents={t.amount} signed className="text-sm text-muted-foreground" />;
  }
}
