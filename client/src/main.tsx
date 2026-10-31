import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router';
import { Toaster } from '@/components/ui/sonner';
import { AuthGate } from '@/components/AuthGate';
import { Layout } from '@/components/Layout';
import { AccountsPage } from '@/pages/AccountsPage';
import { CategoriesPage } from '@/pages/CategoriesPage';
import { InvestmentsPage } from '@/pages/InvestmentsPage';
import { MonthPage } from '@/pages/MonthPage';
import { SetupPage } from '@/pages/SetupPage';
import { YearPage } from '@/pages/YearPage';
import { ThemeProvider } from '@/lib/theme';
import { currentMonth } from '@budget/shared';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } },
});

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { index: true, element: <Navigate to={`/month/${currentMonth()}`} replace /> },
      { path: 'month', element: <Navigate to={`/month/${currentMonth()}`} replace /> },
      { path: 'month/:month', element: <MonthPage /> },
      { path: 'year', element: <Navigate to={`/year/${new Date().getFullYear()}`} replace /> },
      { path: 'year/:year', element: <YearPage /> },
      { path: 'investments', element: <InvestmentsPage /> },
      { path: 'accounts', element: <AccountsPage /> },
      { path: 'categories', element: <CategoriesPage /> },
      { path: 'setup', element: <SetupPage /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <AuthGate>
          <RouterProvider router={router} />
        </AuthGate>
        {/* Στο κινητό πάνω από την κάτω μπάρα */}
        <Toaster position="bottom-center" mobileOffset={{ bottom: 'calc(76px + env(safe-area-inset-bottom))' }} />
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
);
