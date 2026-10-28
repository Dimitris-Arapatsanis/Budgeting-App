import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type StatTone = 'primary' | 'positive' | 'negative' | 'warning' | 'neutral';

const TONE: Record<StatTone, string> = {
  primary: 'bg-primary/12 text-primary',
  positive: 'bg-positive/12 text-positive',
  negative: 'bg-negative/12 text-negative',
  warning: 'bg-warning/15 text-warning',
  neutral: 'bg-muted text-muted-foreground',
};

interface StatCardProps {
  label: string;
  icon: LucideIcon;
  tone?: StatTone;
  children: ReactNode;
  sub?: ReactNode;
  className?: string;
}

/** Κάρτα με ένα βασικό νούμερο (KPI). */
export function StatCard({ label, icon: Icon, tone = 'neutral', children, sub, className }: StatCardProps) {
  return (
    <div className={cn('surface flex flex-col gap-3 p-4 sm:p-5', className)}>
      <div className="flex items-center gap-2">
        <span className={cn('grid size-8 shrink-0 place-items-center rounded-full', TONE[tone])}>
          <Icon className="size-4" />
        </span>
        <span className="truncate text-sm text-muted-foreground">{label}</span>
      </div>
      <div className="text-xl font-bold tracking-tight sm:text-2xl">{children}</div>
      {sub && <div className="-mt-2 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}
