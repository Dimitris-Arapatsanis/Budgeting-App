import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  AccountInput,
  AuthStatus,
  AccountWithBalance,
  Category,
  CategoryInput,
  Debt,
  DebtForgiveInput,
  DebtInput,
  DebtPaymentInput,
  Instrument,
  InstrumentSearchResult,
  MonthSummary,
  NetWorthHistory,
  Pie,
  PieInput,
  PiePreviewInput,
  PiePreviewLine,
  Recurring,
  RecurringDue,
  RecurringInput,
  SetupInput,
  SetupStatus,
  Portfolio,
  ReconcileInput,
  Trade,
  TradeInput,
  Transaction,
  TransactionInput,
  YearSummary,
} from '@budget/shared';

/** Ο server απάντησε 401 (έληξε η σύνδεση): το AuthGate ξαναδείχνει την οθόνη σύνδεσης */
export const UNAUTHORIZED_EVENT = 'budget:unauthorized';

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401 && !url.startsWith('/api/auth/')) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error ?? `Σφάλμα ${res.status}`);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

// ---------- Queries ----------

export const useAccounts = () =>
  useQuery({ queryKey: ['accounts'], queryFn: () => request<AccountWithBalance[]>('GET', '/api/accounts') });

export const useCategories = () =>
  useQuery({ queryKey: ['categories'], queryFn: () => request<Category[]>('GET', '/api/categories') });

export const useTransactions = (month: string) =>
  useQuery({
    queryKey: ['transactions', month],
    queryFn: () => request<Transaction[]>('GET', `/api/transactions?month=${month}`),
  });

export const useSummary = (month: string) =>
  useQuery({
    queryKey: ['summary', month],
    queryFn: () => request<MonthSummary>('GET', `/api/summary?month=${month}`),
  });

export const useYearSummary = (year: number) =>
  useQuery({
    queryKey: ['year', year],
    queryFn: () => request<YearSummary>('GET', `/api/year?year=${year}`),
  });

export const useInstruments = () =>
  useQuery({ queryKey: ['instruments'], queryFn: () => request<Instrument[]>('GET', '/api/instruments') });

export const useInstrumentSearch = (query: string) =>
  useQuery({
    queryKey: ['instrument-search', query],
    queryFn: () => request<InstrumentSearchResult[]>('GET', `/api/instruments/search?q=${encodeURIComponent(query)}`),
    enabled: query.trim().length >= 2,
    staleTime: 5 * 60_000,
  });

export const useTrades = () => useQuery({ queryKey: ['trades'], queryFn: () => request<Trade[]>('GET', '/api/trades') });

export const usePies = () => useQuery({ queryKey: ['pies'], queryFn: () => request<Pie[]>('GET', '/api/pies') });

// Οι τιμές ανανεώνονται στον server κάθε 15 λεπτά
export const usePortfolio = () =>
  useQuery({
    queryKey: ['portfolio'],
    queryFn: () => request<Portfolio>('GET', '/api/portfolio'),
    staleTime: 5 * 60_000,
    refetchInterval: 15 * 60_000,
  });

/** Πρόταση για αγορά στο pie (δεν αποθηκεύει). */
export const piePreview = (pieId: number, input: PiePreviewInput) =>
  request<PiePreviewLine[]>('POST', `/api/pies/${pieId}/preview`, input);

// Χρειάζεται τιμές μετοχών για κάθε τέλος μήνα: ο server τις κρατάει στη βάση, οπότε μετά την 1η φορά είναι γρήγορο
export const useNetWorth = () =>
  useQuery({ queryKey: ['networth'], queryFn: () => request<NetWorthHistory>('GET', '/api/networth'), staleTime: 5 * 60_000 });

export const useSetupStatus = () =>
  useQuery({ queryKey: ['setup-status'], queryFn: () => request<SetupStatus>('GET', '/api/setup/status'), staleTime: Infinity });

export const useAuthStatus = () =>
  useQuery({ queryKey: ['auth-status'], queryFn: () => request<AuthStatus>('GET', '/api/auth/status'), staleTime: Infinity, retry: 1 });

export const useRecurring = () =>
  useQuery({ queryKey: ['recurring'], queryFn: () => request<Recurring[]>('GET', '/api/recurring') });

export const useRecurringDue = (month: string) =>
  useQuery({ queryKey: ['recurring-due', month], queryFn: () => request<RecurringDue[]>('GET', `/api/recurring/due?month=${month}`) });

