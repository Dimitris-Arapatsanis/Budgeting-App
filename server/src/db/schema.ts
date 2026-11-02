import { sql } from 'drizzle-orm';
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import {
  ALL_ACCOUNT_TYPES,
  CATEGORY_COLORS,
  CATEGORY_ICONS,
  CATEGORY_KINDS,
  DEBT_DIRECTIONS,
  RECURRING_FREQUENCIES,
  RECURRING_KINDS,
  TRADE_SIDES,
  TRANSACTION_TYPES,
} from '@budget/shared';

export const accounts = sqliteTable('accounts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  type: text('type', { enum: ALL_ACCOUNT_TYPES }).notNull(),
  initialBalance: integer('initial_balance').notNull().default(0),
  archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
});

export const categories = sqliteTable(
  'categories',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    kind: text('kind', { enum: CATEGORY_KINDS }).notNull(),
    icon: text('icon', { enum: CATEGORY_ICONS }).notNull().default('tag'),
    color: text('color', { enum: CATEGORY_COLORS }).notNull().default('slate'),
  },
  t => [uniqueIndex('categories_kind_name_unique').on(t.kind, t.name)],
);

/** Χρωστούμενα. Τα ποσά τους είναι συναλλαγές με `debtId` (βλ. `buildDebt`). */
export const debts = sqliteTable('debts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  direction: text('direction', { enum: DEBT_DIRECTIONS }).notNull(),
  person: text('person').notNull(),
  reason: text('reason').notNull().default(''),
  date: text('date').notNull(),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

/** Κανόνες επανάληψης (βλ. recurringInputSchema). Οι λήξεις τους υπολογίζονται, δεν αποθηκεύονται. */
export const recurring = sqliteTable('recurring', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  kind: text('kind', { enum: RECURRING_KINDS }).notNull(),
  description: text('description').notNull().default(''),
  amount: integer('amount').notNull(),
  accountId: integer('account_id').notNull().references(() => accounts.id),
  toAccountId: integer('to_account_id').references(() => accounts.id),
  categoryId: integer('category_id').references(() => categories.id),
  instrumentId: integer('instrument_id').references(() => instruments.id),
  pieId: integer('pie_id').references(() => pies.id),
  fundingAccountId: integer('funding_account_id').references(() => accounts.id),
  frequency: text('frequency', { enum: RECURRING_FREQUENCIES }).notNull(),
  day: integer('day').notNull(),
  month: integer('month'),
  startDate: text('start_date').notNull(),
  endDate: text('end_date'),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
});

/** Λήξεις που ο χρήστης προσπέρασε («όχι αυτόν τον μήνα») */
export const recurringSkips = sqliteTable(
  'recurring_skips',
  {
    recurringId: integer('recurring_id').notNull().references(() => recurring.id, { onDelete: 'cascade' }),
    dueDate: text('due_date').notNull(),
  },
  t => [primaryKey({ columns: [t.recurringId, t.dueDate] })],
);

export const transactions = sqliteTable(
  'transactions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    date: text('date').notNull(),
    type: text('type', { enum: TRANSACTION_TYPES }).notNull(),
    amount: integer('amount').notNull(),
    accountId: integer('account_id').notNull().references(() => accounts.id),
    toAccountId: integer('to_account_id').references(() => accounts.id),
    categoryId: integer('category_id').references(() => categories.id),
    description: text('description').notNull().default(''),
    debtId: integer('debt_id').references(() => debts.id, { onDelete: 'cascade' }),
    /** Κανόνας επανάληψης και λήξη του που καλύπτει αυτή η καταχώριση */
    recurringId: integer('recurring_id').references(() => recurring.id),
    recurringDue: text('recurring_due'),
    /** Χρέωση (fee): έξοδο που ανήκει σε αυτή τη συναλλαγή (μεταφορά ή έξοδο) και αλλάζει/σβήνεται μαζί της */
    feeForId: integer('fee_for_id'),
    createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  t => [index('transactions_date_idx').on(t.date)],
);

export const instruments = sqliteTable('instruments', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ticker: text('ticker').notNull().unique(),
  name: text('name').notNull(),
  currency: text('currency').notNull(),
});

export const pies = sqliteTable('pies', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  accountId: integer('account_id').notNull().references(() => accounts.id),
});

export const pieSlices = sqliteTable(
  'pie_slices',
  {
    pieId: integer('pie_id').notNull().references(() => pies.id, { onDelete: 'cascade' }),
    instrumentId: integer('instrument_id').notNull().references(() => instruments.id),
    targetPercent: real('target_percent').notNull(),
  },
  t => [primaryKey({ columns: [t.pieId, t.instrumentId] })],
);

export const trades = sqliteTable(
  'trades',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    date: text('date').notNull(),
    accountId: integer('account_id').notNull().references(() => accounts.id),
    instrumentId: integer('instrument_id').notNull().references(() => instruments.id),
    side: text('side', { enum: TRADE_SIDES }).notNull(),
    quantity: real('quantity').notNull(),
    amountEur: integer('amount_eur').notNull(),
    pieId: integer('pie_id').references(() => pies.id, { onDelete: 'set null' }),
    /** Η μεταφορά που χρηματοδότησε την αγορά (μία μεταφορά μπορεί να καλύπτει όλη μια αγορά στο pie) */
    fundingTransactionId: integer('funding_transaction_id').references(() => transactions.id),
    /** Κινήσεις που αποθηκεύτηκαν μαζί (μια αγορά στο pie) έχουν το ίδιο batchId: το id της πρώτης */
    batchId: integer('batch_id'),
    /** Χρέωση της μεταφοράς «Χρήματα από» για αυτή την αγορά (cents). Γίνεται έξοδο «Χρεώσεις» */
    fundingFee: integer('funding_fee').notNull().default(0),
    recurringId: integer('recurring_id').references(() => recurring.id),
    recurringDue: text('recurring_due'),
    createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  t => [index('trades_date_idx').on(t.date)],
);

/** Τιμές κλεισίματος (και η τελευταία γνωστή τιμή της ημέρας) στο νόμισμα της μετοχής. */
export const priceCache = sqliteTable(
  'price_cache',
  {
    instrumentId: integer('instrument_id').notNull().references(() => instruments.id, { onDelete: 'cascade' }),
    date: text('date').notNull(),
    close: real('close').notNull(),
    currency: text('currency').notNull(),
  },
  t => [primaryKey({ columns: [t.instrumentId, t.date] })],
);

/** Ισοτιμίες: `rate` = μονάδες νομίσματος ανά 1 EUR (pair π.χ. "EURUSD"). */
export const fxCache = sqliteTable(
  'fx_cache',
  {
    pair: text('pair').notNull(),
    date: text('date').notNull(),
    rate: real('rate').notNull(),
  },
  t => [primaryKey({ columns: [t.pair, t.date] })],
);

/** Ρυθμίσεις της εφαρμογής (κλειδί → τιμή), π.χ. ο κωδικός σύνδεσης (hash) */
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

/** Συνδεδεμένες συσκευές: αποθηκεύεται μόνο το hash του token του cookie */
export const sessions = sqliteTable('sessions', {
  tokenHash: text('token_hash').primaryKey(),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  expiresAt: text('expires_at').notNull(),
});
