import { ArrowDownLeft, ArrowUpRight, CalendarCheck, ChartLine, TrendingDown, TrendingUp } from 'lucide-react';
import { Navigate, useNavigate, useParams } from 'react-router';
import { Bar, BarChart, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatEur, formatMonth, type MonthStatus, type YearMonth, type YearSummary } from '@budget/shared';
import { Amount } from '@/components/Amount';
import { DonutChart } from '@/components/DonutChart';
import { PeriodNav } from '@/components/PeriodNav';
import { SavingsAllocationChart } from '@/components/SavingsAllocationChart';
import { StatCard } from '@/components/StatCard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useCategories, useYearSummary } from '@/lib/api';
import { cn } from '@/lib/utils';

const MONTH_SHORT = ['Ιαν', 'Φεβ', 'Μαρ', 'Απρ', 'Μαΐ', 'Ιουν', 'Ιουλ', 'Αυγ', 'Σεπ', 'Οκτ', 'Νοε', 'Δεκ'];
const compactEur = new Intl.NumberFormat('el-GR', {
  notation: 'compact',
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 1,
});
const formatRate = (rate: number | null) => (rate == null ? '—' : `${Math.round(rate * 100)}%`);
const monthName = (month: string) => formatMonth(month).split(' ')[0];

export function YearPage() {
  const { year = '' } = useParams();
  if (!/^\d{4}$/.test(year)) return <Navigate to={`/year/${new Date().getFullYear()}`} replace />;
  return <YearView key={year} year={Number(year)} />;
}

