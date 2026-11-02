import {
  Activity,
  AlertTriangle,
  ChartPie,
  ChevronDown,
  Coins,
  PackagePlus,
  Pencil,
  Plus,
  ShoppingCart,
  Trash2,
  TrendingDown,
  TrendingUp,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  formatEur,
  formatPercent,
  formatPrice,
  formatQuantity,
  TRADE_SIDE_LABELS,
  type Instrument,
  type Pie,
  type PieDrift,
  type Position,
  type Trade,
  type TradeSide,
} from '@budget/shared';
import { Amount } from '@/components/Amount';
import { DonutChart } from '@/components/DonutChart';
import { InstrumentDialog } from '@/components/InstrumentDialog';
import { PieBuyDialog, type PieDialogMode } from '@/components/PieBuyDialog';
import { PieEditDialog } from '@/components/PieEditDialog';
import { StatCard } from '@/components/StatCard';
import { TradeDialog } from '@/components/TradeDialog';
import { groupTrades, singleTrade, TickerBadge, TradeAmount } from '@/components/TradeRows';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  useAccounts,
  useDeleteInstrument,
  useDeletePie,
  useDeleteTrades,
  useInstruments,
  usePies,
  usePortfolio,
  useTrades,
} from '@/lib/api';
import { cn } from '@/lib/utils';

const dayFormatter = new Intl.DateTimeFormat('el-GR', { day: 'numeric', month: 'long', year: 'numeric' });
const formatDay = (date: string) => dayFormatter.format(new Date(`${date}T00:00:00`));

type DialogState =
  | { kind: 'closed' }
  | { kind: 'trade'; trade?: Trade; side?: TradeSide }
  | { kind: 'pie-buy'; pie: Pie; mode: PieDialogMode }
  | { kind: 'pie-edit'; pie: Pie }
  | { kind: 'pie-new' }
  | { kind: 'instrument' };

