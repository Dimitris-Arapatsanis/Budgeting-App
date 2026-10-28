import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts';
import { formatEur, formatEurSigned, type CategoryColor } from '@budget/shared';
import { Amount } from '@/components/Amount';
import { CATEGORY_COLOR } from '@/lib/category-style';
import { cn } from '@/lib/utils';

export interface DonutRow {
  name: string;
  /** cents */
  value: number;
}

export interface DonutSlice extends DonutRow {
  /** Σταθερό χρώμα (π.χ. το χρώμα της κατηγορίας). Αλλιώς χρώμα της παλέτας με τη σειρά. */
  color?: CategoryColor;
  /** Ανάλυση κάτω από το στοιχείο του legend (π.χ. Μετρητά → ανά τράπεζα) */
  details?: DonutRow[];
}

// Γραμμένα ολόκληρα για να τα βρίσκει το Tailwind
const FILL = ['fill-(--chart-1)', 'fill-(--chart-2)', 'fill-(--chart-3)', 'fill-(--chart-4)',
  'fill-(--chart-5)', 'fill-(--chart-6)', 'fill-(--chart-7)', 'fill-(--chart-8)'];
const BG = ['bg-(--chart-1)', 'bg-(--chart-2)', 'bg-(--chart-3)', 'bg-(--chart-4)',
  'bg-(--chart-5)', 'bg-(--chart-6)', 'bg-(--chart-7)', 'bg-(--chart-8)'];
// Οι 7 πρώτες είναι χρώματα, η 8η (γκρι) μόνο για «Λοιπά»
const MAX_SLICES = FILL.length - 1;

/** Κρατάει τα 7 μεγαλύτερα κομμάτια και ενώνει τα υπόλοιπα σε «Λοιπά». */
function limitSlices(data: DonutSlice[]): DonutSlice[] {
  const sorted = data.filter(d => d.value > 0).sort((a, b) => b.value - a.value);
  if (sorted.length <= MAX_SLICES) return sorted;
  const rest = sorted.slice(MAX_SLICES).reduce((sum, d) => sum + d.value, 0);
  return [...sorted.slice(0, MAX_SLICES), { name: 'Λοιπά', value: rest }];
}

// Το «Λοιπά» δεν έχει color, οπότε παίρνει το γκρι 8ο χρώμα της παλέτας
const fillClass = (s: DonutSlice, i: number) => (s.color ? CATEGORY_COLOR[s.color].fill : FILL[i]);
const bgClass = (s: DonutSlice, i: number) => (s.color ? CATEGORY_COLOR[s.color].solid : BG[i]);

interface DonutChartProps {
  data: DonutSlice[];
  centerLabel: string;
  /** cents. Αν λείπει, εμφανίζεται το άθροισμα των κομματιών. */
  centerValue?: number;
  /** Εμφάνιση του κέντρου με πρόσημο (+/−) */
  centerSigned?: boolean;
  /** Γραμμές κάτω από το legend που δεν μπαίνουν στον κύκλο (π.χ. αρνητικά ποσά) */
  extraRows?: DonutRow[];
  emptyText?: string;
}

export function DonutChart({
  data,
  centerLabel,
  centerValue,
  centerSigned,
  extraRows = [],
  emptyText = 'Δεν υπάρχουν δεδομένα',
}: DonutChartProps) {
  const slices = limitSlices(data);
  const total = slices.reduce((sum, d) => sum + d.value, 0);
  const isEmpty = slices.length === 0;
  const center = centerValue ?? total;

  return (
    <div className="@container">
      <div className="flex flex-col items-center gap-6 @md:flex-row">
        <div className="relative size-44 shrink-0">
          <ResponsiveContainer>
            <PieChart>
              <Pie
                data={isEmpty ? [{ name: '', value: 1 }] : slices}
                dataKey="value"
                innerRadius="74%"
                outerRadius="100%"
                paddingAngle={slices.length > 1 ? 3 : 0}
                cornerRadius={slices.length > 1 ? 4 : 0}
                stroke="none"
                isAnimationActive={false}
              >
                {isEmpty
                  ? <Cell className="fill-muted" />
                  : slices.map((s, i) => <Cell key={i} className={fillClass(s, i)} />)}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
            <span className="text-xs text-muted-foreground">{centerLabel}</span>
            <span className="text-xl font-bold tracking-tight">{centerSigned ? formatEurSigned(center) : formatEur(center)}</span>
          </div>
        </div>

        <div className="w-full min-w-0 space-y-3 text-sm">
          {isEmpty && <p className="text-center text-muted-foreground @md:text-left">{emptyText}</p>}
          {!isEmpty && (
            <ul className="space-y-2">
              {slices.map((s, i) => (
                <li key={i}>
                  <div className="flex items-center gap-2">
                    <span className={cn('size-2.5 shrink-0 rounded-full', bgClass(s, i))} />
                    <span className="truncate">{s.name}</span>
                    <span className="ml-auto font-medium whitespace-nowrap tabular-nums">{formatEur(s.value)}</span>
                    <span className="w-10 text-right text-xs text-muted-foreground tabular-nums">
                      {Math.round((s.value / total) * 100)}%
                    </span>
                  </div>
                  {s.details && s.details.length > 1 && (
                    <ul className="mt-1 mr-12 ml-4.5 space-y-0.5 text-xs text-muted-foreground">
                      {s.details.map((d, j) => (
                        <li key={j} className="flex justify-between gap-2">
                          <span className="truncate">{d.name}</span>
                          <Amount cents={d.value} signed />
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
          {extraRows.length > 0 && (
            <ul className="space-y-1 border-t pt-3 text-muted-foreground">
              {extraRows.map((r, i) => (
                <li key={i} className="flex justify-between gap-2">
                  <span className="truncate">{r.name}</span>
                  <Amount cents={r.value} signed colored />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
