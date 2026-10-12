import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './index.css';
import { useMe } from './lib/queries.ts';
import { Alert, Spinner } from './components/ui.tsx';
import { AppShell } from './components/AppShell.tsx';
import { ForgotPasswordPage, LoginPage, RegisterPage, ResetPasswordPage, VerifiedPage } from './pages/auth/AuthPages.tsx';
import { OnboardingPage } from './pages/onboarding/OnboardingPage.tsx';
import { ArticlesTab, EventsTab, TrendingTab } from './pages/tabs/ContentTabs.tsx';
import { ProfileTab } from './pages/tabs/ProfileTab.tsx';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

/** Wymaga sesji i ukończonego onboardingu. */
function RequireApp({ children }: { children: ReactNode }) {
  const me = useMe();
  if (me.isLoading) return <Spinner />;
  if (me.error) return <div className="p-6"><Alert tone="error">Nie można połączyć się z serwerem. Spróbuj ponownie za chwilę.</Alert></div>;
  if (!me.data) return <Navigate to="/login" replace />;
  if (!me.data.profile.onboardingCompleted) return <Navigate to="/onboarding" replace />;
  return children;
}

/** Strony logowania/rejestracji tylko dla niezalogowanych. */
function GuestOnly({ children }: { children: ReactNode }) {
  const me = useMe();
  if (me.isLoading) return <Spinner />;
  if (me.data) return <Navigate to={me.data.profile.onboardingCompleted ? '/articles' : '/onboarding'} replace />;
  return children;
}

function RouteError() {
  return (
    <div className="mx-auto max-w-md p-6">
      <Alert tone="error">
        Coś poszło nie tak przy wyświetlaniu tej strony.{' '}
        <button type="button" className="font-semibold underline" onClick={() => window.location.reload()}>
          Odśwież
        </button>
      </Alert>
    </div>
  );
}

const router = createBrowserRouter([
  { path: '/login', element: <GuestOnly><LoginPage /></GuestOnly>, errorElement: <RouteError /> },
  { path: '/register', element: <GuestOnly><RegisterPage /></GuestOnly>, errorElement: <RouteError /> },
  { path: '/forgot-password', element: <ForgotPasswordPage />, errorElement: <RouteError /> },
  { path: '/reset-password', element: <ResetPasswordPage />, errorElement: <RouteError /> },
  { path: '/verified', element: <VerifiedPage />, errorElement: <RouteError /> },
  { path: '/onboarding', element: <OnboardingPage />, errorElement: <RouteError /> },
  {
    path: '/',
    errorElement: <RouteError />,
    element: (
      <RequireApp>
        <AppShell />
      </RequireApp>
    ),
    children: [
      { index: true, element: <Navigate to="/articles" replace /> },
      { path: 'articles', element: <ArticlesTab /> },
      { path: 'articles/yours', element: <ArticlesTab /> },
      { path: 'events', element: <EventsTab /> },
      { path: 'trending', element: <TrendingTab /> },
      { path: 'profile', element: <ProfileTab /> },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
