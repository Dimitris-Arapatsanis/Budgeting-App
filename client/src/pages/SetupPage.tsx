import { ArrowLeft, ArrowRight, Check, Plus, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  ACCOUNT_TYPE_LABELS,
  formatEur,
  isDebtAccount,
  parseAmount,
  parseDecimal,
  today,
  type DebtDirection,
  type SetupInput,
} from '@budget/shared';
import { AmountInput } from '@/components/AmountInput';
import { InstrumentDialog } from '@/components/InstrumentDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ACCOUNT_ICON } from '@/lib/account-style';
import { useAccounts, useInstruments, usePies, useSetup, useSetupStatus } from '@/lib/api';
import { cn } from '@/lib/utils';

const STEPS = ['Έναρξη', 'Υπόλοιπα', 'Μετοχές', 'Χρωστούμενα', 'Σύνοψη'] as const;

interface PositionRow {
  instrumentId: number;
  accountId: string;
  quantity: string;
  cost: string;
}

interface DebtRow {
  key: number;
  direction: DebtDirection;
  person: string;
  amount: string;
  reason: string;
}

/**
 * Οδηγός «Ξεκίνα»: ό,τι υπάρχει όταν ξεκινάς (υπόλοιπα, μετοχές, χρωστούμενα) μπαίνει ως αφετηρία.
 * Δεν μετράει ποτέ ως έσοδο, έξοδο ή μεταβολή περιουσίας.
 */
