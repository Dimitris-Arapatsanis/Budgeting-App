import { useEffect, useState, type FormEvent } from 'react';
import {
  centsToInput,
  formatEur,
  parseAmount,
  parseDecimal,
  today,
  TRADE_SIDE_LABELS,
  type AccountWithBalance,
  type Instrument,
  type Pie,
  type Trade,
  type TradeInput,
  type TradeSide,
} from '@budget/shared';
import { AmountInput } from '@/components/AmountInput';
import { Field } from '@/components/Field';
import { BROKER_CASH, defaultFunding, FundingSelect, toFundingAccountId } from '@/components/FundingSelect';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAccounts, useDeleteTrades, useInstruments, usePies, useSaveTrade } from '@/lib/api';
import { cn } from '@/lib/utils';

// Η πώληση υπάρχει, αλλά ο χρήστης προς το παρόν μόνο αγοράζει: μπαίνει τελευταία
const SIDES: TradeSide[] = ['buy', 'opening', 'sell'];

const SIDE_HINT: Record<TradeSide, string> = {
  buy: 'Γράψε ποσότητα και ποσό όπως τα δείχνει η εφαρμογή του broker, και από πού ήρθαν τα λεφτά: η μεταφορά προς τον broker καταχωρείται μόνη της.',
  opening: 'Μετοχές που είχες ήδη: η ποσότητα και πόσα πλήρωσες συνολικά. Δεν επηρεάζει τα μετρητά ούτε τις αγορές του μήνα.',
  sell: 'Το ποσό μπαίνει στα μετρητά του λογαριασμού.',
};

interface FormState {
  side: TradeSide;
  instrumentId: string;
  accountId: string;
  quantity: string;
  amount: string;
  date: string;
  /** «Χρήματα από» (μόνο για αγορά): id λογαριασμού ή BROKER_CASH */
  funding: string;
}

/** Ο λογαριασμός που ταιριάζει σε μια μετοχή: του pie που την έχει, αλλιώς ο πρώτος broker. */
function defaultAccount(instrumentId: number | undefined, pies: Pie[], brokers: AccountWithBalance[]) {
  const pie = pies.find(p => p.slices.some(s => s.instrumentId === instrumentId));
  return String(pie?.accountId ?? brokers[0]?.id ?? '');
}

function initialState(
  trade: Trade | undefined,
  side: TradeSide,
  instruments: Instrument[],
  pies: Pie[],
  brokers: AccountWithBalance[],
  accounts: AccountWithBalance[],
): FormState {
  if (trade) {
    return {
      side: trade.side,
      instrumentId: String(trade.instrumentId),
      accountId: String(trade.accountId),
      quantity: String(trade.quantity).replace('.', ','),
      amount: centsToInput(trade.amountEur),
      date: trade.date,
      funding: trade.fundingAccountId == null ? BROKER_CASH : String(trade.fundingAccountId),
    };
  }
  // Οι μετοχές του pie αγοράζονται συνήθως με «Αγορά στο pie», οπότε προτείνουμε πρώτα μια εκτός pie (π.χ. VUSA)
  const instrument = instruments.find(i => !pies.some(p => p.slices.some(s => s.instrumentId === i.id))) ?? instruments[0];
  return {
    side,
    instrumentId: String(instrument?.id ?? ''),
    accountId: defaultAccount(instrument?.id, pies, brokers),
    quantity: '',
    amount: '',
    date: today(),
    funding: defaultFunding(accounts),
  };
}

interface TradeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trade?: Trade;
  defaultSide?: TradeSide;
}

