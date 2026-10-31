import { LockKeyhole, Wallet } from 'lucide-react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Field } from '@/components/Field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { UNAUTHORIZED_EVENT, useAuthStatus, useLogin, useSetupPassword } from '@/lib/api';

/**
 * Πριν από την εφαρμογή: ορισμός κωδικού (πρώτη φορά) ή σύνδεση. Αν ο server απαντήσει 401 σε οποιοδήποτε
 * αίτημα (π.χ. έληξε η συνεδρία), ξαναελέγχει και δείχνει τη σύνδεση.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const { data: status, isError, refetch } = useAuthStatus();
  const queryClient = useQueryClient();

  useEffect(() => {
    const onUnauthorized = () => queryClient.invalidateQueries({ queryKey: ['auth-status'] });
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, [queryClient]);

  if (isError) {
    return (
      <Screen title="Ο server δεν απαντάει" text="Βεβαιώσου ότι η εφαρμογή τρέχει στον υπολογιστή (και το Tailscale στο κινητό).">
        <Button className="w-full rounded-full" onClick={() => refetch()}>Δοκίμασε ξανά</Button>
      </Screen>
    );
  }
  if (!status) return null;
  if (!status.configured) return <PasswordForm mode="setup" />;
  if (!status.authenticated) return <PasswordForm mode="login" />;
  return <>{children}</>;
}

function Screen({ title, text, children }: { title: string; text: string; children: ReactNode }) {
  return (
    <div className="grid min-h-svh place-items-center bg-background px-4">
      <div className="surface w-full max-w-sm space-y-5 p-6">
        <div className="flex items-center gap-2 font-bold tracking-tight">
          <span className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground shadow-soft">
            <Wallet className="size-4" />
          </span>
          Budget
        </div>
        <div>
          <h1 className="text-xl font-bold tracking-tight">{title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{text}</p>
        </div>
        {children}
      </div>
    </div>
  );
}

function PasswordForm({ mode }: { mode: 'setup' | 'login' }) {
  const login = useLogin();
  const setup = useSetupPassword();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const pending = login.isPending || setup.isPending;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (mode === 'setup') {
      if (password.length < 6) return setError('Ο κωδικός θέλει τουλάχιστον 6 χαρακτήρες');
      if (password !== confirm) return setError('Οι δύο κωδικοί δεν ταιριάζουν');
      setup.mutate(password, { onError: err => setError(err.message) });
    } else {
      login.mutate(password, { onError: err => { setError(err.message); setPassword(''); } });
    }
  }

  return (
    <Screen
      title={mode === 'setup' ? 'Όρισε κωδικό' : 'Σύνδεση'}
      text={mode === 'setup'
        ? 'Τα οικονομικά σου θα ανοίγουν μόνο με αυτόν τον κωδικό. Κάθε συσκευή μένει συνδεδεμένη για 90 μέρες.'
        : 'Γράψε τον κωδικό της εφαρμογής.'}
    >
      <form onSubmit={handleSubmit} className="grid gap-4">
        {/* Για τους διαχειριστές κωδικών (ένας χρήστης, σταθερό όνομα) */}
        <input type="text" name="username" autoComplete="username" value="budget" readOnly hidden />
        <Field label="Κωδικός" htmlFor="auth-password">
          <Input id="auth-password" type="password" autoFocus autoComplete={mode === 'setup' ? 'new-password' : 'current-password'} value={password} onChange={e => setPassword(e.target.value)} />
        </Field>
        {mode === 'setup' && (
          <Field label="Ξανά ο κωδικός" htmlFor="auth-confirm">
            <Input id="auth-confirm" type="password" autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} />
          </Field>
        )}
        {error && <p className="text-sm text-negative">{error}</p>}
        <Button type="submit" className="w-full rounded-full" disabled={pending || !password}>
          <LockKeyhole className="size-4" /> {mode === 'setup' ? 'Αποθήκευση κωδικού' : 'Σύνδεση'}
        </Button>
      </form>
    </Screen>
  );
}
