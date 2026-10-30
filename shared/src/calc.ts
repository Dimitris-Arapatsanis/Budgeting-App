import type { Account, Trade, Transaction } from './schemas.ts';

/** Πώς επηρεάζει μια συναλλαγή τα υπόλοιπα: λίστα [accountId, μεταβολή σε cents]. */
export function transactionEffects(t: Transaction): Array<[number, number]> {
  switch (t.type) {
    case 'income':
      return [[t.accountId, t.amount]];
    case 'expense':
      return [[t.accountId, -t.amount]];
    case 'transfer':
      return t.toAccountId == null ? [] : [[t.accountId, -t.amount], [t.toAccountId, t.amount]];
    case 'adjustment':
      return [[t.accountId, t.amount]];
  }
}

/** Πώς επηρεάζει μια αγορά/πώληση τα μετρητά του broker. Η αρχική θέση δεν τα επηρεάζει. */
export function tradeCashEffect(t: Pick<Trade, 'side' | 'amountEur'>): number {
  return t.side === 'buy' ? -t.amountEur : t.side === 'sell' ? t.amountEur : 0;
}

/** Υπόλοιπα λογαριασμών, λαμβάνοντας υπόψη συναλλαγές και trades μέχρι και την ημερομηνία `until` (αν δοθεί). */
export function computeBalances(
  accounts: Pick<Account, 'id' | 'initialBalance'>[],
  transactions: Transaction[],
  until?: string,
  trades: Trade[] = [],
): Map<number, number> {
  const balances = new Map(accounts.map(a => [a.id, a.initialBalance]));
  const add = (accountId: number, delta: number) => balances.set(accountId, (balances.get(accountId) ?? 0) + delta);
  for (const t of transactions) {
    if (until && t.date > until) continue;
    for (const [accountId, delta] of transactionEffects(t)) add(accountId, delta);
  }
  for (const t of trades) {
    if (until && t.date > until) continue;
    add(t.accountId, tradeCashEffect(t));
  }
  return balances;
}

export interface CategoryTotal {
  categoryId: number;
  amount: number;
}

export interface AccountAmount {
  accountId: number;
  amount: number;
}

/** Πού κατέληξε η αποταμίευση: καθαρή μεταβολή ανά λογαριασμό (χωρίς adjustments). Το άθροισμα = αποταμίευση. */
export interface SavingsAllocation {
  /** broker και loan λογαριασμοί, ο καθένας χωριστά */
  accounts: AccountAmount[];
  /** bank + savings + cash μαζί */
  cash: number;
  cashByAccount: AccountAmount[];
}

const CASH_TYPES = new Set(['bank', 'savings', 'cash']);

export function computeSavingsAllocation(
  transactions: Transaction[],
  accounts: Pick<Account, 'id' | 'type'>[],
): SavingsAllocation {
  const net = new Map<number, number>();
  for (const t of transactions) {
    if (t.type === 'adjustment') continue;
    for (const [accountId, delta] of transactionEffects(t)) net.set(accountId, (net.get(accountId) ?? 0) + delta);
  }
  const typeOf = new Map(accounts.map(a => [a.id, a.type]));
  const result: SavingsAllocation = { accounts: [], cash: 0, cashByAccount: [] };
  for (const [accountId, amount] of net) {
    if (amount === 0) continue;
    if (CASH_TYPES.has(typeOf.get(accountId) ?? 'bank')) {
      result.cash += amount;
      result.cashByAccount.push({ accountId, amount });
    } else {
      result.accounts.push({ accountId, amount });
    }
  }
  const byAmountDesc = (a: AccountAmount, b: AccountAmount) => b.amount - a.amount;
  result.accounts.sort(byAmountDesc);
  result.cashByAccount.sort(byAmountDesc);
  return result;
}

export type MonthStatus =
  | 'ok' // έσοδα ≥ έξοδα
  | 'overspent'; // έξοδα > έσοδα