function YearView({ year }: { year: number }) {
  const { data } = useYearSummary(year);
  const { data: categories = [] } = useCategories();
  const category = (id: number) => categories.find(c => c.id === id);
  const thisYear = new Date().getFullYear();

  return (
    <div className="space-y-6">
      <PeriodNav
        eyebrow="Ετήσια εικόνα"
        title={String(year)}
        prev={{ to: `/year/${year - 1}`, title: 'Προηγούμενο έτος' }}
        next={{ to: `/year/${year + 1}`, title: 'Επόμενο έτος' }}
        current={year !== thisYear ? { to: `/year/${thisYear}`, label: 'Φέτος' } : undefined}
      />

      {data && (
        <>
          <YearStats data={data} />

          <Card>
            <CardHeader><CardTitle>Αποταμίευση ανά μήνα</CardTitle></CardHeader>
            <CardContent><SavingsBarChart months={data.months} /></CardContent>
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>Πού πήγε η αποταμίευση</CardTitle></CardHeader>
              <CardContent><SavingsAllocationChart summary={data.total} /></CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Έξοδα ανά κατηγορία</CardTitle></CardHeader>
              <CardContent>
                <DonutChart
                  centerLabel="Έξοδα"
                  data={data.total.expensesByCategory.map(c => ({ name: category(c.categoryId)?.name ?? '—', value: c.amount, color: category(c.categoryId)?.color }))}
                  emptyText="Κανένα έξοδο αυτό το έτος"
                />
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader><CardTitle>Ανά μήνα</CardTitle></CardHeader>
            <CardContent><MonthsTable data={data} /></CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function YearStats({ data }: { data: YearSummary }) {
  const t = data.total;
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
      <StatCard label="Έσοδα" icon={ArrowDownLeft} tone="positive"><Amount cents={t.income} /></StatCard>
      <StatCard label="Έξοδα" icon={ArrowUpRight} tone="negative"><Amount cents={t.expenses} /></StatCard>
      <StatCard
        label="Αποταμίευση"
        icon={t.savings < 0 ? TrendingDown : TrendingUp}
        tone={t.savings < 0 ? 'negative' : 'primary'}
        sub={`${formatRate(t.savingsRate)} των εσόδων`}
      >
        <Amount cents={t.savings} signed colored />
      </StatCard>
      <StatCard label="Σε brokers" icon={ChartLine} tone="primary"><Amount cents={t.toBrokers} /></StatCard>
      <StatCard label="Μήνες" icon={CalendarCheck} sub="συν / μείον" className="col-span-2 lg:col-span-1">
        <span className="text-positive">{data.positiveMonths}</span>
        <span className="text-muted-foreground"> / </span>
        <span className="text-negative">{data.negativeMonths}</span>
      </StatCard>
    </div>
  );
}

interface BarDatum {
  label: string;
  month: string;
  savings: number | null;
  summary: YearMonth['summary'];
}

function SavingsBarChart({ months }: { months: YearMonth[] }) {
  const navigate = useNavigate();
  const data: BarDatum[] = months.map((m, i) => ({
    label: MONTH_SHORT[i]!,
    month: m.month,
    savings: m.hasData ? m.summary.savings / 100 : null,
    summary: m.summary,
  }));

  return (
    <div className="h-60">
      <ResponsiveContainer>
        <BarChart
          data={data}
          margin={{ top: 8, right: 0, left: 0, bottom: 0 }}
          className="[&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground [&_.recharts-reference-line_line]:stroke-border"
        >
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 12 }} />
          <YAxis
            width={64}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 12 }}
            tickFormatter={(v: number) => compactEur.format(v)}
          />
          <ReferenceLine y={0} />
          <Tooltip
            cursor={{ className: 'fill-muted' }}
            content={({ active, payload }) => {
              const d = payload?.[0]?.payload as BarDatum | undefined;
              if (!active || !d || d.savings == null) return null;
              return (
                <div className="space-y-1 rounded-xl border bg-popover px-3 py-2 text-xs shadow-lg">
                  <div className="font-medium">{formatMonth(d.month)}</div>
                  <div className="flex justify-between gap-6"><span>Έσοδα</span><span>{formatEur(d.summary.income)}</span></div>
                  <div className="flex justify-between gap-6"><span>Έξοδα</span><span>{formatEur(d.summary.expenses)}</span></div>
                  <div className="flex justify-between gap-6 font-medium">
                    <span>Αποταμίευση</span><Amount cents={d.summary.savings} signed colored />
                  </div>
                </div>
              );
            }}
          />
          <Bar
            dataKey="savings"
            radius={4}
            maxBarSize={32}
            className="cursor-pointer"
            onClick={(entry: { payload?: BarDatum }) => entry.payload && navigate(`/month/${entry.payload.month}`)}
          >
            {data.map(d => (
              <Cell key={d.month} className={d.savings != null && d.savings < 0 ? 'fill-negative' : 'fill-positive'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

const STATUS: Record<MonthStatus, { className: string; title: string }> = {
  ok: { className: 'bg-positive', title: 'Εντάξει' },
  'below-set-aside': { className: 'bg-warning', title: 'Αποταμίευσες λιγότερα από όσα έβαλες στην άκρη' },
  overspent: { className: 'bg-negative', title: 'Ξεπέρασες τα έσοδα' },
};

function MonthsTable({ data }: { data: YearSummary }) {
  const navigate = useNavigate();
  const t = data.total;
  const num = 'px-3 py-2 text-right tabular-nums whitespace-nowrap';

  return (
    <div className="-mx-6 overflow-x-auto px-6">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-xs text-muted-foreground">
            <th className="py-2 pr-3 text-left font-medium">Μήνας</th>
            <th className={cn(num, 'font-medium')}>Έσοδα</th>
            <th className={cn(num, 'font-medium')}>Έξοδα</th>
            <th className={cn(num, 'font-medium')}>Αποταμίευση</th>
            <th className={cn(num, 'font-medium')}>%</th>
            <th className={cn(num, 'font-medium')}>Στην άκρη</th>
            <th className={cn(num, 'font-medium')}>Σε brokers</th>
            <th className="w-6" />
          </tr>
        </thead>
        <tbody>
          {data.months.map(({ month, hasData, summary: s }) => (
            <tr
              key={month}
              onClick={() => navigate(`/month/${month}`)}
              className={cn('cursor-pointer border-b last:border-0 hover:bg-muted/50', !hasData && 'text-muted-foreground')}
            >
              <td className="py-2 pr-3">{monthName(month)}</td>
              {hasData ? (
                <>
                  <td className={num}>{formatEur(s.income)}</td>
                  <td className={num}>{formatEur(s.expenses)}</td>
                  <td className={num}><Amount cents={s.savings} signed colored /></td>
                  <td className={cn(num, 'text-muted-foreground')}>{formatRate(s.savingsRate)}</td>
                  <td className={num}>{s.setAside ? formatEur(s.setAside) : '—'}</td>
                  <td className={num}>{s.toBrokers ? formatEur(s.toBrokers) : '—'}</td>
                  <td className="py-2 pl-1">
                    {(s.income > 0 || s.expenses > 0) && (
                      <span title={STATUS[s.status].title} className={cn('block size-2 rounded-full', STATUS[s.status].className)} />
                    )}
                  </td>
                </>
              ) : (
                <td colSpan={7} className="px-3 py-2 text-right">—</td>
              )}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t font-medium">
            <td className="py-2 pr-3">Σύνολο</td>
            <td className={num}>{formatEur(t.income)}</td>
            <td className={num}>{formatEur(t.expenses)}</td>
            <td className={num}><Amount cents={t.savings} signed colored /></td>
            <td className={cn(num, 'text-muted-foreground')}>{formatRate(t.savingsRate)}</td>
            <td className={num}>{t.setAside ? formatEur(t.setAside) : '—'}</td>
            <td className={num}>{t.toBrokers ? formatEur(t.toBrokers) : '—'}</td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
