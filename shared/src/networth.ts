import { computeBalances, tradeCashEffect } from './calc.ts';
import { addDays, lastDayOfMonth } from './month.ts';
import type { Account, Trade, Transaction } from './schemas.ts';

/** Καθαρή περιουσία σε μια ημερομηνία, ανά κομμάτι. Όλα σε cents. */
export interface NetWorthBreakdown {
  /** Τράπεζες, αποταμίευση, μετρητά */
  cash: number;
  /** Ανάλυση του `cash` ανά λογαριασμό */
  cashByAccount: Array<{ accountId: number; amount: number }>;
  /** Αξία μετοχών */
  stocks: number;
  /** Αεπένδυτα μετρητά στους brokers */
  brokerCash: number;
  /** Μου χρωστάνε */
  receivables: number;
  /** Δάνεια + όσα χρωστάω, ως θετικό ποσό */
  debts: number;
  /** cash + stocks + brokerCash + receivables − debts */
  total: number;
}

export interface NetWorthMonth {
  month: string;
  /** Καθαρή περιουσία στο τέλος του προηγούμενου μήνα */
  start: number;
  /** Στο τέλος του μήνα (για τον τρέχοντα μήνα: σήμερα) */
  end: NetWorthBreakdown;
  change: number;
  /** Ανάλυση της μεταβολής: change = savings + marketChange (διορθώσεις και αρχικές θέσεις είναι αφετηρία, βλ. computeNetWorthMonths) */
  savings: number;
  /** Άνοδος/πτώση της αγοράς */
  marketChange: number;
  /** Αν λείπει κάποια τιμή μετοχής */
  incomplete: boolean;
}

export interface NetWorthYear {
  year: number;
  start: number;
  end: number;
  change: number;
  savings: number;
  marketChange: number;
  incomplete: boolean;
}

export interface NetWorthHistory {
  /** Από τον πρώτο μήνα με κινήσεις μέχρι τον τρέχοντα */
  months: NetWorthMonth[];
  years: NetWorthYear[];
  /** Σήμερα */
  current: NetWorthBreakdown;
  /** Ο πρώτος μήνας με κινήσεις (null αν δεν υπάρχει καμία) */
  since: string | null;
}

/** Η καθαρή περιουσία με βάση τα υπόλοιπα των λογαριασμών και την αξία των μετοχών. */
export function netWorthBreakdown(
  accounts: Pick<Account, 'id' | 'type'>[],
  balances: Map<number, number>,
  stocks: number,
): NetWorthBreakdown {
  const b = { cash: 0, cashByAccount: [] as Array<{ accountId: number; amount: number }>, stocks, brokerCash: 0, receivables: 0, debts: 0 };
  for (const a of accounts) {
    const balance = balances.get(a.id) ?? 0;
    switch (a.type) {
      case 'broker':
        b.brokerCash += balance;
        break;
      case 'receivable':
        b.receivables += balance;
        break;
      case 'loan':
      case 'payable':
        b.debts -= balance;
        break;
      default:
        b.cash += balance;
        if (balance !== 0) b.cashByAccount.push({ accountId: a.id, amount: balance });
    }
  }
  return { ...b, total: b.cash + b.stocks + b.brokerCash + b.receivables - b.debts };
}

/** Η πρώτη μέρα με συναλλαγή ή κίνηση μετοχής: η ημέρα έναρξης (αφετηρία) της πορείας. */
export function firstActivityDate(transactions: Pick<Transaction, 'date'>[], trades: Pick<Trade, 'date'>[]): string | null {
  let first: string | null = null;
  for (const { date } of [...transactions, ...trades]) if (!first || date < first) first = date;
  return first;
}

/** Η ημερομηνία αποτίμησης ενός μήνα: η τελευταία του μέρα, ή σήμερα για τον τρέχοντα μήνα. */
export const monthValuationDate = (month: string, today: string) => {
  const last = lastDayOfMonth(month);
  return last < today ? last : today;
};

