import { Check } from 'lucide-react';
import { CATEGORY_COLORS, CATEGORY_ICONS, type Category, type CategoryColor, type CategoryIcon } from '@budget/shared';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { CATEGORY_COLOR, CATEGORY_ICON } from '@/lib/category-style';
import { cn } from '@/lib/utils';

type Style = Pick<Category, 'icon' | 'color'>;

/** Εικονίδιο κατηγορίας σε χρωματιστό κύκλο. */
export function CategoryBadge({ icon, color, className }: Style & { className?: string }) {
  const Icon = CATEGORY_ICON[icon] ?? CATEGORY_ICON.tag;
  return (
    <span className={cn('grid size-9 shrink-0 place-items-center rounded-full', CATEGORY_COLOR[color]?.soft, className)}>
      <Icon className="size-4" />
    </span>
  );
}

/** Το badge ως κουμπί που ανοίγει επιλογή εικονιδίου και χρώματος. */
export function CategoryStylePicker({
  value,
  onChange,
  disabled,
}: {
  value: Style;
  onChange: (style: { icon: CategoryIcon; color: CategoryColor }) => void;
  disabled?: boolean;
}) {
  return (
    <Popover>
      <PopoverTrigger
        disabled={disabled}
        title="Εικονίδιο και χρώμα"
        className="rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <CategoryBadge {...value} className="transition-transform hover:scale-110" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[296px] space-y-4">
        <div>
          <div className="mb-2 text-xs font-medium text-muted-foreground">Χρώμα</div>
          <div className="grid grid-cols-6 gap-2">
            {CATEGORY_COLORS.map(color => (
              <button
                key={color}
                type="button"
                title={color}
                onClick={() => onChange({ icon: value.icon, color })}
                className={cn(
                  'grid size-8 place-items-center rounded-full text-white transition-transform hover:scale-110',
                  CATEGORY_COLOR[color].solid,
                  value.color === color && 'ring-2 ring-foreground ring-offset-2 ring-offset-popover',
                )}
              >
                {value.color === color && <Check className="size-4" />}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-2 text-xs font-medium text-muted-foreground">Εικονίδιο</div>
          <div className="grid grid-cols-7 gap-1">
            {CATEGORY_ICONS.map(icon => {
              const Icon = CATEGORY_ICON[icon];
              const selected = value.icon === icon;
              return (
                <button
                  key={icon}
                  type="button"
                  title={icon}
                  onClick={() => onChange({ icon, color: value.color })}
                  className={cn(
                    'grid size-9 place-items-center rounded-full transition-colors',
                    selected ? CATEGORY_COLOR[value.color].soft : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >
                  <Icon className="size-4" />
                </button>
              );
            })}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
