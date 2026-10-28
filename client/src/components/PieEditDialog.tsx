import { Plus, X } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { parseDecimal, type Pie } from '@budget/shared';
import { Field } from '@/components/Field';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useInstruments, useSavePie } from '@/lib/api';
import { cn } from '@/lib/utils';

interface SliceRow {
  instrumentId: string;
  percent: string;
}

/** Όνομα και σύνθεση του pie: μετοχές με ποσοστό-στόχο (σύνολο 100%). */
export function PieEditDialog({ pie, onClose }: { pie?: Pie; onClose: () => void }) {
  const { data: instruments = [] } = useInstruments();
  const save = useSavePie();
  const [name, setName] = useState('');
  const [rows, setRows] = useState<SliceRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!pie) return;
    setName(pie.name);
    setRows(pie.slices.map(s => ({ instrumentId: String(s.instrumentId), percent: String(s.targetPercent).replace('.', ',') })));
    setError(null);
  }, [pie]);

  const total = rows.reduce((sum, r) => sum + (parseDecimal(r.percent) ?? 0), 0);
  const totalOk = Math.abs(total - 100) < 0.01;
  const setRow = (i: number, patch: Partial<SliceRow>) => setRows(r => r.map((row, j) => (j === i ? { ...row, ...patch } : row)));
  const unused = instruments.filter(i => !rows.some(r => r.instrumentId === String(i.id)));

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!pie) return;
    const slices = rows.map(r => ({ instrumentId: Number(r.instrumentId), targetPercent: parseDecimal(r.percent) ?? 0 }));
    if (slices.some(s => !s.instrumentId || s.targetPercent <= 0)) return setError('Κάθε γραμμή θέλει μετοχή και ποσοστό');
    save.mutate({ id: pie.id, input: { name, accountId: pie.accountId, slices } }, { onSuccess: onClose });
  }

  return (
    <Dialog open={!!pie} onOpenChange={o => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Σύνθεση pie</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="grid gap-4">
          <Field label="Όνομα" htmlFor="pie-name">
            <Input id="pie-name" required value={name} onChange={e => setName(e.target.value)} />
          </Field>
          <div className="grid gap-2">
            {rows.map((row, i) => (
              <div key={i} className="flex items-center gap-2">
                <Select value={row.instrumentId} onValueChange={v => setRow(i, { instrumentId: v })}>
                  <SelectTrigger className="min-w-0 flex-1"><SelectValue placeholder="Μετοχή" /></SelectTrigger>
                  <SelectContent>
                    {instruments
                      .filter(inst => String(inst.id) === row.instrumentId || unused.includes(inst))
                      .map(inst => <SelectItem key={inst.id} value={String(inst.id)}>{inst.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <div className="relative w-24">
                  <Input
                    aria-label="Ποσοστό"
                    inputMode="decimal"
                    className="pr-7 text-right tabular-nums"
                    value={row.percent}
                    onChange={e => setRow(i, { percent: e.target.value })}
                  />
                  <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-muted-foreground">%</span>
                </div>
                <Button type="button" variant="ghost" size="icon-sm" title="Αφαίρεση" onClick={() => setRows(r => r.filter((_, j) => j !== i))}>
                  <X className="size-4" />
                </Button>
              </div>
            ))}
            <div className="flex items-center justify-between pt-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="rounded-full"
                disabled={unused.length === 0}
                onClick={() => setRows(r => [...r, { instrumentId: String(unused[0]?.id ?? ''), percent: '' }])}
              >
                <Plus className="size-4" /> Μετοχή
              </Button>
              <span className={cn('text-sm font-medium tabular-nums', totalOk ? 'text-muted-foreground' : 'text-negative')}>
                Σύνολο {total.toLocaleString('el-GR', { maximumFractionDigits: 2 })}%
              </span>
            </div>
          </div>
          {error && <p className="text-sm text-negative">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={save.isPending || !totalOk}>Αποθήκευση</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
