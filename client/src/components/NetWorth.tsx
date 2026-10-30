import { useNavigate } from 'react-router';
import { Area, Bar, BarChart, Cell, ComposedChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatEur, formatMonth, type NetWorthBreakdown, type NetWorthHistory, type NetWorthMonth } from '@budget/shared';
import { Amount } from '@/components/Amount';
import { DonutChart, type DonutSlice } from '@/components/DonutChart';
import { useAccounts } from '@/lib/api';
import { cn } from '@/lib/utils';

const MONTH_SHORT = ['Ιαν', 'Φεβ', 'Μαρ', 'Απρ', 'Μαΐ', 'Ιουν', 'Ιουλ', 'Αυγ', 'Σεπ', 'Οκτ', 'Νοε', 'Δεκ'];
const compactEur = new Intl.NumberFormat('el-GR', { notation: 'compact', style: 'currency', currency: 'EUR', maximumFractionDigits: 1 });
const AXIS_CLASS = '[&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground [&_.recharts-reference-line_line]:stroke-border';

/** Κύκλος: Τράπεζες (και πορτοφόλι), Επενδύσεις (μετοχές + μετρητά στους brokers), Μου χρωστάνε. Τα χρέη φαίνονται από κάτω. */
export function NetWorthDonut({ breakdown: b }: { breakdown: NetWorthBreakdown }) {
  const { data: accounts = [] } = useAccounts();
  const accountName = (id: number) => accounts.find(a => a.id === id)?.name ?? '—';
  const slices: DonutSlice[] = [
    {
      name: 'Τράπεζες',
      value: b.cash,
      details: b.cashByAccount.map(a => ({ name: accountName(a.accountId), value: a.amount })),
    },
    {
      name: 'Επενδύσεις',
      value: b.stocks + b.brokerCash,
      details: [{ name: 'Μετοχές', value: b.stocks }, { name: 'Αεπένδυτα', value: b.brokerCash }].filter(d => d.value !== 0),
    },
    { name: 'Μου χρωστάνε', value: b.receivables },
  ];
  // Αρνητικά κομμάτια (π.χ. μετρητά μείον) δεν χωράνε στον κύκλο: φαίνονται από κάτω, όπως τα χρέη
  const extraRows = [
    ...slices.filter(s => s.value < 0).map(s => ({ name: s.name, value: s.value })),
    ...(b.debts > 0 ? [{ name: 'Χρέη', value: -b.debts }] : []),
  ];
  return (
    <DonutChart
      centerLabel="Περιουσία"
      centerValue={b.total}
      detailsSigned={false}
      data={slices}
      extraRows={extraRows}
      emptyText="Δεν υπάρχουν ακόμα υπόλοιπα"
    />
  );
}

interface ChangeParts {
  start: number;
  end: number;
  change: number;
  savings: number;
  marketChange: number;
  incomplete: boolean;
}

/** «Πώς άλλαξε»: αρχή → τέλος και ανάλυση της μεταβολής. */
export function NetWorthChange({ parts: p, startLabel, endLabel }: { parts: ChangeParts; startLabel: string; endLabel: string }) {
  const rows = [
    { label: 'Αποταμίευση', hint: 'έσοδα − έξοδα', value: p.savings, show: true },
    { label: 'Αξία μετοχών', hint: 'άνοδος/πτώση της αγοράς', value: p.marketChange, show: p.marketChange !== 0 },
  ];
  return (
    <div className="space-y-4 text-sm">
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="text-xs text-muted-foreground">Μεταβολή</div>
          <Amount cents={p.change} signed colored className="text-2xl font-bold tracking-tight" />
        </div>
        <div className="text-right text-xs text-muted-foreground">
          {startLabel} {formatEur(p.start)}
          <div>{endLabel} {formatEur(p.end)}</div>
        </div>
      </div>
      <ul className="space-y-2 border-t pt-3">
        {rows.filter(r => r.show).map(r => (
          <li key={r.label} className="flex items-baseline justify-between gap-3">
            <span>
              {r.label}
              {r.hint && <span className="text-xs text-muted-foreground"> · {r.hint}</span>}
            </span>
            <Amount cents={r.value} signed colored className="font-medium" />
          </li>
        ))}
      </ul>
      {p.incomplete && (
        <p className="text-xs text-muted-foreground">* Λείπει κάποια τιμή μετοχής, η αξία της υπολογίστηκε με το κόστος αγοράς.</p>
      )}
    </div>
  );
}

interface ChartDatum {
  label: string;
  month: string;
  total: number;
  change: number;
}