export function InvestmentsPage() {
  const { data: portfolio } = usePortfolio();
  const { data: trades = [], isLoading } = useTrades();
  const { data: instruments = [] } = useInstruments();
  const { data: pies = [] } = usePies();
  const { data: accounts = [] } = useAccounts();
  const [dialog, setDialog] = useState<DialogState>({ kind: 'closed' });
  const close = () => setDialog({ kind: 'closed' });
  const deletePie = useDeletePie();

  const instrument = (id: number) => instruments.find(i => i.id === id);
  const accountName = (id: number) => accounts.find(a => a.id === id)?.name ?? '—';
  const positions = portfolio?.positions ?? [];
  const mainPie = pies[0];

  const byInstrument = useMemo(() => {
    const map = new Map<number, number>();
    for (const p of positions) map.set(p.instrumentId, (map.get(p.instrumentId) ?? 0) + (p.valueEur ?? p.costEur));
    return [...map];
  }, [positions]);
  const byAccount = useMemo(() => {
    const map = new Map<number, { value: number; cost: number }>();
    for (const p of positions) {
      const a = map.get(p.accountId) ?? { value: 0, cost: 0 };
      a.value += p.valueEur ?? p.costEur;
      a.cost += p.costEur;
      map.set(p.accountId, a);
    }
    return [...map].sort((a, b) => b[1].value - a[1].value);
  }, [positions]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-xs font-medium text-muted-foreground">Μετοχές και ETF</div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Επενδύσεις</h1>
        </div>
        <div className="flex gap-2">
          {mainPie && (
            <Button variant="outline" className="rounded-full" onClick={() => setDialog({ kind: 'pie-buy', pie: mainPie, mode: 'buy' })}>
              <ChartPie className="size-4" /> Αγορά στο pie
            </Button>
          )}
          <Button className="rounded-full shadow-soft" onClick={() => setDialog({ kind: 'trade' })}>
            <Plus className="size-4" /> Νέα κίνηση
          </Button>
        </div>
      </div>

      {portfolio?.stale && positions.length > 0 && (
        <p className="flex items-start gap-3 rounded-2xl bg-warning/10 px-4 py-3 text-sm text-warning">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>Κάποιες τιμές δεν είναι τρέχουσες, γιατί το Yahoo Finance δεν απάντησε. Δείχνω την τελευταία γνωστή τιμή.</span>
        </p>
      )}

      {/* Αρνητικά μετρητά σε broker: συνήθως αγορά χωρίς τη μεταφορά που την πλήρωσε */}
      {accounts.filter(a => a.type === 'broker' && a.balance < 0).map(a => (
        <p key={a.id} className="flex items-start gap-3 rounded-2xl bg-warning/10 px-4 py-3 text-sm text-warning">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>
            Τα μετρητά στο {a.name} είναι {formatEur(a.balance)}: κάποια αγορά δεν έχει από πού πληρώθηκε. Άνοιξέ την
            στις Κινήσεις και διάλεξε «Χρήματα από» (π.χ. Τράπεζα Πειραιώς), ή κάνε μεταφορά προς το {a.name}.
          </span>
        </p>
      ))}

      {!isLoading && trades.length === 0 ? (
        <GettingStarted
          pie={mainPie}
          onPieOpening={pie => setDialog({ kind: 'pie-buy', pie, mode: 'opening' })}
          onOpening={() => setDialog({ kind: 'trade', side: 'opening' })}
        />
      ) : (
        portfolio && (
          <>
            <PortfolioStats portfolio={portfolio} />
            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader><CardTitle>Ανά μετοχή</CardTitle></CardHeader>
                <CardContent>
                  <DonutChart centerLabel="Αξία" data={byInstrument.map(([id, value]) => ({ name: instrument(id)?.name ?? '—', value }))} />
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle>Ανά πλατφόρμα</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <DonutChart centerLabel="Αξία" data={byAccount.map(([id, a]) => ({ name: accountName(id), value: a.value }))} />
                  <PlatformTable rows={byAccount.map(([id, a]) => ({ id, name: accountName(id), ...a }))} />
                </CardContent>
              </Card>
            </div>
          </>
        )
      )}

      {positions.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-bold tracking-tight">Θέσεις</h2>
          <ul className="surface divide-y overflow-hidden">
            {[...positions]
              .sort((a, b) => (b.valueEur ?? b.costEur) - (a.valueEur ?? a.costEur))
              .map(p => (
                <PositionRow key={`${p.accountId}:${p.instrumentId}`} position={p} instrument={instrument(p.instrumentId)} accountName={accountName(p.accountId)} />
              ))}
          </ul>
        </section>
      )}

      {pies.map(pie => (
        <PieCard
          key={pie.id}
          pie={pie}
          drift={portfolio?.pies.find(d => d.pieId === pie.id)}
          instrument={instrument}
          accountName={accountName(pie.accountId)}
          onBuy={() => setDialog({ kind: 'pie-buy', pie, mode: 'buy' })}
          onOpening={() => setDialog({ kind: 'pie-buy', pie, mode: 'opening' })}
          onEdit={() => setDialog({ kind: 'pie-edit', pie })}
          onDelete={() => confirm(`Διαγραφή του pie «${pie.name}»; Οι μετοχές του μένουν.`) && deletePie.mutate(pie.id)}
        />
      ))}

      {trades.length > 0 && (
        <TradeList
          trades={trades}
          instrument={instrument}
          accountName={accountName}
          pieName={id => pies.find(p => p.id === id)?.name}
          onSelect={t => setDialog({ kind: 'trade', trade: t })}
        />
      )}

      <InstrumentList
        instruments={instruments}
        onAdd={() => setDialog({ kind: 'instrument' })}
        onNewPie={accounts.some(a => a.type === 'broker') ? () => setDialog({ kind: 'pie-new' }) : undefined}
      />

      <TradeDialog
        open={dialog.kind === 'trade'}
        onOpenChange={open => !open && close()}
        trade={dialog.kind === 'trade' ? dialog.trade : undefined}
        defaultSide={dialog.kind === 'trade' ? dialog.side : undefined}
      />
      <PieBuyDialog
        pie={dialog.kind === 'pie-buy' ? dialog.pie : undefined}
        mode={dialog.kind === 'pie-buy' ? dialog.mode : 'buy'}
        onClose={close}
      />
      <PieEditDialog pie={dialog.kind === 'pie-edit' ? dialog.pie : undefined} create={dialog.kind === 'pie-new'} onClose={close} />
      <InstrumentDialog open={dialog.kind === 'instrument'} onClose={close} />
    </div>
  );
}