export const useDebts = () => useQuery({ queryKey: ['debts'], queryFn: () => request<Debt[]>('GET', '/api/debts') });

// ---------- Mutations ----------

// Κάθε αλλαγή επηρεάζει υπόλοιπα και συνόψεις, οπότε ανανεώνουμε όλα τα δεδομένα.
function useApiMutation<TVars, TResult = unknown>(fn: (vars: TVars) => Promise<TResult>, successMessage?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      queryClient.invalidateQueries();
      if (successMessage) toast.success(successMessage);
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export const useSaveTransaction = () =>
  useApiMutation(({ id, input }: { id?: number; input: TransactionInput }) =>
    id ? request('PUT', `/api/transactions/${id}`, input) : request('POST', '/api/transactions', input));

/** Διαγραφή χωρίς ερώτηση, με «Αναίρεση» στο toast (ξαναδημιουργεί τη συναλλαγή με νέο id). */
export function useDeleteTransaction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (t: Transaction) => request('DELETE', `/api/transactions/${t.id}`),
    onSuccess: (_result, t) => {
      queryClient.invalidateQueries();
      toast.success('Η συναλλαγή διαγράφηκε', {
        action: {
          label: 'Αναίρεση',
          onClick: () => {
            // Το server κρατάει μόνο τα πεδία που ισχύουν για τον τύπο (π.χ. αγνοεί το id)
            request('POST', '/api/transactions', t as unknown as TransactionInput)
              .then(() => queryClient.invalidateQueries())
              .catch((err: Error) => toast.error(err.message));
          },
        },
      });
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export const useSaveAccount = () =>
  useApiMutation(({ id, input }: { id?: number; input: AccountInput }) =>
    id ? request('PUT', `/api/accounts/${id}`, input) : request('POST', '/api/accounts', input));

export const useDeleteAccount = () =>
  useApiMutation((id: number) => request('DELETE', `/api/accounts/${id}`), 'Ο λογαριασμός διαγράφηκε');

export const useReconcileAccount = () =>
  useApiMutation(({ id, input }: { id: number; input: ReconcileInput }) =>
    request<{ adjustment: number }>('POST', `/api/accounts/${id}/reconcile`, input));

export const useSaveCategory = () =>
  useApiMutation(({ id, input }: { id?: number; input: CategoryInput }) =>
    id ? request('PUT', `/api/categories/${id}`, input) : request('POST', '/api/categories', input));

export const useDeleteCategory = () =>
  useApiMutation((id: number) => request('DELETE', `/api/categories/${id}`), 'Η κατηγορία διαγράφηκε');

export const useAddInstrument = () =>
  useApiMutation((ticker: string) => request<Instrument>('POST', '/api/instruments', { ticker }));

export const useDeleteInstrument = () =>
  useApiMutation((id: number) => request('DELETE', `/api/instruments/${id}`), 'Η μετοχή αφαιρέθηκε');

export const useSaveTrade = () =>
  useApiMutation(({ id, input }: { id?: number; input: TradeInput }) =>
    id ? request('PUT', `/api/trades/${id}`, input) : request('POST', '/api/trades', input));

export const useSaveTradeBatch = () =>
  useApiMutation((trades: TradeInput[]) => request<Trade[]>('POST', '/api/trades/batch', { trades }));

/** Όπως η διαγραφή συναλλαγής: χωρίς ερώτηση, με «Αναίρεση». Δέχεται πολλές κινήσεις (π.χ. όλη μια αγορά στο pie). */
export function useDeleteTrades() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ts: Trade[]) => Promise.all(ts.map(t => request('DELETE', `/api/trades/${t.id}`))),
    onSuccess: (_result, ts) => {
      queryClient.invalidateQueries();
      toast.success(ts.length > 1 ? `Διαγράφηκαν ${ts.length} κινήσεις` : 'Η κίνηση διαγράφηκε', {
        action: {
          label: 'Αναίρεση',
          onClick: () => {
            request('POST', '/api/trades/batch', { trades: ts })
              .then(() => queryClient.invalidateQueries())
              .catch((err: Error) => toast.error(err.message));
          },
        },
      });
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export const useSavePie = () =>
  useApiMutation(({ id, input }: { id?: number; input: PieInput }) =>
    id ? request('PUT', `/api/pies/${id}`, input) : request('POST', '/api/pies', input), 'Το pie αποθηκεύτηκε');

export const useSaveDebt = () =>
  useApiMutation(({ id, input }: { id?: number; input: DebtInput }) =>
    id ? request<Debt>('PUT', `/api/debts/${id}`, input) : request<Debt>('POST', '/api/debts', input));

export const useDeleteDebt = () =>
  useApiMutation((id: number) => request('DELETE', `/api/debts/${id}`), 'Το χρωστούμενο διαγράφηκε');

export const useDebtPayment = () =>
  useApiMutation(({ id, input }: { id: number; input: DebtPaymentInput }) => request<Debt>('POST', `/api/debts/${id}/payments`, input));

export const useForgiveDebt = () =>
  useApiMutation(({ id, input }: { id: number; input: DebtForgiveInput }) => request<Debt>('POST', `/api/debts/${id}/forgive`, input));

export const useDeleteDebtPayment = () =>
  useApiMutation(({ id, transactionId }: { id: number; transactionId: number }) =>
    request<Debt>('DELETE', `/api/debts/${id}/payments/${transactionId}`));

/** Αρχικοποίηση. Η κατάσταση «άδεια» αλλάζει αμέσως, αλλιώς ο οδηγός θα ξανανοίγε μέχρι να έρθει η νέα τιμή. */
export function useSetup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SetupInput) => request('POST', '/api/setup', input),
    onSuccess: () => {
      queryClient.setQueryData<SetupStatus>(['setup-status'], { empty: false });
      queryClient.invalidateQueries({ predicate: q => q.queryKey[0] !== 'setup-status' });
      toast.success('Έτοιμο! Η αφετηρία αποθηκεύτηκε');
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useReset() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => request<{ backup: string | null }>('POST', '/api/reset', { confirm: 'ΔΙΑΓΡΑΦΗ' }),
    onSuccess: () => {
      queryClient.setQueryData<SetupStatus>(['setup-status'], { empty: true });
      queryClient.invalidateQueries({ predicate: q => q.queryKey[0] !== 'setup-status' });
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export const useSaveRecurring = () =>
  useApiMutation(({ id, input }: { id?: number; input: RecurringInput }) =>
    id ? request<Recurring>('PUT', `/api/recurring/${id}`, input) : request<Recurring>('POST', '/api/recurring', input));

export const useDeleteRecurring = () =>
  useApiMutation((id: number) => request('DELETE', `/api/recurring/${id}`), 'Η επανάληψη διαγράφηκε');

/** «Όχι αυτόν τον μήνα», με «Αναίρεση» στο toast. */
export function useSkipRecurring() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (due: RecurringDue) => request('POST', `/api/recurring/${due.recurring.id}/skip`, { dueDate: due.dueDate }),
    onSuccess: (_result, due) => {
      queryClient.invalidateQueries({ queryKey: ['recurring-due'] });
      toast.success('Παραλείφθηκε για αυτόν τον μήνα', {
        action: {
          label: 'Αναίρεση',
          onClick: () => {
            request('DELETE', `/api/recurring/${due.recurring.id}/skip/${due.dueDate}`)
              .then(() => queryClient.invalidateQueries({ queryKey: ['recurring-due'] }))
              .catch((err: Error) => toast.error(err.message));
          },
        },
      });
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

/** Μετά τη σύνδεση: ξανά όλα τα δεδομένα (και η κατάσταση σύνδεσης). */
function useAuthMutation<TVars>(fn: (vars: TVars) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => queryClient.invalidateQueries() });
}

export const useSetupPassword = () => useAuthMutation((password: string) => request('POST', '/api/auth/setup', { password }));

export const useLogin = () => useAuthMutation((password: string) => request('POST', '/api/auth/login', { password }));

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => request('POST', '/api/auth/logout'),
    // Καθαρίζουμε ό,τι έχει φορτωθεί, ώστε να μη μείνουν δεδομένα στη μνήμη μετά την αποσύνδεση,
    // και δείχνουμε αμέσως την οθόνη σύνδεσης
    onSuccess: () => {
      queryClient.removeQueries({ predicate: q => q.queryKey[0] !== 'auth-status' });
      queryClient.setQueryData<AuthStatus>(['auth-status'], s => s && { ...s, authenticated: false });
    },
  });
}

export const useChangePassword = () =>
  useApiMutation((input: { current: string; next: string }) => request('POST', '/api/auth/password', input), 'Ο κωδικός άλλαξε');
