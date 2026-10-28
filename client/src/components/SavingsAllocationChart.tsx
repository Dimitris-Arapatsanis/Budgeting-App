import { formatEur, type MonthSummary } from '@budget/shared';
import { DonutChart, type DonutRow, type DonutSlice } from '@/components/DonutChart';
import { useAccounts } from '@/lib/api';

/** Κύκλος «Πού πήγε η αποταμίευση»: brokers ξεχωριστά, μετρητά (τράπεζες) μαζί. */
export function SavingsAllocationChart({ summary }: { summary: MonthSummary }) {
  const { data: accounts = [] } = useAccounts();
  const accountName = (id: number) => accounts.find(a => a.id === id)?.name ?? '—';
  const { allocation } = summary;

  if (summary.savings < 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        Δεν υπήρξε αποταμίευση. {formatEur(-summary.savings)} βγήκαν από τα μαζεμένα.
      </p>
    );
  }

  const parts: DonutSlice[] = [
    ...allocation.accounts.map(a => ({ name: accountName(a.accountId), value: a.amount })),
    {
      name: 'Μετρητά',
      value: allocation.cash,
      details: allocation.cashByAccount.map(a => ({ name: accountName(a.accountId), value: a.amount })),
    },
  ];
  const slices = parts.filter(p => p.value > 0);
  // Αρνητικά: π.χ. επένδυσες περισσότερα από όσα αποταμίευσες, άρα μειώθηκαν τα μετρητά
  const extraRows: DonutRow[] = parts
    .filter(p => p.value < 0)
    .map(p => ({ name: p.name === 'Μετρητά' ? 'Μετρητά (από τα μαζεμένα)' : p.name, value: p.value }));

  return (
    <DonutChart
      centerLabel="Αποταμίευση"
      centerValue={summary.savings}
      centerSigned
      data={slices}
      extraRows={extraRows}
      emptyText="Καμία αποταμίευση ακόμα"
    />
  );
}
