import { Monitor, Moon, Sun, Wallet } from 'lucide-react';
import { NavLink, Outlet } from 'react-router';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';

const NAV = [
  { to: '/month', label: 'Μήνας' },
  { to: '/year', label: 'Έτος' },
  { to: '/accounts', label: 'Λογαριασμοί' },
  { to: '/categories', label: 'Κατηγορίες' },
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
          <span className="hidden items-center gap-2 font-bold tracking-tight sm:flex">
            <span className="grid size-8 place-items-center rounded-xl bg-primary text-primary-foreground shadow-soft">
              <Wallet className="size-4" />
            </span>
            Budget
          </span>
          <nav className="flex min-w-0 overflow-x-auto rounded-full bg-muted p-0.5 sm:p-1">
            {NAV.map(item => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    'rounded-full px-2 py-1.5 text-[13px] font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground sm:px-4 sm:text-sm',
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
      <main className="mx-auto max-w-5xl px-4 pt-4 pb-12">
        <Outlet />
      </main>
    </div>
  );
}
