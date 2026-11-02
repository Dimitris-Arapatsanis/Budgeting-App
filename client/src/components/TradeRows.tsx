import type { Trade, TradeSide } from '@budget/shared';
import { Amount } from '@/components/Amount';

/** Στρογγυλό σήμα με το ticker (π.χ. VUSA), για γραμμές κινήσεων μετοχών. */
export function TickerBadge({ ticker }: { ticker?: string }) {
  const label = (ticker ?? '?').split('.')[0]!.slice(0, 4);
  return (
    <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/12 text-[10px] font-bold tracking-tight text-primary">
      {label}
    </span>
  );
}

/** Ποσό κίνησης: αγορά αρνητική (βγήκαν μετρητά), πώληση θετική, αρχική θέση χωρίς πρόσημο. */
export function TradeAmount({ side, cents }: { side: TradeSide; cents: number }) {
  if (side === 'opening') return <Amount cents={cents} className="text-sm text-muted-foreground" />;
  return <Amount cents={side === 'sell' ? cents : -cents} signed className="text-sm font-semibold" />;
}

/** Μια γραμμή λίστας: μία κίνηση ή όλες οι κινήσεις μιας αγοράς στο pie (ίδια μέρα, ίδιο pie, ίδιο είδος). */
export type TradeEntry =
  | { kind: 'single'; key: string; trade: Trade; trades: Trade[] }
  /** `key`: μοναδικό (React, ανάπτυξη) · `match`: pie + είδος + μεταφορά, για να ενωθούν οι κινήσεις μιας αγοράς */
  | { kind: 'pie'; key: string; match: string; pieId: number; trades: Trade[] };

/** Οι κινήσεις ανά ημέρα (με τη σειρά που έρχονται), με τις αγορές στο pie ενωμένες σε μία γραμμή. */
export function groupTrades(trades: Trade[]): Array<[string, TradeEntry[]]> {
  const days = new Map<string, TradeEntry[]>();
  for (const t of trades) {
    const entries = days.get(t.date) ?? [];
    days.set(t.date, entries);
    if (t.pieId == null) {
      entries.push({ kind: 'single', key: `t${t.id}`, trade: t, trades: [t] });
      continue;
    }
    // Μια αγορά στο pie = οι κινήσεις που αποθηκεύτηκαν μαζί (batchId). Για παλιότερες χωρίς batchId:
    // ίδιο pie, είδος και μεταφορά «Χρήματα από». Έτσι δύο αγορές της ίδιας μέρας μένουν χωριστές γραμμές.
    const match = t.batchId != null ? `b${t.batchId}` : `${t.pieId}:${t.side}:${t.fundingTransactionId ?? '-'}`;
    const group = entries.find((e): e is Extract<TradeEntry, { kind: 'pie' }> => e.kind === 'pie' && e.match === match);
    if (group) group.trades.push(t);
    else entries.push({ kind: 'pie', key: `${t.date}:${t.id}`, match, pieId: t.pieId, trades: [t] });
  }
  return [...days];
}

/** Ένα pie με μία μόνο κίνηση φαίνεται σαν απλή κίνηση. */
export const singleTrade = (e: TradeEntry): Trade | undefined =>
  e.kind === 'single' ? e.trade : e.trades.length === 1 ? e.trades[0] : undefined;
