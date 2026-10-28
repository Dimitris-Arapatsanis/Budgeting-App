import { formatEur, formatEurSigned } from '@budget/shared';
import { cn } from '@/lib/utils';

interface AmountProps {
  cents: number;
  /** Εμφάνιση με πρόσημο (+/−) */
  signed?: boolean;
  /** Πράσινο για θετικό, κόκκινο για αρνητικό */
  colored?: boolean;
  className?: string;
}

export function Amount({ cents, signed, colored, className }: AmountProps) {
  return (
    <span
      className={cn(
        'whitespace-nowrap tabular-nums',
        colored && cents > 0 && 'text-positive',
        colored && cents < 0 && 'text-negative',
        className,
      )}
    >
      {signed ? formatEurSigned(cents) : formatEur(cents)}
    </span>
  );
}