export function SetupPage() {
  const { data: status } = useSetupStatus();
  const { data: allAccounts = [] } = useAccounts();
  const { data: instruments = [] } = useInstruments();
  const { data: pies = [] } = usePies();
  const setup = useSetup();
  const navigate = useNavigate();

  const [step, setStep] = useState(0);
  const [startDate, setStartDate] = useState(today());
  const [balances, setBalances] = useState<Record<number, string>>({});
  const [positions, setPositions] = useState<PositionRow[]>([]);
  const [debts, setDebts] = useState<DebtRow[]>([]);
  const [instrumentDialog, setInstrumentDialog] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accounts = allAccounts.filter(a => !isDebtAccount(a) && !a.archived);
  const brokers = accounts.filter(a => a.type === 'broker');

  // Μία γραμμή ανά μετοχή, στην πλατφόρμα του pie που την έχει (αλλιώς σε broker εκτός pie, π.χ. Revolut)
  useEffect(() => {
    if (brokers.length === 0) return;
    const pieAccountOf = (id: number) => pies.find(p => p.slices.some(s => s.instrumentId === id))?.accountId;
    const nonPieBroker = brokers.find(b => !pies.some(p => p.accountId === b.id)) ?? brokers[0]!;
    setPositions(prev => {
      const missing = instruments.filter(i => !prev.some(p => p.instrumentId === i.id));
      if (missing.length === 0) return prev;
      const rows = missing.map(i => ({ instrumentId: i.id, accountId: String(pieAccountOf(i.id) ?? nonPieBroker.id), quantity: '', cost: '' }));
      // Πρώτα όσες είναι εκτός pie (π.χ. VUSA), μετά του pie με τη σειρά των ποσοστών
      const order = (r: PositionRow) => {
        const pie = pies.find(p => p.slices.some(s => s.instrumentId === r.instrumentId));
        return pie ? 1 + pie.slices.findIndex(s => s.instrumentId === r.instrumentId) : 0;
      };
      return [...prev, ...rows.sort((a, b) => order(a) - order(b))];
    });
  }, [instruments, pies, allAccounts]);

  if (status && !status.empty) {
    return (
      <div className="surface mx-auto max-w-lg space-y-3 p-6 text-sm">
        <h1 className="text-xl font-bold tracking-tight">Η εφαρμογή έχει ήδη ξεκινήσει</h1>
        <p className="text-muted-foreground">
          Για να ξεκινήσεις από την αρχή, πήγαινε στους <Link to="/accounts" className="text-primary underline">Λογαριασμούς</Link> →
          «Έναρξη από την αρχή».
        </p>
      </div>
    );
  }

  const instrumentName = (id: number) => instruments.find(i => i.id === id)?.name ?? '—';
  const setPosition = (i: number, patch: Partial<PositionRow>) => setPositions(p => p.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const setDebt = (key: number, patch: Partial<DebtRow>) => setDebts(d => d.map(r => (r.key === key ? { ...r, ...patch } : r)));

  /** Μετατροπή της φόρμας σε input του API. Επιστρέφει μήνυμα λάθους και το βήμα όπου βρίσκεται. */
  function buildInput(): { input?: SetupInput; error?: string; step?: number } {
    const balanceRows: SetupInput['balances'] = [];
    for (const a of accounts) {
      const text = balances[a.id]?.trim();
      if (!text) continue;
      const cents = parseAmount(text);
      if (cents == null) return { error: `Μη έγκυρο υπόλοιπο για ${a.name}`, step: 1 };
      balanceRows.push({ accountId: a.id, initialBalance: a.type === 'loan' ? -Math.abs(cents) : cents });
    }
    const positionRows: SetupInput['positions'] = [];
    for (const p of positions) {
      if (!p.quantity.trim() && !p.cost.trim()) continue;
      const quantity = parseDecimal(p.quantity);
      const amountEur = parseAmount(p.cost);
      if (!quantity || amountEur == null || amountEur <= 0) {
        return { error: `Έλεγξε ποσότητα και κόστος για ${instrumentName(p.instrumentId)}`, step: 2 };
      }
      positionRows.push({ accountId: Number(p.accountId), instrumentId: p.instrumentId, quantity, amountEur });
    }
    const debtRows: SetupInput['debts'] = [];
    for (const d of debts) {
      if (!d.person.trim() && !d.amount.trim()) continue;
      const amount = parseAmount(d.amount);
      if (!d.person.trim() || amount == null || amount <= 0) return { error: 'Κάθε χρωστούμενο θέλει όνομα και θετικό ποσό', step: 3 };
      debtRows.push({ direction: d.direction, person: d.person, reason: d.reason, amount });
    }
    return { input: { startDate, balances: balanceRows, positions: positionRows, debts: debtRows } };
  }

  function next() {
    const result = buildInput();
    if (result.error && result.step! <= step) {
      setError(result.error);
      return;
    }
    setError(null);
    setStep(s => Math.min(s + 1, STEPS.length - 1));
  }

  function finish() {
    const result = buildInput();
    if (!result.input) {
      setError(result.error!);
      setStep(result.step!);
      return;
    }
    setup.mutate(result.input, { onSuccess: () => navigate('/month') });
  }

  const summary = buildInput().input;
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <div className="text-xs font-medium text-muted-foreground">Καλωσόρισες</div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Ξεκίνα</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Πες μου τι έχεις σήμερα. Όλα αυτά είναι η αφετηρία: δεν θα μετρήσουν ποτέ ως έσοδο, έξοδο ή κέρδος, μόνο
          ό,τι αλλάζει από εδώ και πέρα. Ό,τι δεν ξέρεις τώρα, το αφήνεις κενό και το προσθέτεις αργότερα.
        </p>
      </div>

      <ol className="flex gap-1 overflow-x-auto rounded-full bg-muted p-1 text-xs font-medium sm:text-sm">
        {STEPS.map((label, i) => (
          <li key={label} className="flex-1">
            <button
              type="button"
              onClick={() => i < step && setStep(i)}
              className={cn(
                'flex w-full items-center justify-center gap-1 rounded-full px-2 py-1.5 whitespace-nowrap text-muted-foreground',
                i === step && 'bg-card text-foreground shadow-soft dark:bg-accent',
                i < step && 'text-foreground',
              )}
            >
              {i < step ? <Check className="size-3.5 text-positive" /> : <span className="tabular-nums">{i + 1}.</span>}
              <span className={cn(i !== step && 'hidden sm:inline')}>{label}</span>
            </button>
          </li>
        ))}
      </ol>

      <div className="surface space-y-4 p-5 sm:p-6">
        {step === 0 && (
          <div className="space-y-3 text-sm">
            <h2 className="text-lg font-bold tracking-tight">Από πότε ξεκινάς;</h2>
            <p className="text-muted-foreground">
              Τα υπόλοιπα, οι μετοχές και τα χρωστούμενα που θα γράψεις είναι αυτά που είχες <strong>αυτή τη μέρα</strong>.
              Από εκεί και πέρα καταχωρείς κανονικά συναλλαγές.
            </p>
            <Input type="date" className="w-48" value={startDate} max={today()} onChange={e => setStartDate(e.target.value)} />
          </div>
        )}

        {step === 1 && (
          <div className="space-y-3 text-sm">
            <h2 className="text-lg font-bold tracking-tight">Πόσα έχει κάθε λογαριασμός;</h2>
            <p className="text-muted-foreground">
              Για Revolut και Trading 212 γράψε μόνο τα <strong>αεπένδυτα μετρητά</strong>: οι μετοχές μπαίνουν στο επόμενο βήμα.
            </p>
            <ul className="divide-y">
              {accounts.map(a => {
                const Icon = ACCOUNT_ICON[a.type];
                return (
                  <li key={a.id} className="flex items-center gap-3 py-2">
                    <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/12 text-primary"><Icon className="size-4" /></span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{a.name}</div>
                      <div className="text-xs text-muted-foreground">{a.type === 'loan' ? 'οφειλή' : ACCOUNT_TYPE_LABELS[a.type]}</div>
                    </div>
                    <div className="w-36">
                      <AmountInput aria-label={`Υπόλοιπο ${a.name}`} value={balances[a.id] ?? ''} onChange={e => setBalances(b => ({ ...b, [a.id]: e.target.value }))} />
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3 text-sm">
            <h2 className="text-lg font-bold tracking-tight">Ποιες μετοχές έχεις;</h2>
            <p className="text-muted-foreground">
              Ποσότητα και πόσα πλήρωσες συνολικά, ακριβώς όπως στον broker. Όσες δεν έχεις, άφησέ τες κενές.
            </p>
            <div className="-mx-5 overflow-x-auto px-5 sm:-mx-6 sm:px-6">
              <table className="w-full min-w-[480px]">
                <thead className="text-xs text-muted-foreground">
                  <tr>
                    <th className="pb-2 text-left font-medium">Μετοχή</th>
                    <th className="w-32 pb-2 pl-2 text-left font-medium">Πλατφόρμα</th>
                    <th className="w-28 pb-2 pl-2 text-right font-medium">Ποσότητα</th>
                    <th className="w-32 pb-2 pl-2 text-right font-medium">Κόστος</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {positions.map((p, i) => (
                    <tr key={p.instrumentId}>
                      <td className="py-2 pr-2 font-medium">{instrumentName(p.instrumentId)}</td>
                      <td className="py-2 pl-2">
                        <Select value={p.accountId} onValueChange={v => setPosition(i, { accountId: v })}>
                          <SelectTrigger className="h-8 w-full"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {brokers.map(b => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="py-2 pl-2">
                        <Input
                          aria-label={`Ποσότητα ${instrumentName(p.instrumentId)}`}
                          inputMode="decimal"
                          autoComplete="off"
                          placeholder="0,00"
                          className="h-8 text-right tabular-nums"
                          value={p.quantity}
                          onChange={e => setPosition(i, { quantity: e.target.value })}
                        />
                      </td>
                      <td className="py-2 pl-2">
                        <AmountInput aria-label={`Κόστος ${instrumentName(p.instrumentId)}`} className="h-8" value={p.cost} onChange={e => setPosition(i, { cost: e.target.value })} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Button variant="outline" size="sm" className="rounded-full" onClick={() => setInstrumentDialog(true)}>
              <Plus className="size-4" /> Άλλη μετοχή
            </Button>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-3 text-sm">
            <h2 className="text-lg font-bold tracking-tight">Χρωστάει κάποιος σε σένα, ή εσύ σε κάποιον;</h2>
            <p className="text-muted-foreground">Μόνο όσα δεν έχουν επιστραφεί ακόμα. Αν δεν υπάρχει τίποτα, προχώρα.</p>
            <ul className="space-y-3">
              {debts.map(d => (
                <li key={d.key} className="space-y-2 rounded-xl border p-3">
                  <div className="flex items-center gap-2">
                    <div className="grid flex-1 grid-cols-2 gap-1 rounded-full bg-muted p-1">
                      {(['lent', 'borrowed'] as const).map(dir => (
                        <button
                          key={dir}
                          type="button"
                          onClick={() => setDebt(d.key, { direction: dir })}
                          className={cn(
                            'rounded-full py-1 text-xs font-medium text-muted-foreground sm:text-sm',
                            d.direction === dir && 'bg-card text-foreground shadow-soft dark:bg-accent',
                          )}
                        >
                          {dir === 'lent' ? 'Μου χρωστάει' : 'Του χρωστάω'}
                        </button>
                      ))}
                    </div>
                    <Button variant="ghost" size="icon-sm" title="Αφαίρεση" onClick={() => setDebts(x => x.filter(r => r.key !== d.key))}>
                      <X className="size-4" />
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Input aria-label="Όνομα" placeholder="Όνομα" value={d.person} onChange={e => setDebt(d.key, { person: e.target.value })} />
                    <AmountInput aria-label="Ποσό χρέους" value={d.amount} onChange={e => setDebt(d.key, { amount: e.target.value })} />
                  </div>
                  <Input aria-label="Γιατί" placeholder="Γιατί (προαιρετικό)" value={d.reason} onChange={e => setDebt(d.key, { reason: e.target.value })} />
                </li>
              ))}
            </ul>
            <Button
              variant="outline"
              size="sm"
              className="rounded-full"
              onClick={() => setDebts(x => [...x, { key: Date.now(), direction: 'lent', person: '', amount: '', reason: '' }])}
            >
              <Plus className="size-4" /> Χρωστούμενο
            </Button>
          </div>
        )}

        {step === 4 && summary && (
          <div className="space-y-3 text-sm">
            <h2 className="text-lg font-bold tracking-tight">Σύνοψη</h2>
            <dl className="divide-y">
              {[
                ['Ημερομηνία έναρξης', new Date(`${startDate}T00:00:00`).toLocaleDateString('el-GR', { day: 'numeric', month: 'long', year: 'numeric' })],
                ['Υπόλοιπα λογαριασμών', formatEur(sum(summary.balances.map(b => b.initialBalance)))],
                ['Μετοχές', summary.positions.length ? `${summary.positions.length} · κόστος ${formatEur(sum(summary.positions.map(p => p.amountEur)))}` : '—'],
                ['Μου χρωστάνε', formatEur(sum(summary.debts.filter(d => d.direction === 'lent').map(d => d.amount)))],
                ['Χρωστάω', formatEur(sum(summary.debts.filter(d => d.direction === 'borrowed').map(d => d.amount)))],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between gap-4 py-2">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="font-medium tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
            <p className="text-xs text-muted-foreground">
              Μπορείς να αλλάξεις οτιδήποτε και αργότερα: υπόλοιπα στους Λογαριασμούς, μετοχές στις Επενδύσεις («Αρχική θέση»),
              χρωστούμενα στους Λογαριασμούς («Παλιό χρέος»).
            </p>
          </div>
        )}

        {error && <p className="text-sm text-negative">{error}</p>}

        <div className="flex justify-between gap-2 border-t pt-4">
          <Button variant="ghost" disabled={step === 0} onClick={() => { setError(null); setStep(s => s - 1); }}>
            <ArrowLeft className="size-4" /> Πίσω
          </Button>
          {step < STEPS.length - 1 ? (
            <Button className="rounded-full" onClick={next}>
              Επόμενο <ArrowRight className="size-4" />
            </Button>
          ) : (
            <Button className="rounded-full" onClick={finish} disabled={setup.isPending}>
              <Check className="size-4" /> Ολοκλήρωση
            </Button>
          )}
        </div>
      </div>

      <InstrumentDialog open={instrumentDialog} onClose={() => setInstrumentDialog(false)} />
    </div>
  );
}
