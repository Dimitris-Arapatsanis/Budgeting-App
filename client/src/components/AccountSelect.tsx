import type { AccountWithBalance } from '@budget/shared';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ACCOUNT_ICON } from '@/lib/account-style';

/** Επιλογή λογαριασμού με εικονίδιο ανά τύπο. Το `value` είναι το id ως string. */
export function AccountSelect({ accounts, value, onChange }: { accounts: AccountWithBalance[]; value: string; onChange: (v: string) => void }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-full"><SelectValue placeholder="Επίλεξε" /></SelectTrigger>
      <SelectContent>
        {accounts.map(a => {
          const Icon = ACCOUNT_ICON[a.type];
          return (
            <SelectItem key={a.id} value={String(a.id)}>
              <Icon className="text-muted-foreground" /> {a.name}
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}
