import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  AccountInput,
  AccountWithBalance,
  Category,
  CategoryInput,
  MonthSummary,
  ReconcileInput,
  Transaction,
  TransactionInput,
  YearSummary,
} from '@budget/shared';

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
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
