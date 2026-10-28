import type { ComponentProps } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/** Input ποσού ως κείμενο. Το parsing γίνεται με `parseAmount` από τον γονέα. */
export function AmountInput({ className, ...props }: Omit<ComponentProps<typeof Input>, 'type'>) {
  return (
    <div className="relative">
      <Input
        type="text"
        inputMode="decimal"
        autoComplete="off"
        placeholder="0,00"
        className={cn('pr-8 text-right tabular-nums', className)}
        {...props}
      />
      <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-muted-foreground">€</span>
    </div>
  );
}
