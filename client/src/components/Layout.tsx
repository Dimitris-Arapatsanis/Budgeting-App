import { CalendarDays, CalendarRange, ChartPie, Landmark, Monitor, Moon, Sun, Tags, Wallet } from 'lucide-react';
import { NavLink, Outlet } from 'react-router';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';

const NAV = [
  { to: '/month', label: 'Μήνας', icon: CalendarDays },
  { to: '/year', label: 'Έτος', icon: CalendarRange },
  { to: '/investments', label: 'Επενδύσεις', icon: ChartPie },
  { to: '/accounts', label: 'Λογαριασμοί', icon: Landmark },
  { to: '/categories', label: 'Κατηγορίες', icon: Tags },
];

const THEMES = [
  { value: 'light', icon: Sun, label: 'Φωτεινό θέμα' },
  { value: 'dark', icon: Moon, label: 'Σκοτεινό θέμα' },
  { value: 'system', icon: Monitor, label: 'Θέμα συστήματος' },
] as const;

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const index = THEMES.findIndex(t => t.value === theme);
  const current = THEMES[index] ?? THEMES[2];
  const next = THEMES[(index + 1) % THEMES.length]!;
  const Icon = current.icon;
  return (
    <Button variant="ghost" size="icon" className="rounded-full" title={current.label} onClick={() => setTheme(next.value)}>
      <Icon className="size-4" />
    </Button>
  );
}

export function Layout() {
  return (
    <div className="min-h-svh">
      <header className="sticky top-0 z-10 bg-background/75 backdrop-blur-lg">
        <div className="mx-auto flex h-16 max-w-5xl items-center gap-2 px-4 sm:gap-6">
          <span className="flex items-center gap-2 font-bold tracking-tight">
            <span className="grid size-8 place-items-center rounded-xl bg-primary text-primary-foreground shadow-soft">
              <Wallet className="size-4" />
            </span>
            Budget
          </span>
          {/* Υπολογιστής: pill tabs πάνω. Κινητό: μπάρα κάτω. */}
          <nav className="hidden rounded-full bg-muted p-1 sm:flex">
            {NAV.map(item => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    'rounded-full px-3 py-1.5 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground md:px-4',
                    isActive && 'bg-card text-foreground shadow-soft dark:bg-accent',
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto">
            <ThemeToggle />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 pt-4 pb-28 sm:pb-12">
        <Outlet />
      </main>
      <nav className="fixed inset-x-0 bottom-0 z-10 border-t bg-background/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-lg sm:hidden">
        <div className="grid grid-cols-5">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  'flex flex-col items-center gap-1 pt-2 pb-2.5 text-[10.5px] font-medium text-muted-foreground transition-colors',
                  isActive && 'text-primary',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span className={cn('grid h-7 w-12 place-items-center rounded-full transition-colors', isActive && 'bg-primary/12')}>
                    <Icon className="size-[18px]" />
                  </span>
                  {label}
                </>
              )}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
