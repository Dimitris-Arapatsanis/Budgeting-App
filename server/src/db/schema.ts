import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { ACCOUNT_TYPES, CATEGORY_COLORS, CATEGORY_ICONS, CATEGORY_KINDS, TRANSACTION_TYPES } from '@budget/shared';

export const accounts = sqliteTable('accounts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  type: text('type', { enum: ACCOUNT_TYPES }).notNull(),
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
    createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  t => [index('transactions_date_idx').on(t.date)],
);
