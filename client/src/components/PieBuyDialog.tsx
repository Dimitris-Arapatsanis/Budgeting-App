import { useEffect, useState, type FormEvent } from 'react';
import {
  centsToInput,
  formatEur,
  formatPrice,
  parseAmount,
  parseDecimal,
  quantityFor,
  splitPieAmount,
  today,
  type Pie,
  type PricePoint,
  type TradeInput,
} from '@budget/shared';
import { AmountInput } from '@/components/AmountInput';
import { Field } from '@/components/Field';
import { BROKER_CASH, defaultFunding, FundingSelect, toFundingAccountId } from '@/components/FundingSelect';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { piePreview, useAccounts, useInstruments, useSaveTradeBatch } from '@/lib/api';
import { toast } from 'sonner';

/** `buy`: νέα αγορά, μοιρασμένη με τα ποσοστά. `opening`: αρχικές θέσεις όλων των μετοχών του pie μαζί. */
export type PieDialogMode = 'buy' | 'opening';

/** Αριθμός για input, με κόμμα και χωρίς διαχωριστικό χιλιάδων: 0.0316957 → "0,0316957" */
const formatNumber = (n: number) => String(n).replace('.', ',');

interface Row {
  instrumentId: number;
  targetPercent: number;
  /** Ποσοστό αυτής της αγοράς (ξεκινάει από τον στόχο). 0 = η μετοχή δεν αγοράζεται. */
  percent: string;
  amount: string;
  quantity: string;
  price: PricePoint | null;
}

/** Αγορά στο pie συμπληρωμένη από κανόνα επανάληψης */
export interface PieBuyTemplate {
  amount: number;
  date: string;
  fundingAccountId: number | null;
  recurringId: number;
  recurringDue: string;
}

interface PieBuyDialogProps {
  pie?: Pie;
  mode: PieDialogMode;
  template?: PieBuyTemplate;
  onClose: () => void;
}