/** Πορεία καθαρής περιουσίας (γραμμή) και μεταβολή ανά μήνα (στήλες). */
export function NetWorthChart({ months }: { months: NetWorthMonth[] }) {
  const navigate = useNavigate();
  const data: ChartDatum[] = months.map(m => ({
    label: MONTH_SHORT[Number(m.month.slice(5)) - 1]!,
    month: m.month,
    total: m.end.total / 100,
    change: m.change / 100,
  }));
  const tooltip = ({ active, payload }: { active?: boolean; payload?: ReadonlyArray<{ payload?: unknown }> }) => {
    const d = payload?.[0]?.payload as ChartDatum | undefined;
    if (!active || !d) return null;
    return (
      <div className="space-y-1 rounded-xl border bg-popover px-3 py-2 text-xs shadow-lg">
        <div className="font-medium">{formatMonth(d.month)}</div>
        <div className="flex justify-between gap-6"><span>Περιουσία</span><span>{formatEur(Math.round(d.total * 100))}</span></div>
        <div className="flex justify-between gap-6"><span>Μεταβολή</span><Amount cents={Math.round(d.change * 100)} signed colored /></div>
      </div>
    );
  };
  const open = (entry: { payload?: ChartDatum }) => entry.payload && navigate(`/month/${entry.payload.month}`);

  return (
    <div className="space-y-2">
      <div className="h-56">
        <ResponsiveContainer>
          {/* ComposedChart: τα σημεία μπαίνουν στο κέντρο κάθε μήνα, όπως οι στήλες από κάτω */}
          <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} className={AXIS_CLASS}>
            <defs>
              <linearGradient id="nw-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.25} />
                <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="label" scale="band" tickLine={false} axisLine={false} tick={{ fontSize: 12 }} />
            <YAxis width={64} tickLine={false} axisLine={false} tick={{ fontSize: 12 }} domain={['auto', 'auto']} tickFormatter={(v: number) => compactEur.format(v)} />
            <Tooltip content={tooltip} cursor={{ className: 'stroke-border' }} />
            <Area
              type="monotone"
              dataKey="total"
              strokeWidth={2}
              stroke="currentColor"
              className="text-primary"
              fill="url(#nw-fill)"
              dot={data.length === 1 ? { r: 4, className: 'fill-primary stroke-card' } : false}
              activeDot={{ r: 5, className: 'fill-primary stroke-card cursor-pointer', strokeWidth: 2, onClick: (_: unknown, e: unknown) => open(e as { payload?: ChartDatum }) }}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="h-28">
        <ResponsiveContainer>
          <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }} className={AXIS_CLASS}>
            <XAxis dataKey="label" hide />
            <YAxis width={64} tickLine={false} axisLine={false} tick={{ fontSize: 11 }} tickCount={3} tickFormatter={(v: number) => compactEur.format(v)} />
            <ReferenceLine y={0} />
            <Tooltip content={tooltip} cursor={{ className: 'fill-muted' }} />
            <Bar dataKey="change" radius={4} maxBarSize={24} className="cursor-pointer" onClick={open} isAnimationActive={false}>
              {data.map(d => <Cell key={d.month} className={cn(d.change < 0 ? 'fill-negative' : 'fill-positive')} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="text-center text-xs text-muted-foreground">Πάνω: περιουσία στο τέλος κάθε μήνα · Κάτω: μεταβολή του μήνα</p>
    </div>
  );
}

/**
 * Συνολική εικόνα (Λογαριασμοί): η περιουσία σήμερα, η μεταβολή κάθε έτους
 * και η συνολική μεταβολή από τον πρώτο μήνα με κινήσεις.
 */
export function NetWorthOverview({ history }: { history: NetWorthHistory }) {
  const navigate = useNavigate();
  const first = history.months[0];
  const num = 'py-2 pl-3 text-right tabular-nums whitespace-nowrap';
  return (
    <div className="grid gap-8 md:grid-cols-2">
      <NetWorthDonut breakdown={history.current} />
      {first ? (
        <div className="min-w-0 overflow-x-auto text-sm">
          <table className="w-full">
            <thead className="text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="py-2 text-left font-medium">Έτος</th>
                <th className={cn(num, 'hidden font-medium sm:table-cell')}>Αρχή</th>
                <th className={cn(num, 'font-medium')}>Τέλος</th>
                <th className={cn(num, 'font-medium')}>Μεταβολή</th>
              </tr>
            </thead>
            <tbody>
              {history.years.map(y => (
                <tr key={y.year} onClick={() => navigate(`/year/${y.year}`)} className="cursor-pointer border-b hover:bg-muted/50">
                  <td className="py-2">{y.year}</td>
                  <td className={cn(num, 'hidden sm:table-cell')}>{formatEur(y.start)}</td>
                  <td className={num}>{formatEur(y.end)}</td>
                  <td className={num}><Amount cents={y.change} signed colored /></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <td className="py-2 whitespace-nowrap">Από την αρχή</td>
                <td className={cn(num, 'hidden sm:table-cell')}>{formatEur(first.start)}</td>
                <td className={num}>{formatEur(history.current.total)}</td>
                <td className={num}><Amount cents={history.current.total - first.start} signed colored /></td>
              </tr>
            </tfoot>
          </table>
          <p className="mt-2 text-xs text-muted-foreground">
            Πρώτος μήνας με κινήσεις: {formatMonth(first.month)}. Πάτα ένα έτος για λεπτομέρειες.
          </p>
        </div>
      ) : (
        <p className="self-center text-sm text-muted-foreground">
          Η πορεία ανά έτος θα εμφανιστεί μόλις καταχωρήσεις την πρώτη σου κίνηση.
        </p>
      )}
    </div>
  );
}
