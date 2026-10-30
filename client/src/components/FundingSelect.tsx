import { ChartLine } from 'lucide-react';
import { formatEur, isDebtAccount, type AccountWithBalance } from '@budget/shared';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ACCOUNT_ICON } from '@/lib/account-style';

/** Τιμή του select για «από τα μετρητά που έχει ήδη ο broker» (χωρίς μεταφορά). */
export const BROKER_CASH = 'broker';

/** Πού μπορούν να βρίσκονταν τα λεφτά μιας αγοράς: λογαριασμοί του χρήστη, όχι brokers ή χρωστούμενα. */
const fundingAccounts = (accounts: AccountWithBalance[]) =>
  accounts.filter(a => !a.archived && !isDebtAccount(a) && a.type !== 'broker');

/** Προεπιλογή: η κύρια τράπεζα (εκεί μπαίνει ο μισθός). */
export function defaultFunding(accounts: AccountWithBalance[]): string {
  const options = fundingAccounts(accounts);
  return String((options.find(a => a.type === 'bank') ?? options[0])?.id ?? BROKER_CASH);
}

/** Το `value` του select → `fundingAccountId` για το API. */
export const toFundingAccountId = (value: string) => (value === BROKER_CASH || !value ? null : Number(value));

/**
 * «Χρήματα από»: από ποιον λογαριασμό ήρθαν τα λεφτά της αγοράς. Η εφαρμογή καταχωρεί μόνη της τη μεταφορά
 * προς τον broker. Με «Υπόλοιπο broker» τα λεφτά βγαίνουν από όσα έχει ήδη εκεί.
 */
export function FundingSelect({
  accounts,
  broker,
  value,
  onChange,
  amount,
}: {
  accounts: AccountWithBalance[];
  broker?: AccountWithBalance;
  value: string;
  onChange: (value: string) => void;
  /** cents: για προειδοποίηση αν το υπόλοιπο του broker δεν φτάνει */
  amount?: number | null;
}) {
  const short = value === BROKER_CASH && broker && amount != null && amount > broker.balance;
  return (
    <div className="grid gap-1.5">
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-full"><SelectValue placeholder="Επίλεξε" /></SelectTrigger>
        <SelectContent>
          {fundingAccounts(accounts).map(a => {
            const Icon = ACCOUNT_ICON[a.type];
            return (
              <SelectItem key={a.id} value={String(a.id)}>
                <Icon className="text-muted-foreground" /> {a.name}
              </SelectItem>
            );
          })}
          {broker && (
            <SelectItem value={BROKER_CASH}>
              <ChartLine className="text-muted-foreground" /> Υπόλοιπο {broker.name}
              <span className="text-xs text-muted-foreground">{formatEur(broker.balance)}</span>
            </SelectItem>
          )}
        </SelectContent>
      </Select>
      {short && (
        <p className="text-xs text-warning">
          Το {broker.name} έχει {formatEur(broker.balance)}. Αν έστειλες λεφτά από τράπεζα, διάλεξε την τράπεζα.
        </p>
      )}
    </div>
  );
}
