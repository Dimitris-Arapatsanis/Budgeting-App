import { Check, Pencil, Trash2, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { CATEGORY_COLORS, type Category, type CategoryKind } from '@budget/shared';
import { CategoryBadge, CategoryStylePicker } from '@/components/CategoryBadge';
import { RecurringSection } from '@/components/Recurring';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useCategories, useDeleteCategory, useSaveCategory } from '@/lib/api';

const SECTIONS: Array<{ kind: CategoryKind; title: string }> = [
  { kind: 'income', title: 'Έσοδα' },
  { kind: 'expense', title: 'Έξοδα' },
];

export function CategoriesPage() {
  const { data: categories = [] } = useCategories();
  return (
    <div className="space-y-6">
      <div>
        <div className="text-xs font-medium text-muted-foreground">Για έσοδα, έξοδα και επαναλαμβανόμενες</div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Κατηγορίες</h1>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {SECTIONS.map(s => (
          <CategorySection key={s.kind} kind={s.kind} title={s.title} categories={categories.filter(c => c.kind === s.kind)} />
        ))}
      </div>
      <RecurringSection />
    </div>
  );
}

function CategorySection({ kind, title, categories }: { kind: CategoryKind; title: string; categories: Category[] }) {
  const save = useSaveCategory();
  const [name, setName] = useState('');

  function handleAdd(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    // Νέα κατηγορία: το πρώτο χρώμα που δεν χρησιμοποιείται ακόμα σε αυτό το είδος
    const color = CATEGORY_COLORS.find(c => !categories.some(cat => cat.color === c)) ?? 'slate';
    save.mutate({ input: { name, kind, icon: 'tag', color } }, { onSuccess: () => setName('') });
  }

  return (
    <Card>
      <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <ul className="-mx-2 divide-y">
          {categories.map(c => <CategoryRow key={c.id} category={c} />)}
        </ul>
        <form onSubmit={handleAdd} className="flex gap-2">
          <Input placeholder="Νέα κατηγορία" value={name} onChange={e => setName(e.target.value)} />
          <Button type="submit" variant="outline" disabled={save.isPending}>Προσθήκη</Button>
        </form>
      </CardContent>
    </Card>
  );
}

function CategoryRow({ category }: { category: Category }) {
  const save = useSaveCategory();
  const remove = useDeleteCategory();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(category.name);

  function handleRename(e: FormEvent) {
    e.preventDefault();
    if (name.trim() === category.name) return setEditing(false);
    save.mutate({ id: category.id, input: { ...category, name } }, { onSuccess: () => setEditing(false) });
  }

  if (editing) {
    return (
      <li className="px-2 py-2">
        <form onSubmit={handleRename} className="flex items-center gap-2">
          <CategoryBadge icon={category.icon} color={category.color} />
          <Input autoFocus value={name} onChange={e => setName(e.target.value)} className="h-8" />
          <Button type="submit" variant="ghost" size="icon" title="Αποθήκευση"><Check className="size-4" /></Button>
          <Button type="button" variant="ghost" size="icon" title="Ακύρωση" onClick={() => { setName(category.name); setEditing(false); }}>
            <X className="size-4" />
          </Button>
        </form>
      </li>
    );
  }

  return (
    <li className="flex items-center gap-1 px-2 py-2 text-sm">
      <CategoryStylePicker
        value={category}
        disabled={save.isPending}
        onChange={style => save.mutate({ id: category.id, input: { ...category, ...style } })}
      />
      <span className="ml-2 flex-1 font-medium">{category.name}</span>
      <Button variant="ghost" size="icon" title="Μετονομασία" onClick={() => setEditing(true)}><Pencil className="size-4" /></Button>
      <Button
        variant="ghost"
        size="icon"
        title="Διαγραφή"
        onClick={() => confirm(`Διαγραφή της κατηγορίας «${category.name}»;`) && remove.mutate(category.id)}
      >
        <Trash2 className="size-4" />
      </Button>
    </li>
  );
}