export function TradeDialog({ open, onOpenChange, trade, defaultSide = 'buy' }: TradeDialogProps) {
  const { data: accounts = [] } = useAccounts();
  const { data: instruments = [] } = useInstruments();
  const { data: pies = [] } = usePies();
  const save = useSaveTrade();
  const remove = useDeleteTrades();
  const brokers = accounts.filter(a => a.type === 'broker' && (!a.archived || a.id === trade?.accountId));
  const [form, setForm] = useState<FormState>(() => initialState(trade, defaultSide, instruments, pies, brokers, accounts));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm(initialState(trade, defaultSide, instruments, pies, brokers, accounts));
      setError(null);
    }
  }, [open, trade]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm(f => ({ ...f, [key]: value }));
  const changeInstrument = (instrumentId: string) =>
    setForm(f => ({ ...f, instrumentId, accountId: trade ? f.accountId : defaultAccount(Number(instrumentId), pies, brokers) }));

  const quantity = parseDecimal(form.quantity);
  const amount = parseAmount(form.amount);
  const unitPrice = quantity && amount ? Math.round(amount / quantity) : null;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!quantity) return setError('Γράψε την ποσότητα, π.χ. 1,5 ή 0,0423');
    if (amount == null || amount <= 0) return setError('Γράψε ένα θετικό ποσό, π.χ. 250 ή 1.234,56');
    const input: TradeInput = {
      side: form.side,
      instrumentId: Number(form.instrumentId),
      accountId: Number(form.accountId),
      quantity,
      amountEur: amount,
      date: form.date,
      pieId: trade?.pieId ?? null,
      fundingAccountId: form.side === 'buy' ? toFundingAccountId(form.funding) : null,
    };
    save.mutate({ id: trade?.id, input }, { onSuccess: () => onOpenChange(false) });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{trade ? 'Επεξεργασία κίνησης' : 'Νέα κίνηση'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="grid gap-4">
          <div className="grid grid-cols-3 gap-1 rounded-full bg-muted p-1">
            {SIDES.map(side => (
              <button
                key={side}
                type="button"
                onClick={() => set('side', side)}
                className={cn(
                  'rounded-full py-1.5 text-sm font-medium text-muted-foreground transition-colors',
                  form.side === side && 'bg-card text-foreground shadow-soft dark:bg-accent',
                )}
              >
                {TRADE_SIDE_LABELS[side]}
              </button>
            ))}
          </div>
          <p className="-mt-1 text-xs text-muted-foreground">{SIDE_HINT[form.side]}</p>

          {/* Η μετοχή σε δική της γραμμή: τα ονόματα ETF είναι μεγάλα */}
          <Field label="Μετοχή">
            <Select value={form.instrumentId} onValueChange={changeInstrument}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Επίλεξε" /></SelectTrigger>
              <SelectContent>
                {instruments.map(i => (
                  <SelectItem key={i.id} value={String(i.id)}>
                    {i.name} <span className="text-xs text-muted-foreground">{i.ticker}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Πλατφόρμα">
              <Select value={form.accountId} onValueChange={v => set('accountId', v)}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Επίλεξε" /></SelectTrigger>
                <SelectContent>
                  {brokers.map(a => <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label={form.side === 'opening' ? 'Από' : 'Ημερομηνία'} htmlFor="trade-date">
              <Input id="trade-date" type="date" required value={form.date} onChange={e => set('date', e.target.value)} />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Ποσότητα" htmlFor="trade-qty">
              <Input
                id="trade-qty"
                autoFocus
                inputMode="decimal"
                autoComplete="off"
                placeholder="0,00"
                className="text-right tabular-nums"
                value={form.quantity}
                onChange={e => set('quantity', e.target.value)}
              />
            </Field>
            <Field label={form.side === 'opening' ? 'Συνολικό κόστος' : 'Ποσό'} htmlFor="trade-amount">
              <AmountInput id="trade-amount" value={form.amount} onChange={e => set('amount', e.target.value)} />
            </Field>
          </div>

          {form.side === 'buy' && (
            <Field label="Χρήματα από">
              <FundingSelect
                accounts={accounts}
                broker={brokers.find(b => String(b.id) === form.accountId)}
                value={form.funding}
                onChange={v => set('funding', v)}
                amount={amount}
              />
            </Field>
          )}

          {unitPrice != null && (
            <p className="text-xs text-muted-foreground">≈ {formatEur(unitPrice)} ανά μετοχή</p>
          )}
          {error && <p className="text-sm text-negative">{error}</p>}

          <DialogFooter className="gap-2">
            {trade && (
              <Button
                type="button"
                variant="ghost"
                className="mr-auto text-negative"
                disabled={remove.isPending}
                onClick={() => remove.mutate([trade], { onSuccess: () => onOpenChange(false) })}
              >
                Διαγραφή
              </Button>
            )}
            <Button type="submit" disabled={save.isPending}>Αποθήκευση</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