function GettingStarted({ pie, onPieOpening, onOpening }: { pie?: Pie; onPieOpening: (pie: Pie) => void; onOpening: () => void }) {
  return (
    <div className="surface space-y-4 p-6 text-sm">
      <div>
        <h2 className="text-lg font-bold tracking-tight">Ξεκίνα με ό,τι έχεις ήδη</h2>
        <p className="mt-1 text-muted-foreground">
          Πέρασε μία φορά τις μετοχές που έχεις σήμερα (ποσότητα και συνολικό κόστος). Από εκεί και πέρα καταχωρείς μόνο τις
          νέες αγορές. Οι αρχικές θέσεις δεν επηρεάζουν τα μετρητά ούτε την αποταμίευση του μήνα.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {pie && (
          <Button className="rounded-full" onClick={() => onPieOpening(pie)}>
            <PackagePlus className="size-4" /> Αρχικές θέσεις στο pie
          </Button>
        )}
        <Button variant="outline" className="rounded-full" onClick={onOpening}>
          <Plus className="size-4" /> Αρχική θέση (π.χ. VUSA)
        </Button>
      </div>
    </div>
  );
}

function PortfolioStats({ portfolio: p }: { portfolio: NonNullable<ReturnType<typeof usePortfolio>['data']> }) {
  const gain = p.valueEur - p.costEur;
  const gainPct = p.costEur > 0 ? gain / p.costEur : null;
  const prevValue = p.valueEur - p.dayChangeEur;
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
      <StatCard label="Αξία" icon={ChartPie} tone="primary"><Amount cents={p.valueEur} /></StatCard>
      <StatCard label="Επένδυσες" icon={Coins} tone="neutral" sub="κόστος κτήσης"><Amount cents={p.costEur} /></StatCard>
      <StatCard
        label="Κέρδος"
        icon={gain < 0 ? TrendingDown : TrendingUp}
        tone={gain < 0 ? 'negative' : 'positive'}
        sub={gainPct == null ? undefined : formatPercent(gainPct, true)}
      >
        <Amount cents={gain} signed colored />
      </StatCard>
      <StatCard
        label="Σήμερα"
        icon={Activity}
        tone="neutral"
        sub={prevValue > 0 ? formatPercent(p.dayChangeEur / prevValue, true) : undefined}
      >
        <Amount cents={p.dayChangeEur} signed colored />
      </StatCard>
    </div>
  );
}

