import { Plus, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useAddInstrument, useInstruments, useInstrumentSearch } from '@/lib/api';
import { toast } from 'sonner';

/** Προσθήκη μετοχής/ETF με αναζήτηση στο Yahoo Finance. */
export function InstrumentDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const { data: results = [], isFetching, isError } = useInstrumentSearch(query);
  const { data: instruments = [] } = useInstruments();
  const add = useAddInstrument();

  useEffect(() => {
    if (open) setText('');
  }, [open]);

  // Αναζήτηση όταν σταματήσει η πληκτρολόγηση
  useEffect(() => {
    const timer = setTimeout(() => setQuery(text.trim()), 350);
    return () => clearTimeout(timer);
  }, [text]);

  const existing = new Set(instruments.map(i => i.ticker));
  const handleAdd = (ticker: string) =>
    add.mutate(ticker, {
      onSuccess: instrument => {
        toast.success(`Προστέθηκε: ${instrument.name}`);
        onClose();
      },
    });

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Νέα μετοχή ή ETF</DialogTitle>
          <DialogDescription>
            Γράψε όνομα ή σύμβολο. Για ευρωπαϊκά ETF προτίμησε το listing σε EUR (π.χ. <code>.AS</code>, <code>.DE</code>).
          </DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input autoFocus placeholder="π.χ. Apple ή VWCE" className="pl-9" value={text} onChange={e => setText(e.target.value)} />
        </div>
        <div className="-mx-2 max-h-80 min-h-24 overflow-y-auto">
          {query.length >= 2 && isFetching && <p className="px-2 py-3 text-sm text-muted-foreground">Αναζήτηση…</p>}
          {isError && <p className="px-2 py-3 text-sm text-negative">Η αναζήτηση απέτυχε. Δοκίμασε ξανά.</p>}
          {!isFetching && query.length >= 2 && results.length === 0 && !isError && (
            <p className="px-2 py-3 text-sm text-muted-foreground">Δεν βρέθηκε τίποτα.</p>
          )}
          <ul>
            {results.map(r => (
              <li key={r.ticker} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-muted/60">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{r.name}</div>
                  <div className="text-xs text-muted-foreground">{r.ticker} · {r.exchange} · {r.type === 'ETF' ? 'ETF' : 'Μετοχή'}</div>
                </div>
                {existing.has(r.ticker) ? (
                  <span className="text-xs text-muted-foreground">Υπάρχει</span>
                ) : (
                  <Button size="sm" variant="outline" className="rounded-full" disabled={add.isPending} onClick={() => handleAdd(r.ticker)}>
                    <Plus className="size-4" /> Προσθήκη
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      </DialogContent>
    </Dialog>
  );
}