export interface MonthSummary {
  income: number;
  expenses: number;
  /** έσοδα − έξοδα */
  savings: number;
  /** savings / income, null αν δεν υπάρχουν έσοδα */
  savingsRate: number | null;
  adjustments: number;
  /** συνολική μεταβολή υπολοίπων όλων των λογαριασμών */
  balanceChange: number;
  status: MonthStatus;
  /** πόσα ήρθαν από τα μαζεμένα σε μείον μήνα (0 αν status = ok) */
  fromSavings: number;
  expensesByCategory: CategoryTotal[];
  incomeByCategory: CategoryTotal[];
  allocation: SavingsAllocation;
  /** καθαρά χρήματα που πήγαν σε broker λογαριασμούς */
  toBrokers: number;
  /** σε μετοχές: αγορές − πωλήσεις του μήνα (χωρίς αρχικές θέσεις) */
  invested: number;
}

function totalsByCategory(transactions: Transaction[]): CategoryTotal[] {
  const map = new Map<number, number>();
  for (const t of transactions) {
    if (t.categoryId != null) map.set(t.categoryId, (map.get(t.categoryId) ?? 0) + t.amount);
  }
  return [...map].map(([categoryId, amount]) => ({ categoryId, amount })).sort((a, b) => b.amount - a.amount);
}

/**
 * Αποτέλεσμα μήνα. Το `transactions` πρέπει να περιέχει μόνο τις συναλλαγές του μήνα.
 * Το αποτέλεσμα εξαρτάται μόνο από έσοδα − έξοδα, όχι από το σε ποιον λογαριασμό είναι τα λεφτά.
 */
export function computeMonthSummary(
  transactions: Transaction[],
  accounts: Pick<Account, 'id' | 'type'>[],
  trades: Trade[] = [],
): MonthSummary {
  const incomeTxs = transactions.filter(t => t.type === 'income');
  const expenseTxs = transactions.filter(t => t.type === 'expense');

  const sum = (txs: Transaction[]) => txs.reduce((acc, t) => acc + t.amount, 0);
  const income = sum(incomeTxs);
  const expenses = sum(expenseTxs);
  const savings = income - expenses;
  const adjustments = sum(transactions.filter(t => t.type === 'adjustment'));

  const allocation = computeSavingsAllocation(transactions, accounts);
  const brokerIds = new Set(accounts.filter(a => a.type === 'broker').map(a => a.id));
  const toBrokers = allocation.accounts.filter(a => brokerIds.has(a.accountId)).reduce((acc, a) => acc + a.amount, 0);

  const invested = trades.reduce((acc, t) => acc - tradeCashEffect(t), 0);

  const status: MonthStatus = savings < 0 ? 'overspent' : 'ok';

  return {
    income,
    expenses,
    savings,
    savingsRate: income > 0 ? savings / income : null,
    adjustments,
    balanceChange: savings + adjustments,
    status,
    fromSavings: Math.max(0, -savings),
    expensesByCategory: totalsByCategory(expenseTxs),
    incomeByCategory: totalsByCategory(incomeTxs),
    allocation,
    toBrokers,
    invested,
  };
}

export interface YearMonth {
  month: string;
  /** αν ο μήνας έχει έστω μία συναλλαγή */
  hasData: boolean;
  summary: MonthSummary;
}

export interface YearSummary {
  year: number;
  months: YearMonth[];
  /** σύνολα όλου του έτους (το `status` εδώ δεν έχει νόημα) */
  total: MonthSummary;
  positiveMonths: number;
  negativeMonths: number;
}

/** Ετήσια εικόνα. Το `transactions` πρέπει να περιέχει μόνο τις συναλλαγές του έτους. */
export function computeYearSummary(
  year: number,
  transactions: Transaction[],
  accounts: Pick<Account, 'id' | 'type'>[],
  trades: Trade[] = [],
): YearSummary {
  const months: YearMonth[] = Array.from({ length: 12 }, (_, i) => {
    const month = `${year}-${String(i + 1).padStart(2, '0')}`;
    const monthTxs = transactions.filter(t => t.date.startsWith(month));
    const monthTrades = trades.filter(t => t.date.startsWith(month));
    return { month, hasData: monthTxs.length > 0, summary: computeMonthSummary(monthTxs, accounts, monthTrades) };
  });
  const active = months.filter(m => m.summary.income > 0 || m.summary.expenses > 0);
  return {
    year,
    months,
    total: computeMonthSummary(transactions, accounts, trades),
    positiveMonths: active.filter(m => m.summary.savings >= 0).length,
    negativeMonths: active.filter(m => m.summary.savings < 0).length,
  };
}
