import { z } from 'zod';
import { ISO_DATE_RE, MONTH_KEY_RE } from './month.ts';

// ---------- Λογαριασμοί ----------

export const ACCOUNT_TYPES = ['bank', 'savings', 'cash', 'broker', 'loan'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  bank: 'Τράπεζα',
  savings: 'Αποταμίευση',
  cash: 'Μετρητά',
  broker: 'Broker',
  loan: 'Δάνειο',
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
}

export const monthQuerySchema = z.object({
  month: z.string().regex(MONTH_KEY_RE, 'Ο μήνας πρέπει να είναι της μορφής YYYY-MM'),
});

export const yearQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
});

export const idParamSchema = z.object({ id: z.coerce.number().int().positive() });