/** Ανά πλατφόρμα: πόσα επένδυσες, πόσα αξίζουν και το κέρδος. */
function PlatformTable({ rows }: { rows: Array<{ id: number; name: string; value: number; cost: number }> }) {
  return (
    <table className="w-full border-t text-sm">
      <thead className="text-xs text-muted-foreground">
        <tr>
          <th className="pt-3 pb-1 text-left font-medium" />
          <th className="pt-3 pb-1 text-right font-medium">Επένδυσες</th>
          <th className="pt-3 pb-1 text-right font-medium">Κέρδος</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(r => {
          const gain = r.value - r.cost;
          return (
            <tr key={r.id}>
              <td className="py-1 pr-2">{r.name}</td>
              <td className="py-1 text-right"><Amount cents={r.cost} /></td>
              <td className="py-1 text-right">
                <Amount cents={gain} signed colored />
                {r.cost > 0 && <div className="text-xs text-muted-foreground">{formatPercent(gain / r.cost, true)}</div>}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** Κύκλος με τα πρώτα γράμματα του συμβόλου (χωρίς το χρηματιστήριο, π.χ. VUSA.AS → VUSA). */
function PositionRow({ position: p, instrument, accountName }: { position: Position; instrument?: Instrument; accountName: string }) {
  const value = p.valueEur ?? p.costEur;
  const gain = value - p.costEur;
  const avg = p.costEur / 100 / p.quantity;
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <TickerBadge ticker={instrument?.ticker} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{instrument?.name ?? '—'}</div>
        <div className="truncate text-xs text-muted-foreground">
          {formatQuantity(p.quantity)} × {p.price ? formatPrice(p.price.price, p.price.currency) : '—'} · μέση {formatPrice(avg, 'EUR')} · {accountName}
        </div>
      </div>
      <div className="text-right">
        <Amount cents={value} className="text-sm font-semibold" />
        <div className="text-xs">
          {p.valueEur == null ? (
            <span className="text-muted-foreground">χωρίς τιμή</span>
          ) : (
            <Amount cents={gain} signed colored />
          )}
          {p.valueEur != null && p.costEur > 0 && (
            <span className="text-muted-foreground"> · {formatPercent(gain / p.costEur, true)}</span>
          )}
        </div>
      </div>
    </li>
  );
}

function PieCard({
  pie,
  drift,
  instrument,
  accountName,
  onBuy,
  onOpening,
  onEdit,
  onDelete,
}: {
  pie: Pie;
  drift?: PieDrift;
  instrument: (id: number) => Instrument | undefined;
  accountName: string;
  onBuy: () => void;
  onOpening: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const hasValue = (drift?.valueEur ?? 0) > 0;
  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <CardTitle>{pie.name} · {accountName}</CardTitle>
          <p className="mt-1.5 text-xs text-muted-foreground">
            {hasValue ? <>Αξία {formatEur(drift!.valueEur)} · στόχος και πραγματικό ποσοστό</> : 'Ποσοστά-στόχοι'}
          </p>
        </div>
        <div className="flex gap-1">
          <Button variant="ghost" size="icon-sm" title="Αρχικές θέσεις" onClick={onOpening}><PackagePlus className="size-4" /></Button>
          <Button variant="ghost" size="icon-sm" title="Σύνθεση" onClick={onEdit}><Pencil className="size-4" /></Button>
          <Button variant="ghost" size="icon-sm" title="Διαγραφή pie" className="hover:text-negative" onClick={onDelete}><Trash2 className="size-4" /></Button>
          <Button variant="outline" size="sm" className="rounded-full" onClick={onBuy}>
            <ShoppingCart className="size-4" /> Αγορά
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <ul className="space-y-3">
          {pie.slices.map(s => {
            const actual = drift?.slices.find(d => d.instrumentId === s.instrumentId)?.actualPercent ?? 0;
            const diff = actual - s.targetPercent;
            return (
              <li key={s.instrumentId} className="text-sm">
                <div className="mb-1 flex items-baseline gap-2">
                  <span className="truncate font-medium">{instrument(s.instrumentId)?.name ?? '—'}</span>
                  <span className="ml-auto text-xs whitespace-nowrap text-muted-foreground tabular-nums">
                    {hasValue && <>{actual.toLocaleString('el-GR', { maximumFractionDigits: 1 })}% / </>}
                    στόχος {s.targetPercent.toLocaleString('el-GR')}%
                  </span>
                  {hasValue && (
                    <span className={cn('w-14 text-right text-xs tabular-nums', Math.abs(diff) >= 2 ? 'font-semibold text-warning' : 'text-muted-foreground')}>
                      {diff > 0 ? '+' : ''}{diff.toLocaleString('el-GR', { maximumFractionDigits: 1 })}
                    </span>
                  )}
                </div>
                {/* Μπάρα: γέμισμα = πραγματικό ποσοστό, γραμμή = στόχος (κλίμακα: 1,6× ο μεγαλύτερος στόχος) */}
                <DriftBar target={s.targetPercent} actual={hasValue ? actual : null} max={Math.max(...pie.slices.map(x => x.targetPercent)) * 1.6} />
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

function DriftBar({ target, actual, max }: { target: number; actual: number | null; max: number }) {
  const pct = (v: number) => `${Math.min(v / max, 1) * 100}%`;
  return (
    <div className="relative h-2 rounded-full bg-muted">
      <div className="absolute inset-y-0 left-0 rounded-full bg-primary/70" style={{ width: pct(actual ?? target) }} />
      {actual != null && <div className="absolute -inset-y-0.5 w-0.5 rounded-full bg-foreground" style={{ left: pct(target) }} title="Στόχος" />}
    </div>
  );
}

const ROW_DELETE_CLASS =
  'mx-2 rounded-full text-muted-foreground hover:bg-negative/10 hover:text-negative focus-visible:opacity-100 sm:opacity-0 sm:group-hover:opacity-100';

function TradeList({
  trades,
  instrument,
  accountName,
  pieName,
  onSelect,
}: {
  trades: Trade[];
  instrument: (id: number) => Instrument | undefined;
  accountName: (id: number) => string;
  pieName: (id: number) => string | undefined;
  onSelect: (t: Trade) => void;
}) {
  const remove = useDeleteTrades();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const byDay = useMemo(() => groupTrades(trades), [trades]);
  const toggle = (key: string) =>
    setExpanded(prev => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  const tradeRow = (t: Trade, nested = false) => (
    <li key={t.id} className={cn('group flex items-center transition-colors hover:bg-muted/60', nested && 'bg-muted/30')}>
      <button type="button" onClick={() => onSelect(t)} className={cn('flex min-w-0 flex-1 items-center gap-3 py-3 pl-4 text-left outline-none', nested && 'py-2 pl-8')}>
        <TickerBadge ticker={instrument(t.instrumentId)?.ticker} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">
            {instrument(t.instrumentId)?.name ?? '—'}
            {!nested && <span className="font-normal text-muted-foreground"> · {TRADE_SIDE_LABELS[t.side]}</span>}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {formatQuantity(t.quantity)} μετ.{!nested && <> · {accountName(t.accountId)}</>}
            {!nested && t.fundingAccountId != null && <> · από {accountName(t.fundingAccountId)}</>}
          </div>
        </div>
        <TradeAmount side={t.side} cents={t.amountEur} />
      </button>
      <Button variant="ghost" size="icon-sm" title="Διαγραφή" disabled={remove.isPending} onClick={() => remove.mutate([t])} className={ROW_DELETE_CLASS}>
        <Trash2 className="size-4" />
      </Button>
    </li>
  );

  return (
    <section>
      <h2 className="mb-3 text-lg font-bold tracking-tight">Κινήσεις</h2>
      <div className="space-y-5">
        {byDay.map(([date, entries]) => (
          <div key={date}>
            <div className="mb-2 px-1 text-xs font-semibold text-muted-foreground">{formatDay(date)}</div>
            <ul className="surface divide-y overflow-hidden">
              {entries.map(e => {
                const single = singleTrade(e);
                if (single || e.kind !== 'pie') return tradeRow(single!);
                const first = e.trades[0]!;
                const open = expanded.has(e.key);
                const total = e.trades.reduce((sum, t) => sum + t.amountEur, 0);
                return [
                  <li key={e.key} className="group flex items-center transition-colors hover:bg-muted/60">
                    <button type="button" onClick={() => toggle(e.key)} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-3 py-3 pl-4 text-left outline-none">
                      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/12 text-primary">
                        <ChartPie className="size-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">
                          {pieName(e.pieId) ?? 'Pie'}
                          <span className="font-normal text-muted-foreground"> · {TRADE_SIDE_LABELS[first.side]}</span>
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {e.trades.length} μετοχές · {accountName(first.accountId)}
                          {first.fundingAccountId != null && <> · από {accountName(first.fundingAccountId)}</>}
                        </div>
                      </div>
                      <ChevronDown className={cn('size-4 text-muted-foreground transition-transform', open && 'rotate-180')} />
                      <TradeAmount side={first.side} cents={total} />
                    </button>
                    <Button variant="ghost" size="icon-sm" title="Διαγραφή όλων" disabled={remove.isPending} onClick={() => remove.mutate(e.trades)} className={ROW_DELETE_CLASS}>
                      <Trash2 className="size-4" />
                    </Button>
                  </li>,
                  ...(open ? e.trades.map(t => tradeRow(t, true)) : []),
                ];
              })}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

function InstrumentList({ instruments, onAdd, onNewPie }: { instruments: Instrument[]; onAdd: () => void; onNewPie?: () => void }) {
  const remove = useDeleteInstrument();
  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-bold tracking-tight">Μετοχές</h2>
        <div className="flex gap-2">
          {onNewPie && (
            <Button variant="outline" size="sm" className="rounded-full" onClick={onNewPie}>
              <ChartPie className="size-4" /> Νέο pie
            </Button>
          )}
          <Button variant="outline" size="sm" className="rounded-full" onClick={onAdd}>
            <Plus className="size-4" /> Προσθήκη
          </Button>
        </div>
      </div>
      <ul className="flex flex-wrap gap-2">
        {instruments.map(i => (
          <li key={i.id} className="surface flex items-center gap-2 rounded-full py-1 pr-1 pl-3 text-sm">
            <span className="font-medium">{i.name}</span>
            <span className="text-xs text-muted-foreground">{i.ticker} · {i.currency}</span>
            <Button
              variant="ghost"
              size="icon-xs"
              title="Αφαίρεση"
              className="rounded-full text-muted-foreground hover:text-negative"
              onClick={() => remove.mutate(i.id)}
            >
              <X />
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
