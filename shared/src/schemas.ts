import { z } from 'zod';
import { ISO_DATE_RE, MONTH_KEY_RE } from './month.ts';

// ---------- Λογαριασμοί ----------

/** Τύποι που φτιάχνει ο χρήστης */
export const ACCOUNT_TYPES = ['bank', 'savings', 'cash', 'broker', 'loan'] as const;
/**
 * Λογαριασμοί συστήματος για τα χρωστούμενα: ένας ανά τύπο, φτιάχνονται αυτόματα με το πρώτο χρέος.
 * Δεν φαίνονται στις λίστες λογαριασμών και τα υπόλοιπά τους αλλάζουν μόνο μέσα από τα χρωστούμενα.
 */
export const DEBT_ACCOUNT_TYPES = ['receivable', 'payable'] as const;
export const ALL_ACCOUNT_TYPES = [...ACCOUNT_TYPES, ...DEBT_ACCOUNT_TYPES] as const;
export type AccountType = (typeof ALL_ACCOUNT_TYPES)[number];
export type UserAccountType = (typeof ACCOUNT_TYPES)[number];
export const isDebtAccount = (a: { type: AccountType }) => a.type === 'receivable' || a.type === 'payable';

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  bank: 'Τράπεζα',
  savings: 'Αποταμίευση',
  cash: 'Μετρητά',
  broker: 'Broker',
  loan: 'Δάνειο',
  receivable: 'Μου χρωστάνε',
  payable: 'Χρωστάω',
};

export const accountInputSchema = z.object({
  name: z.string().trim().min(1, 'Το όνομα είναι υποχρεωτικό').max(60),
  type: z.enum(ACCOUNT_TYPES),
  // Για δάνεια το υπόλοιπο είναι αρνητικό (οφειλή)
  initialBalance: z.number().int(),
  archived: z.boolean().default(false),
});
export type AccountInput = z.input<typeof accountInputSchema>;

export interface Account {
  id: number;
  name: string;
  type: AccountType;
  initialBalance: number;
  archived: boolean;
  sortOrder: number;
}

export interface AccountWithBalance extends Account {
  balance: number;
}

export const reconcileInputSchema = z.object({
  actualBalance: z.number().int(),
  date: z.string().regex(ISO_DATE_RE),
});
export type ReconcileInput = z.infer<typeof reconcileInputSchema>;

// ---------- Κατηγορίες ----------

export const CATEGORY_KINDS = ['income', 'expense'] as const;
export type CategoryKind = (typeof CATEGORY_KINDS)[number];

/** Εικονίδια κατηγοριών (lucide). Το client αντιστοιχίζει κάθε κλειδί σε component. */
export const CATEGORY_ICONS = [
  'tag', 'house', 'shopping-cart', 'shopping-bag', 'zap', 'wifi', 'smartphone', 'car', 'fuel', 'bus', 'bike',
  'plane', 'utensils', 'coffee', 'beer', 'clapperboard', 'gamepad', 'ticket', 'book', 'heart-pulse', 'pill',
  'dumbbell', 'shirt', 'scissors', 'sofa', 'wrench', 'baby', 'paw', 'graduation-cap', 'laptop', 'repeat',
  'gift', 'briefcase', 'trending-up', 'piggy-bank', 'landmark', 'dollar', 'sparkles',
] as const;
export type CategoryIcon = (typeof CATEGORY_ICONS)[number];

/** Παλέτα χρωμάτων κατηγοριών. Αποθηκεύεται το όνομα, η απόχρωση ορίζεται στο client ανά θέμα. */
export const CATEGORY_COLORS = [
  'indigo', 'violet', 'pink', 'red', 'orange', 'amber', 'brown', 'green', 'emerald', 'teal', 'blue', 'slate',
] as const;
export type CategoryColor = (typeof CATEGORY_COLORS)[number];

export const categoryInputSchema = z.object({
  name: z.string().trim().min(1, 'Το όνομα είναι υποχρεωτικό').max(40),
  kind: z.enum(CATEGORY_KINDS),
  icon: z.enum(CATEGORY_ICONS).default('tag'),
  color: z.enum(CATEGORY_COLORS).default('slate'),
});
export type CategoryInput = z.input<typeof categoryInputSchema>;

export interface Category {
  id: number;
  name: string;
  kind: CategoryKind;
  icon: CategoryIcon;
  color: CategoryColor;
}

// ---------- Συναλλαγές ----------

export const TRANSACTION_TYPES = ['income', 'expense', 'transfer', 'adjustment'] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

const id = z.number().int().positive();
const positiveAmount = z.number().int().positive('Το ποσό πρέπει να είναι θετικό');
const common = {
  date: z.string().regex(ISO_DATE_RE, 'Μη έγκυρη ημερομηνία'),
  accountId: id,
  description: z.string().trim().max(200).default(''),
};

