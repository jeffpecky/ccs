import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { queryClient } from '@/lib/query-client';
import '@/lib/i18n';
import { ThemeProvider } from '@/components/layout/theme-provider';
import { PrivacyProvider } from '@/contexts/privacy-context';
import { AuthProvider } from '@/contexts/auth-context';
import { RequireAuth } from '@/components/auth/require-auth';
import { Layout } from '@/components/layout/layout';
import { Loader2 } from 'lucide-react';

// Eager load: HomePage (initial route) + LoginPage (auth flow)
import { HomePage } from '@/pages';
import { LoginPage } from '@/pages/login';

// Lazy load: heavy pages with charts or complex dependencies
const AnalyticsPage = lazy(() =>
  import('@/pages/analytics').then((m) => ({ default: m.AnalyticsPage }))
);
const CliproxyPage = lazy(() =>
  import('@/pages/cliproxy').then((m) => ({ default: m.CliproxyPage }))
);
const CliproxyAiProvidersPage = lazy(() =>
  import('@/pages/cliproxy-ai-providers').then((m) => ({ default: m.CliproxyAiProvidersPage }))
);
const CliproxyControlPanelPage = lazy(() =>
  import('@/pages/cliproxy-control-panel').then((m) => ({ default: m.CliproxyControlPanelPage }))
);
const CopilotPage = lazy(() => import('@/pages/copilot').then((m) => ({ default: m.CopilotPage })));
const CursorPage = lazy(() => import('@/pages/cursor').then((m) => ({ default: m.CursorPage })));
const LogsPage = lazy(() => import('@/pages/logs').then((m) => ({ default: m.LogsPage })));
const SettingsPage = lazy(() =>
  import('@/pages/settings').then((m) => ({ default: m.SettingsPage }))
);
const HealthPage = lazy(() => import('@/pages/health').then((m) => ({ default: m.HealthPage })));

// Loading fallback for lazy components
function PageLoader() {
  return (
    <div className="flex h-64 items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme="system" storageKey="vite-ui-theme">
        <PrivacyProvider>
          <AuthProvider>
            <BrowserRouter>
              <Routes>
                {/* Public route: Login page */}
                <Route path="/login" element={<LoginPage />} />

                {/* Protected routes: wrapped with RequireAuth */}
                <Route element={<RequireAuth />}>
                  <Route element={<Layout />}>
                    <Route path="/" element={<HomePage />} />
                    <Route
                      path="/analytics"
                      element={
                        <Suspense fallback={<PageLoader />}>
                          <AnalyticsPage />
                        </Suspense>
                      }
                    />
                    <Route
                      path="/cliproxy"
                      element={
                        <Suspense fallback={<PageLoader />}>
                          <CliproxyPage />
                        </Suspense>
                      }
                    />
                    <Route
                      path="/cliproxy/ai-providers"
                      element={
                        <Suspense fallback={<PageLoader />}>
                          <CliproxyAiProvidersPage />
                        </Suspense>
                      }
                    />
                    <Route
                      path="/cliproxy/control-panel"
                      element={
                        <Suspense fallback={<PageLoader />}>
                          <CliproxyControlPanelPage />
                        </Suspense>
                      }
                    />
                    <Route
                      path="/copilot"
                      element={
                        <Suspense fallback={<PageLoader />}>
                          <CopilotPage />
                        </Suspense>
                      }
                    />
                    <Route
                      path="/legacy/cursor"
                      element={
                        <Suspense fallback={<PageLoader />}>
                          <CursorPage />
                        </Suspense>
                      }
                    />
                    <Route
                      path="/settings"
                      element={
                        <Suspense fallback={<PageLoader />}>
                          <SettingsPage />
                        </Suspense>
                      }
                    />
                    <Route
                      path="/health"
                      element={
                        <Suspense fallback={<PageLoader />}>
                          <HealthPage />
                        </Suspense>
                      }
                    />
                    <Route
                      path="/logs"
                      element={
                        <Suspense fallback={<PageLoader />}>
                          <LogsPage />
                        </Suspense>
                      }
                    />
                  </Route>
                </Route>
              </Routes>
              <Toaster position="top-right" />
            </BrowserRouter>
          </AuthProvider>
        </PrivacyProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