export function PieBuyDialog({ pie, mode, template, onClose }: PieBuyDialogProps) {
  const { data: instruments = [] } = useInstruments();
  const { data: accounts = [] } = useAccounts();
  const saveBatch = useSaveTradeBatch();
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today());
  const [funding, setFunding] = useState('');
  const [fee, setFee] = useState('');
  const [rows, setRows] = useState<Row[] | null>(null);
  // Το ποσό της αγοράς (cents), για να ξαναμοιράζεται όταν αλλάζουν τα ποσοστά
  const [totalEur, setTotalEur] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!pie) return;
    setAmount(template ? centsToInput(template.amount) : '');
    setDate(template?.date ?? today());
    setFunding(template ? (template.fundingAccountId == null ? BROKER_CASH : String(template.fundingAccountId)) : defaultFunding(accounts));
    setFee('');
    setError(null);
    // Για αρχικές θέσεις δεν χρειάζεται πρόταση: ο χρήστης συμπληρώνει ό,τι έχει
    setRows(mode === 'opening'
      ? pie.slices.map(s => ({ ...s, percent: '', amount: '', quantity: '', price: null }))
      : null);
  }, [pie, mode, template]);

  const instrumentName = (id: number) => instruments.find(i => i.id === id)?.name ?? '—';
  const setRow = (i: number, patch: Partial<Row>) => setRows(r => r && r.map((row, j) => (j === i ? { ...row, ...patch } : row)));

  async function handlePreview(e: FormEvent) {
    e.preventDefault();
    const amountEur = parseAmount(amount);
    if (!pie || amountEur == null || amountEur <= 0) return setError('Γράψε ένα θετικό ποσό, π.χ. 100');
    setError(null);
    setLoading(true);
    try {
      const lines = await piePreview(pie.id, { amountEur, date });
      setTotalEur(amountEur);
      setRows(lines.map(l => ({
        instrumentId: l.instrumentId,
        targetPercent: l.targetPercent,
        percent: formatNumber(l.targetPercent),
        amount: centsToInput(l.amountEur),
        quantity: l.quantity == null ? '' : formatNumber(l.quantity),
        price: l.price,
      })));
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  /**
   * Αλλαγή ποσοστού (π.χ. για rebalance): το ποσό ξαναμοιράζεται αναλογικά στα ποσοστά όλων των γραμμών
   * και ξαναϋπολογίζονται οι ποσότητες. Χειροκίνητες αλλαγές σε ποσά/ποσότητες των γραμμών χάνονται.
   */
  function changePercent(i: number, value: string) {
    setRows(prev => {
      if (!prev) return prev;
      const next = prev.map((row, j) => (j === i ? { ...row, percent: value } : row));
      const slices = next.map(row => ({ instrumentId: row.instrumentId, targetPercent: parseDecimal(row.percent) ?? 0 }));
      if (slices.every(s => s.targetPercent === 0)) return next;
      const amounts = splitPieAmount(totalEur, slices);
      return next.map((row, j) => {
        const cents = amounts[j]!;
        return {
          ...row,
          amount: cents > 0 ? centsToInput(cents) : '',
          quantity: cents > 0 && row.price ? formatNumber(quantityFor(cents, row.price.priceEur)) : cents > 0 ? row.quantity : '',
        };
      });
    });
  }

  function handleSave() {
    if (!pie || !rows) return;
    const fundingFee = fee.trim() ? parseAmount(fee) : 0;
    if (fundingFee == null || fundingFee < 0) return setError('Μη έγκυρη χρέωση, π.χ. 0,18');
    const trades: TradeInput[] = [];
    for (const row of rows) {
      // Όποια γραμμή μείνει κενή (αρχικές θέσεις) ή με 0% (rebalance) απλώς παραλείπεται
      if (!row.quantity.trim() && !row.amount.trim()) continue;
      const quantity = parseDecimal(row.quantity);
      const amountEur = parseAmount(row.amount);
      if (!quantity || amountEur == null || amountEur <= 0) {
        return setError(`Έλεγξε ποσότητα και ποσό για ${instrumentName(row.instrumentId)}`);
      }
      trades.push({
        date, accountId: pie.accountId, instrumentId: row.instrumentId, side: mode, quantity, amountEur, pieId: pie.id,
        fundingAccountId: mode === 'buy' ? toFundingAccountId(funding) : null,
        // Μία χρέωση για όλη την αγορά: μπαίνει στην πρώτη μετοχή
        fundingFee: mode === 'buy' && trades.length === 0 ? fundingFee : 0,
        recurringId: template?.recurringId ?? null,
        recurringDue: template?.recurringDue ?? null,
      });
    }
    if (trades.length === 0) return setError('Συμπλήρωσε τουλάχιστον μία μετοχή');
    saveBatch.mutate(trades, {
      onSuccess: () => {
        toast.success(mode === 'opening' ? 'Οι αρχικές θέσεις αποθηκεύτηκαν' : `Αγορά ${formatEur(total)} αποθηκεύτηκε`);
        onClose();
      },
    });
  }

  const total = (rows ?? []).reduce((sum, r) => sum + (parseAmount(r.amount) ?? 0), 0);
  const percentTotal = (rows ?? []).reduce((sum, r) => sum + (parseDecimal(r.percent) ?? 0), 0);

  return (
    <Dialog open={!!pie} onOpenChange={o => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{mode === 'opening' ? 'Αρχικές θέσεις στο pie' : 'Αγορά στο pie'}</DialogTitle>
          <DialogDescription>
            {mode === 'opening'
              ? 'Για κάθε μετοχή που έχεις ήδη: ποσότητα και πόσα πλήρωσες συνολικά. Τα στοιχεία είναι στο Trading 212, στις λεπτομέρειες κάθε μετοχής του pie.'
              : rows
                ? 'Για rebalance άλλαξε τα ποσοστά (0% = δεν αγοράζεται). Μετά διόρθωσε ποσότητες και ποσά ώστε να ταιριάζουν ακριβώς με το Trading 212.'
                : 'Το ποσό μοιράζεται στις μετοχές με βάση τα ποσοστά του pie και την τιμή της ημέρας.'}
          </DialogDescription>
        </DialogHeader>

        {!rows ? (
          <form onSubmit={handlePreview} className="grid gap-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Ποσό" htmlFor="pie-amount">
                <AmountInput id="pie-amount" autoFocus value={amount} onChange={e => setAmount(e.target.value)} />
              </Field>
              <Field label="Ημερομηνία" htmlFor="pie-date">
                <Input id="pie-date" type="date" required value={date} max={today()} onChange={e => setDate(e.target.value)} />
              </Field>
            </div>
            <Field label="Χρήματα από" hint="Η μεταφορά προς τον broker καταχωρείται μόνη της, μία για όλο το ποσό.">
              <FundingSelect
                accounts={accounts}
                broker={accounts.find(a => a.id === pie?.accountId)}
                value={funding}
                onChange={setFunding}
                amount={parseAmount(amount)}
                fee={fee}
                onFeeChange={setFee}
              />
            </Field>
            {error && <p className="text-sm text-negative">{error}</p>}
            <DialogFooter>
              <Button type="submit" disabled={loading}>{loading ? 'Φέρνω τιμές…' : 'Υπολογισμός'}</Button>
            </DialogFooter>
          </form>
        ) : (
          <div className="grid gap-4">
            {mode === 'opening' && (
              <Field label="Από" htmlFor="pie-date">
                <Input id="pie-date" type="date" required value={date} onChange={e => setDate(e.target.value)} className="w-44" />
              </Field>
            )}
            <div className="-mx-6 max-h-[50vh] overflow-y-auto px-6">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr>
                    <th className="pb-2 text-left font-medium">Μετοχή</th>
                    {mode === 'buy' && <th className="w-20 pb-2 text-right font-medium">%</th>}
                    <th className="w-36 pb-2 pl-2 text-right font-medium">Ποσότητα</th>
                    <th className="w-32 pb-2 pl-2 text-right font-medium">{mode === 'opening' ? 'Κόστος' : 'Ποσό'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map((row, i) => (
                    <tr key={row.instrumentId}>
                      <td className="py-2 pr-2">
                        <div className="font-medium">{instrumentName(row.instrumentId)}</div>
                        <div className="text-xs text-muted-foreground">
                          στόχος {row.targetPercent.toLocaleString('el-GR')}%
                          {row.price && <> · {formatPrice(row.price.price, row.price.currency)}{row.price.currency !== 'EUR' && <> ≈ {formatPrice(row.price.priceEur, 'EUR')}</>}</>}
                        </div>
                      </td>
                      {mode === 'buy' && (
                        <td className="py-2">
                          <div className="relative">
                            <Input
                              aria-label={`Ποσοστό ${instrumentName(row.instrumentId)}`}
                              inputMode="decimal"
                              autoComplete="off"
                              className="h-8 pr-6 text-right tabular-nums"
                              value={row.percent}
                              onChange={e => changePercent(i, e.target.value)}
                            />
                            <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-xs text-muted-foreground">%</span>
                          </div>
                        </td>
                      )}
                      <td className="py-2 pl-2">
                        <Input
                          aria-label={`Ποσότητα ${instrumentName(row.instrumentId)}`}
                          inputMode="decimal"
                          autoComplete="off"
                          placeholder="0,00"
                          className="h-8 text-right tabular-nums"
                          value={row.quantity}
                          onChange={e => setRow(i, { quantity: e.target.value })}
                        />
                      </td>
                      <td className="py-2 pl-2">
                        <AmountInput
                          aria-label={`Ποσό ${instrumentName(row.instrumentId)}`}
                          className="h-8"
                          value={row.amount}
                          onChange={e => setRow(i, { amount: e.target.value })}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-baseline justify-between gap-3 border-t pt-3 text-sm">
              <span className="text-muted-foreground">
                Σύνολο
                {mode === 'buy' && Math.abs(percentTotal - 100) > 0.01 && (
                  <span className="ml-2 text-xs">
                    (ποσοστά {percentTotal.toLocaleString('el-GR', { maximumFractionDigits: 2 })}%: το ποσό μοιράζεται αναλογικά)
                  </span>
                )}
              </span>
              <span className="font-semibold tabular-nums">{formatEur(total)}</span>
            </div>
            {error && <p className="text-sm text-negative">{error}</p>}
            <DialogFooter className="gap-2">
              {mode === 'buy' && (
                <Button variant="ghost" className="mr-auto" onClick={() => setRows(null)}>Πίσω</Button>
              )}
              <Button onClick={handleSave} disabled={saveBatch.isPending}>Αποθήκευση</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
