import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';

interface PeriodNavProps {
  title: string;
  /** Μικρό κείμενο πάνω από τον τίτλο (π.χ. «Μηνιαία εικόνα») */
  eyebrow: string;
  prev: { to: string; title: string };
  next: { to: string; title: string };
  /** Link επιστροφής στην τρέχουσα περίοδο, όταν βλέπουμε άλλη */
  current?: { to: string; label: string };
}

/** Τίτλος σελίδας με βελάκια για προηγούμενη / επόμενη περίοδο. */
export function PeriodNav({ title, eyebrow, prev, next, current }: PeriodNavProps) {
  return (
    <div className="flex items-center gap-1">
      <div className="mr-2">
        <div className="text-xs font-medium text-muted-foreground">{eyebrow}</div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
      </div>
      <Button variant="outline" size="icon-sm" className="rounded-full" asChild>
        <Link to={prev.to} title={prev.title}><ChevronLeft className="size-4" /></Link>
      </Button>
      <Button variant="outline" size="icon-sm" className="rounded-full" asChild>
        <Link to={next.to} title={next.title}><ChevronRight className="size-4" /></Link>
      </Button>
      {current && (
        <Button variant="link" size="sm" className="text-primary" asChild>
          <Link to={current.to}>{current.label}</Link>
        </Button>
      )}
    </div>
  );
}
