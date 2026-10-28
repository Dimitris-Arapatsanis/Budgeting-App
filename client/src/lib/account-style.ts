import { Banknote, ChartLine, CreditCard, HandCoins, Handshake, Landmark, PiggyBank, type LucideIcon } from 'lucide-react';
import type { AccountType } from '@budget/shared';

export const ACCOUNT_ICON: Record<AccountType, LucideIcon> = {
  bank: Landmark,
  savings: PiggyBank,
  cash: Banknote,
  broker: ChartLine,
  loan: CreditCard,
  receivable: HandCoins,
  payable: Handshake,
};