/**
 * Καθαρή περιουσία ανά μήνα. Οι αξίες των μετοχών υπολογίζονται από τον server (χρειάζονται τιμές)
 * και δίνονται ανά ημερομηνία αποτίμησης στο `stockValues`, με τις αρχικές θέσεις να υπάρχουν από την αρχή
 * (`asStartingPoint`): είναι μετοχές που ο χρήστης είχε ήδη, όχι κέρδος.
 *
 * Η αφετηρία (`start` του πρώτου μήνα) είναι η κατάσταση την ημέρα έναρξης `startDate`, πριν από τις κινήσεις της:
 * η άνοδος/πτώση της αγοράς πριν ξεκινήσει ο χρήστης δεν μετράει.
 *
 * Οι διορθώσεις υπολοίπου (adjustments) μετράνε από την αρχή, σαν αλλαγή του αρχικού υπολοίπου: διορθώνουν
 * ένα λάθος, δεν είναι κέρδος ή ζημιά. Έτσι κανένας μήνας δεν δείχνει μεταβολή από διόρθωση, ενώ τα
 * υπόλοιπα (και η περιουσία σήμερα) μένουν ίδια.
 */
export function computeNetWorthMonths(
  accounts: Pick<Account, 'id' | 'type' | 'initialBalance'>[],
  transactions: Transaction[],
  trades: Trade[],
  months: string[],
  today: string,
  startDate: string,
  stockValues: Map<string, { value: number; incomplete: boolean }>,
): NetWorthMonth[] {
  const adjustmentsByAccount = new Map<number, number>();
  for (const t of transactions) {
    if (t.type === 'adjustment') adjustmentsByAccount.set(t.accountId, (adjustmentsByAccount.get(t.accountId) ?? 0) + t.amount);
  }
  const corrected = accounts.map(a => ({ ...a, initialBalance: a.initialBalance + (adjustmentsByAccount.get(a.id) ?? 0) }));
  const flows = transactions.filter(t => t.type !== 'adjustment');
  // Υπόλοιπα έως και `date`, μετοχές αποτιμημένες στο `priceDate`
  const at = (date: string, priceDate = date) => {
    const stocks = stockValues.get(priceDate) ?? { value: 0, incomplete: false };
    return { breakdown: netWorthBreakdown(corrected, computeBalances(corrected, flows, date, trades), stocks.value), incomplete: stocks.incomplete };
  };
  const result: NetWorthMonth[] = [];
  let previous = months.length ? at(addDays(startDate, -1), startDate) : null;
  for (const month of months) {
    const end = at(monthValuationDate(month, today));
    const txs = transactions.filter(t => t.date.startsWith(month));
    const sum = (type: Transaction['type']) => txs.filter(t => t.type === type).reduce((acc, t) => acc + t.amount, 0);
    const monthTrades = trades.filter(t => t.date.startsWith(month));
    // Χρήματα που έγιναν μετοχές (αγορές − πωλήσεις): δεν είναι κέρδος της αγοράς
    const netBought = monthTrades.reduce((acc, t) => acc - tradeCashEffect(t), 0);
    const start = previous!.breakdown;
    result.push({
      month,
      start: start.total,
      end: end.breakdown,
      change: end.breakdown.total - start.total,
      savings: sum('income') - sum('expense'),
      marketChange: end.breakdown.stocks - start.stocks - netBought,
      incomplete: end.incomplete || previous!.incomplete,
    });
    previous = end;
  }
  return result;
}

/**
 * Οι αρχικές θέσεις (`opening`) ως αφετηρία: σαν να υπήρχαν από την αρχή της πορείας, όπως τα αρχικά υπόλοιπα.
 * Για την αποτίμηση της πορείας της περιουσίας, όχι για το κόστος κτήσης.
 */
export const asStartingPoint = (trades: Trade[]): Trade[] =>
  trades.map(t => (t.side === 'opening' ? { ...t, date: '0000-00-00' } : t));

/** Σύνολα ανά έτος από τους μήνες. */
export function summarizeNetWorthYears(months: NetWorthMonth[]): NetWorthYear[] {
  const years = new Map<number, NetWorthYear>();
  for (const m of months) {
    const year = Number(m.month.slice(0, 4));
    const y = years.get(year) ?? {
      year, start: m.start, end: m.start, change: 0, savings: 0, marketChange: 0, incomplete: false,
    };
    y.end = m.end.total;
    y.change += m.change;
    y.savings += m.savings;
    y.marketChange += m.marketChange;
    y.incomplete ||= m.incomplete;
    years.set(year, y);
  }
  return [...years.values()];
}
