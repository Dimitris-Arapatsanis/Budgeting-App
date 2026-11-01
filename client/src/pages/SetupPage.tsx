import { ArrowLeft, ArrowRight, Check, ChartPie, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  ACCOUNT_TYPE_LABELS,
  ACCOUNT_TYPES,
  formatEur,
  isDebtAccount,
  parseAmount,
  parseDecimal,
  today,
  type AccountWithBalance,
  type DebtDirection,
  type Pie,
  type SetupInput,
  type UserAccountType,
} from '@budget/shared';
import { AmountInput } from '@/components/AmountInput';
import { InstrumentDialog } from '@/components/InstrumentDialog';
import { PieEditDialog } from '@/components/PieEditDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ACCOUNT_ICON } from '@/lib/account-style';
import {
  useAccounts,
  useDeleteAccount,
  useDeleteInstrument,
  useDeletePie,
  useInstruments,
  usePies,
  useSaveAccount,
  useSetup,
  useSetupStatus,
} from '@/lib/api';
import { cn } from '@/lib/utils';

const STEPS = ['Έναρξη', 'Λογαριασμοί', 'Μετοχές', 'Χρωστούμενα', 'Σύνοψη'] as const;

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
 * Λογαριασμοί, μετοχές και pies αλλάζουν αμέσως (κανονικά endpoints). Τα υπόλοιπα, οι θέσεις και τα χρωστούμενα
 * αποθηκεύονται όλα μαζί στο τέλος (POST /api/setup).
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
  const [hasStocks, setHasStocks] = useState<boolean | null>(null);
  const [positions, setPositions] = useState<PositionRow[]>([]);
  const [hasDebts, setHasDebts] = useState<boolean | null>(null);
  const [debts, setDebts] = useState<DebtRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const accounts = allAccounts.filter(a => !isDebtAccount(a) && !a.archived);
  const brokers = accounts.filter(a => a.type === 'broker');

  // Μία γραμμή ανά μετοχή, στην πλατφόρμα του pie που την έχει (αλλιώς στον πρώτο broker εκτός pie)
  useEffect(() => {
    if (brokers.length === 0) return;
    const pieAccountOf = (id: number) => pies.find(p => p.slices.some(s => s.instrumentId === id))?.accountId;
    const nonPieBroker = brokers.find(b => !pies.some(p => p.accountId === b.id)) ?? brokers[0]!;
    setPositions(prev => {
      const kept = prev
        .filter(p => instruments.some(i => i.id === p.instrumentId))
        .map(p => (brokers.some(b => String(b.id) === p.accountId) ? p : { ...p, accountId: String(nonPieBroker.id) }));
      const missing = instruments.filter(i => !kept.some(p => p.instrumentId === i.id));
      if (missing.length === 0 && kept.length === prev.length) return kept;
      return [...kept, ...missing.map(i => ({ instrumentId: i.id, accountId: String(pieAccountOf(i.id) ?? nonPieBroker.id), quantity: '', cost: '' }))];
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
  const setPosition = (id: number, patch: Partial<PositionRow>) =>
    setPositions(p => p.map(r => (r.instrumentId === id ? { ...r, ...patch } : r)));
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
    if (hasStocks === null) return { error: 'Διάλεξε αν έχεις μετοχές', step: 2 };
    const positionRows: SetupInput['positions'] = [];
    for (const p of hasStocks ? positions : []) {
      if (!p.quantity.trim() && !p.cost.trim()) continue;
      const quantity = parseDecimal(p.quantity);
      const amountEur = parseAmount(p.cost);
      if (!quantity || amountEur == null || amountEur <= 0) {
        return { error: `Έλεγξε ποσότητα και κόστος για ${instrumentName(p.instrumentId)}`, step: 2 };
      }
      positionRows.push({ accountId: Number(p.accountId), instrumentId: p.instrumentId, quantity, amountEur });
    }
    if (hasDebts === null) return { error: 'Διάλεξε αν έχεις χρωστούμενα', step: 3 };
    const debtRows: SetupInput['debts'] = [];
    for (const d of hasDebts ? debts : []) {
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

  const summary = step === STEPS.length - 1 ? buildInput().input : undefined;
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
          <AccountsStep accounts={accounts.filter(a => a.type !== 'broker')} balances={balances} onBalance={(id, v) => setBalances(b => ({ ...b, [id]: v }))} />
        )}

        {step === 2 && (
          <div className="space-y-4 text-sm">
            <h2 className="text-lg font-bold tracking-tight">Έχεις μετοχές ή ETF;</h2>
            <YesNo value={hasStocks} onChange={v => { setHasStocks(v); setError(null); }} />
            {hasStocks && (
              <StocksStep
                brokers={brokers}
                pies={pies}
                positions={positions}
                instrumentName={instrumentName}
                onPosition={setPosition}
                balances={balances}
                onBalance={(id, v) => setBalances(b => ({ ...b, [id]: v }))}
              />
            )}
          </div>
        )}

        {step === 3 && (
          <div className="space-y-3 text-sm">
            <h2 className="text-lg font-bold tracking-tight">Σου χρωστάει κάποιος, ή χρωστάς εσύ;</h2>
            <YesNo value={hasDebts} onChange={v => {
              setHasDebts(v);
              setError(null);
              if (v && debts.length === 0) setDebts([{ key: Date.now(), direction: 'lent', person: '', amount: '', reason: '' }]);
            }} />
            {hasDebts && (
              <>
                <p className="text-muted-foreground">Μόνο όσα δεν έχουν επιστραφεί ακόμα.</p>
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
              </>
            )}
          </div>
        )}

        {step === 4 && summary && (
          <div className="space-y-3 text-sm">
            <h2 className="text-lg font-bold tracking-tight">Σύνοψη</h2>
            <dl className="divide-y">
              {[
                ['Ημερομηνία έναρξης', new Date(`${startDate}T00:00:00`).toLocaleDateString('el-GR', { day: 'numeric', month: 'long', year: 'numeric' })],
                ['Λογαριασμοί', accounts.map(a => a.name).join(', ') || '—'],
                ['Υπόλοιπα λογαριασμών', formatEur(sum(summary.balances.map(b => b.initialBalance)))],
                ['Μετοχές', summary.positions.length ? `${summary.positions.length} · κόστος ${formatEur(sum(summary.positions.map(p => p.amountEur)))}` : '—'],
                ['Pies', hasStocks && pies.length ? pies.map(p => p.name).join(', ') : '—'],
                ['Μου χρωστάνε', formatEur(sum(summary.debts.filter(d => d.direction === 'lent').map(d => d.amount)))],
                ['Χρωστάω', formatEur(sum(summary.debts.filter(d => d.direction === 'borrowed').map(d => d.amount)))],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between gap-4 py-2">
                  <dt className="shrink-0 text-muted-foreground">{label}</dt>
                  <dd className="text-right font-medium tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
            <p className="text-xs text-muted-foreground">
              Μπορείς να αλλάξεις οτιδήποτε και αργότερα: λογαριασμούς και υπόλοιπα στους Λογαριασμούς, μετοχές και pies στις
              Επενδύσεις («Αρχική θέση»), χρωστούμενα στους Λογαριασμούς («Παλιό χρέος»).
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
    </div>
  );
}

function YesNo({ value, onChange }: { value: boolean | null; onChange: (v: boolean) => void }) {
  return (
    <div className="grid w-56 grid-cols-2 gap-1 rounded-full bg-muted p-1">
      {([[true, 'Ναι'], [false, 'Όχι']] as const).map(([v, label]) => (
        <button
          key={label}
          type="button"
          onClick={() => onChange(v)}
          className={cn(
            'rounded-full py-1.5 text-sm font-medium text-muted-foreground',
            value === v && 'bg-card text-foreground shadow-soft dark:bg-accent',
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** Λογαριασμοί: υπόλοιπο, μετονομασία, αφαίρεση και προσθήκη (αποθηκεύονται αμέσως). */
function AccountsStep({
  accounts,
  balances,
  onBalance,
}: {
  accounts: AccountWithBalance[];
  balances: Record<number, string>;
  onBalance: (id: number, value: string) => void;
}) {
  const save = useSaveAccount();
  const remove = useDeleteAccount();
  const [names, setNames] = useState<Record<number, string>>({});
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<UserAccountType>('bank');

  const rename = (a: AccountWithBalance) => {
    const name = names[a.id]?.trim();
    if (!name || name === a.name) return;
    save.mutate({ id: a.id, input: { name, type: a.type as UserAccountType, initialBalance: 0, archived: false } });
  };
  const add = () => {
    if (!newName.trim()) return;
    save.mutate({ input: { name: newName.trim(), type: newType, initialBalance: 0 } }, { onSuccess: () => setNewName('') });
  };

  return (
    <div className="space-y-3 text-sm">
      <h2 className="text-lg font-bold tracking-tight">Ποιους λογαριασμούς έχεις;</h2>
      <p className="text-muted-foreground">
        Πάτα σε ένα όνομα για να το αλλάξεις (π.χ. «Τράπεζα» → «Eurobank»), αφαίρεσε όσους δεν έχεις και πρόσθεσε τους δικούς σου (τράπεζες, πορτοφόλι,
        δάνεια). Γράψε πόσα έχει ο καθένας. Τις πλατφόρμες για μετοχές (brokers) τις βάζεις στο επόμενο βήμα, «Μετοχές».
      </p>
      <ul className="divide-y">
        {accounts.map(a => {
          const Icon = ACCOUNT_ICON[a.type];
          return (
            <li key={a.id} className="flex items-center gap-2 py-2">
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/12 text-primary"><Icon className="size-4" /></span>
              <div className="min-w-0 flex-1">
                <Input
                  aria-label={`Όνομα ${a.name}`}
                  className="h-8 px-2 font-medium"
                  title="Πάτα για αλλαγή ονόματος"
                  value={names[a.id] ?? a.name}
                  onChange={e => setNames(n => ({ ...n, [a.id]: e.target.value }))}
                  onBlur={() => rename(a)}
                />
                <div className="px-2 text-xs text-muted-foreground">{a.type === 'loan' ? 'Δάνειο (οφειλή)' : ACCOUNT_TYPE_LABELS[a.type]}</div>
              </div>
              <div className="w-32 shrink-0">
                <AmountInput aria-label={`Υπόλοιπο ${a.name}`} value={balances[a.id] ?? ''} onChange={e => onBalance(a.id, e.target.value)} />
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                title={`Αφαίρεση ${a.name}`}
                className="shrink-0 rounded-full text-muted-foreground hover:text-negative"
                disabled={remove.isPending}
                onClick={() => remove.mutate(a.id)}
              >
                <Trash2 className="size-4" />
              </Button>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed p-3">
        <Input aria-label="Νέος λογαριασμός" placeholder="π.χ. Eurobank" className="h-8 min-w-0 flex-1" value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} />
        <Select value={newType} onValueChange={v => setNewType(v as UserAccountType)}>
          <SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            {ACCOUNT_TYPES.filter(t => t !== 'broker').map(t => <SelectItem key={t} value={t}>{ACCOUNT_TYPE_LABELS[t]}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button size="sm" variant="outline" className="rounded-full" disabled={!newName.trim() || save.isPending} onClick={add}>
          <Plus className="size-4" /> Προσθήκη
        </Button>
      </div>
    </div>
  );
}

/** Μετοχές: πλατφόρμες, pies, μετοχές (προσθήκη/αφαίρεση) και ποσότητα + κόστος ανά μετοχή. */
function StocksStep({
  brokers,
  pies,
  positions,
  instrumentName,
  onPosition,
  balances,
  onBalance,
}: {
  balances: Record<number, string>;
  onBalance: (id: number, value: string) => void;
  brokers: AccountWithBalance[];
  pies: Pie[];
  positions: PositionRow[];
  instrumentName: (id: number) => string;
  onPosition: (instrumentId: number, patch: Partial<PositionRow>) => void;
}) {
  const save = useSaveAccount();
  const removeInstrument = useDeleteInstrument();
  const removeAccount = useDeleteAccount();
  const removePie = useDeletePie();
  const [brokerName, setBrokerName] = useState('');
  const [instrumentDialog, setInstrumentDialog] = useState(false);
  const [pieDialog, setPieDialog] = useState<{ pie?: Pie; create?: boolean } | null>(null);
  const accountName = (id: number) => brokers.find(b => b.id === id)?.name ?? '—';

  const addBroker = () => {
    if (!brokerName.trim()) return;
    save.mutate({ input: { name: brokerName.trim(), type: 'broker', initialBalance: 0 } }, { onSuccess: () => setBrokerName('') });
  };
  const BrokerIcon = ACCOUNT_ICON.broker;

  const platforms = (
    <Section title="Πλατφόρμες">
      <p className="text-muted-foreground">
        Πού έχεις τις μετοχές σου (π.χ. Revolut, Trading 212, Freedom24). Μπορείς να βάλεις όσες θέλεις. Δίπλα γράψε τα{' '}
        <strong>αεπένδυτα μετρητά</strong> της πλατφόρμας, αν έχει.
      </p>
      {brokers.length > 0 && (
        <ul className="divide-y rounded-xl border">
          {brokers.map(b => (
            <li key={b.id} className="flex items-center gap-2 px-3 py-2">
              <BrokerIcon className="size-4 shrink-0 text-primary" />
              <span className="min-w-0 flex-1 truncate font-medium">{b.name}</span>
              <div className="w-32 shrink-0">
                <AmountInput aria-label={`Μετρητά ${b.name}`} className="h-8" value={balances[b.id] ?? ''} onChange={e => onBalance(b.id, e.target.value)} />
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                title={`Αφαίρεση ${b.name}`}
                className="shrink-0 rounded-full text-muted-foreground hover:text-negative"
                disabled={removeAccount.isPending}
                onClick={() => removeAccount.mutate(b.id)}
              >
                <Trash2 className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <Input aria-label="Νέα πλατφόρμα" placeholder="Όνομα πλατφόρμας" className="h-8" value={brokerName} onChange={e => setBrokerName(e.target.value)} onKeyDown={e => e.key === 'Enter' && addBroker()} />
        <Button size="sm" variant="outline" className="shrink-0 rounded-full" disabled={!brokerName.trim() || save.isPending} onClick={addBroker}>
          <Plus className="size-4" /> Πλατφόρμα
        </Button>
      </div>
    </Section>
  );

  if (brokers.length === 0) return platforms;

  return (
    <>
      {platforms}
      <Section
        title="Pies"
        action={<Button variant="outline" size="sm" className="rounded-full" onClick={() => setPieDialog({ create: true })}><Plus className="size-4" /> Pie</Button>}
      >
        <p className="text-muted-foreground">Ομάδες μετοχών με ποσοστό-στόχο (όπως στο Trading 212). Αν δεν έχεις, προχώρα.</p>
        {pies.length > 0 && (
          <ul className="divide-y rounded-xl border">
            {pies.map(p => (
              <li key={p.id} className="flex items-center gap-2 px-3 py-2">
                <ChartPie className="size-4 shrink-0 text-primary" />
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium">{p.name}</span>
                  <span className="text-muted-foreground"> · {accountName(p.accountId)} · {p.slices.length} μετοχές</span>
                </span>
                <Button variant="ghost" size="icon-sm" title={`Σύνθεση ${p.name}`} onClick={() => setPieDialog({ pie: p })}><Pencil className="size-4" /></Button>
                <Button variant="ghost" size="icon-sm" title={`Διαγραφή ${p.name}`} className="hover:text-negative" onClick={() => removePie.mutate(p.id)}>
                  <Trash2 className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        title="Μετοχές"
        action={<Button variant="outline" size="sm" className="rounded-full" onClick={() => setInstrumentDialog(true)}><Plus className="size-4" /> Μετοχή</Button>}
      >
        <p className="text-muted-foreground">
          Ποσότητα και πόσα πλήρωσες συνολικά, ακριβώς όπως στον broker. Αφαίρεσε όσες δεν έχεις (πρώτα από το pie, αν είναι μέσα).
        </p>
        {positions.length === 0 ? (
          <p className="rounded-xl border border-dashed p-4 text-center text-muted-foreground">Πρόσθεσε τις μετοχές σου με αναζήτηση.</p>
        ) : (
          <div className="-mx-5 overflow-x-auto px-5 sm:-mx-6 sm:px-6">
            <table className="w-full min-w-[520px]">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="pb-2 text-left font-medium">Μετοχή</th>
                  <th className="w-32 pb-2 pl-2 text-left font-medium">Πλατφόρμα</th>
                  <th className="w-28 pb-2 pl-2 text-right font-medium">Ποσότητα</th>
                  <th className="w-32 pb-2 pl-2 text-right font-medium">Κόστος</th>
                  <th className="w-9" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {positions.map(p => (
                  <tr key={p.instrumentId}>
                    <td className="py-2 pr-2 font-medium">{instrumentName(p.instrumentId)}</td>
                    <td className="py-2 pl-2">
                      <Select value={p.accountId} onValueChange={v => onPosition(p.instrumentId, { accountId: v })}>
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
                        onChange={e => onPosition(p.instrumentId, { quantity: e.target.value })}
                      />
                    </td>
                    <td className="py-2 pl-2">
                      <AmountInput aria-label={`Κόστος ${instrumentName(p.instrumentId)}`} className="h-8" value={p.cost} onChange={e => onPosition(p.instrumentId, { cost: e.target.value })} />
                    </td>
                    <td className="py-2 pl-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        title={`Αφαίρεση ${instrumentName(p.instrumentId)}`}
                        className="rounded-full text-muted-foreground hover:text-negative"
                        disabled={removeInstrument.isPending}
                        onClick={() => removeInstrument.mutate(p.instrumentId)}
                      >
                        <X className="size-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <InstrumentDialog open={instrumentDialog} onClose={() => setInstrumentDialog(false)} />
      <PieEditDialog pie={pieDialog?.pie} create={pieDialog?.create} onClose={() => setPieDialog(null)} />
    </>
  );
}

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-2 border-t pt-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}