export const transactionInputSchema = z
  .discriminatedUnion('type', [
    z.object({ ...common, type: z.literal('income'), amount: positiveAmount, categoryId: id }),
    z.object({ ...common, type: z.literal('expense'), amount: positiveAmount, categoryId: id }),
    z.object({ ...common, type: z.literal('transfer'), amount: positiveAmount, toAccountId: id }),
    // Διόρθωση υπολοίπου: προσημασμένο ποσό
    z.object({ ...common, type: z.literal('adjustment'), amount: z.number().int().refine(v => v !== 0) }),
  ])
  .refine(t => t.type !== 'transfer' || t.toAccountId !== t.accountId, {
    message: 'Η μεταφορά πρέπει να γίνει σε διαφορετικό λογαριασμό',
    path: ['toAccountId'],
  });
export type TransactionInput = z.input<typeof transactionInputSchema>;
export type ParsedTransactionInput = z.output<typeof transactionInputSchema>;

export interface Transaction {
  id: number;
  date: string;
  type: TransactionType;
  amount: number;
  accountId: number;
  toAccountId: number | null;
  categoryId: number | null;
  description: string;
  /** Αν η συναλλαγή ανήκει σε χρωστούμενο (δανεισμός, επιστροφή, «χαρίστηκε») */
  debtId?: number | null;
}

// ---------- Επενδύσεις ----------

export interface Instrument {
  id: number;
  /** Yahoo symbol, π.χ. "VUSA.AS", "MSFT" */
  ticker: string;
  name: string;
  /** Νόμισμα της τιμής (κανονικοποιημένο, π.χ. GBp → GBP) */
  currency: string;
}

export const instrumentInputSchema = z.object({
  ticker: z.string().trim().min(1, 'Το σύμβολο είναι υποχρεωτικό').max(20).transform(s => s.toUpperCase()),
});

export const searchQuerySchema = z.object({ q: z.string().trim().min(1).max(60) });

export interface InstrumentSearchResult {
  ticker: string;
  name: string;
  exchange: string;
  type: string;
}

/** `opening` = αρχική θέση: μετοχές που είχες ήδη. Μετράει στο portfolio, όχι στα μετρητά ή στις αγορές του μήνα. */
export const TRADE_SIDES = ['buy', 'sell', 'opening'] as const;
export type TradeSide = (typeof TRADE_SIDES)[number];

export const TRADE_SIDE_LABELS: Record<TradeSide, string> = {
  buy: 'Αγορά',
  sell: 'Πώληση',
  opening: 'Αρχική θέση',
};

export const tradeInputSchema = z.object({
  date: z.string().regex(ISO_DATE_RE, 'Μη έγκυρη ημερομηνία'),
  accountId: id,
  instrumentId: id,
  side: z.enum(TRADE_SIDES),
  quantity: z.number().positive('Η ποσότητα πρέπει να είναι θετική'),
  /** Συνολικό ποσό σε EUR (cents), μαζί με τυχόν χρεώσεις */
  amountEur: positiveAmount,
  pieId: id.nullable().default(null),
});
export type TradeInput = z.input<typeof tradeInputSchema>;
export type ParsedTradeInput = z.output<typeof tradeInputSchema>;

export const tradeBatchSchema = z.object({ trades: z.array(tradeInputSchema).min(1).max(50) });

export interface Trade {
  id: number;
  date: string;
  accountId: number;
  instrumentId: number;
  side: TradeSide;
  quantity: number;
  amountEur: number;
  pieId: number | null;
}

export const pieInputSchema = z.object({
  name: z.string().trim().min(1, 'Το όνομα είναι υποχρεωτικό').max(40),
  accountId: id,
  slices: z
    .array(z.object({ instrumentId: id, targetPercent: z.number().positive().max(100) }))
    .min(1, 'Το pie χρειάζεται τουλάχιστον μία μετοχή')
    .refine(s => Math.abs(s.reduce((sum, x) => sum + x.targetPercent, 0) - 100) < 0.01, 'Τα ποσοστά πρέπει να κάνουν 100%')
    .refine(s => new Set(s.map(x => x.instrumentId)).size === s.length, 'Κάθε μετοχή μπαίνει μία φορά'),
});
export type PieInput = z.input<typeof pieInputSchema>;

export interface PieSlice {
  instrumentId: number;
  targetPercent: number;
}

export interface Pie {
  id: number;
  name: string;
  accountId: number;
  slices: PieSlice[];
}

export const piePreviewSchema = z.object({
  amountEur: positiveAmount,
  date: z.string().regex(ISO_DATE_RE, 'Μη έγκυρη ημερομηνία'),
});
export type PiePreviewInput = z.infer<typeof piePreviewSchema>;

/** Τιμή μιας μετοχής σε μια ημερομηνία, στο νόμισμά της και σε EUR. */
export interface PricePoint {
  price: number;
  currency: string;
  /** Μονάδες νομίσματος ανά 1 EUR (1 για EUR) */
  fxRate: number;
  priceEur: number;
  /** Ημερομηνία της τιμής (μπορεί να είναι παλιότερη, π.χ. Σαββατοκύριακο) */
  date: string;
}

export interface PiePreviewLine {
  instrumentId: number;
  targetPercent: number;
  amountEur: number;
  /** null αν δεν βρέθηκε τιμή: ο χρήστης γράφει την ποσότητα μόνος του */
  price: PricePoint | null;
  quantity: number | null;
}

export interface Position {
  accountId: number;
  instrumentId: number;
  quantity: number;
  /** Κόστος κτήσης σε EUR (cents), μέση τιμή */
  costEur: number;
  price: PricePoint | null;
  /** cents, null αν δεν υπάρχει τιμή */
  valueEur: number | null;
  /** Μεταβολή της ημέρας σε cents */
  dayChangeEur: number;
}

export interface PieDrift {
  pieId: number;
  valueEur: number;
  slices: Array<{ instrumentId: number; targetPercent: number; valueEur: number; actualPercent: number }>;
}

export interface Portfolio {
  positions: Position[];
  valueEur: number;
  costEur: number;
  dayChangeEur: number;
  /** Αν κάποια τιμή δεν είναι τρέχουσα (το Yahoo δεν απάντησε) */
  stale: boolean;
  pies: PieDrift[];
}

/** Επενδύσεις ενός μήνα: ροές (αγορές/πωλήσεις) και μεταβολή αξίας λόγω αγοράς. */
export interface InvestmentMonth {
  month: string;
  bought: number;
  sold: number;
  opened: number;
  valueStart: number;
  valueEnd: number;
  /** valueEnd − valueStart − (αγορές − πωλήσεις + αξία αρχικών θέσεων την ημέρα που μπήκαν) */
  marketChange: number;
  /** Αν λείπει κάποια τιμή (τότε το marketChange δεν είναι ακριβές) */
  incomplete: boolean;
}

// ---------- Χρωστούμενα ----------

/** `lent` = δάνεισα (μου χρωστάνε), `borrowed` = δανείστηκα (χρωστάω) */
export const DEBT_DIRECTIONS = ['lent', 'borrowed'] as const;
export type DebtDirection = (typeof DEBT_DIRECTIONS)[number];

export const debtInputSchema = z.object({
  direction: z.enum(DEBT_DIRECTIONS),
  person: z.string().trim().min(1, 'Γράψε σε ποιον / από ποιον').max(60),
  reason: z.string().trim().max(200).default(''),
  date: z.string().regex(ISO_DATE_RE, 'Μη έγκυρη ημερομηνία'),
  amount: positiveAmount,
  /** Από πού βγήκαν (δάνεισα) ή πού μπήκαν (δανείστηκα) τα λεφτά */
  accountId: id,
});
export type DebtInput = z.input<typeof debtInputSchema>;

export const debtPaymentSchema = z.object({
  date: z.string().regex(ISO_DATE_RE, 'Μη έγκυρη ημερομηνία'),
  amount: positiveAmount,
  /** Πού μπήκαν (μου επέστρεψαν) ή από πού βγήκαν (επέστρεψα) τα λεφτά */
  accountId: id,
});
export type DebtPaymentInput = z.infer<typeof debtPaymentSchema>;

/** Χαρίστηκε: το υπόλοιπο γίνεται έξοδο (δάνεισα) ή έσοδο (δανείστηκα) στην κατηγορία. */
export const debtForgiveSchema = z.object({
  date: z.string().regex(ISO_DATE_RE, 'Μη έγκυρη ημερομηνία'),
  categoryId: id,
});
export type DebtForgiveInput = z.infer<typeof debtForgiveSchema>;

export interface DebtPayment {
  transactionId: number;
  date: string;
  amount: number;
  /** null για «χαρίστηκε» */
  accountId: number | null;
  kind: 'payment' | 'forgiven';
}

export interface Debt {
  id: number;
  direction: DebtDirection;
  person: string;
  reason: string;
  date: string;
  amount: number;
  accountId: number;
  /** Όσα επιστράφηκαν ή χαρίστηκαν */
  settled: number;
  outstanding: number;
  payments: DebtPayment[];
}

export const monthQuerySchema = z.object({
  month: z.string().regex(MONTH_KEY_RE, 'Ο μήνας πρέπει να είναι της μορφής YYYY-MM'),
});

export const yearQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
});

export const idParamSchema = z.object({ id: z.coerce.number().int().positive() });
