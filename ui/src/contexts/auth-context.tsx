/**
 * Auth Context - Dashboard authentication state management
 * Provides auth status and login/logout functions globally.
 */

/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useContext,
  useState,
  useEffect,
  useMemo,
  useCallback,
  type ReactNode,
} from 'react';
import {
  checkAuth,
  login as apiLogin,
  logout as apiLogout,
  type DashboardAccessMode,
} from '@/lib/auth-api';

interface AuthContextValue {
  /** Whether authentication is required for this dashboard */
  authRequired: boolean;
  /** Whether user is currently authenticated */
  isAuthenticated: boolean;
  /** Username of authenticated user */
  username: string | null;
  /** Whether auth check is in progress */
  loading: boolean;
  /** Whether dashboard auth is enabled on the host */
  authEnabled: boolean;
  /** Whether host credentials are fully configured */
  authConfigured: boolean;
  /** Whether the current request comes from localhost/loopback */
  isLocalAccess: boolean;
  /** Effective access mode for the current request */
  accessMode: DashboardAccessMode;
  /** Login with credentials */
  login: (username: string, password: string) => Promise<void>;
  /** Logout current session */
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authRequired, setAuthRequired] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [username, setUsername] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [authEnabled, setAuthEnabled] = useState(false);
  const [authConfigured, setAuthConfigured] = useState(false);
  const [isLocalAccess, setIsLocalAccess] = useState(false);
  const [accessMode, setAccessMode] = useState<DashboardAccessMode>('login');

  // Check auth status on mount
  useEffect(() => {
    checkAuth()
      .then((res) => {
        setAuthRequired(res.authRequired);
        setIsAuthenticated(res.authenticated);
        setUsername(res.username);
        setAuthEnabled(res.authEnabled);
        setAuthConfigured(res.authConfigured);
        setIsLocalAccess(res.isLocalAccess);
        setAccessMode(res.accessMode);
      })
      .catch(() => {
        // If auth check fails (network error, server down, CORS issue),
        // fail closed: require auth instead of granting access.
        // Prevents silently broken dashboard when server is unreachable.
        setAuthRequired(true);
        setIsAuthenticated(false);
        setAuthEnabled(true);
        setAuthConfigured(true);
        setIsLocalAccess(false);
        setAccessMode('login');
      })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (user: string, password: string) => {
    const res = await apiLogin(user, password);
    setIsAuthenticated(true);
    setUsername(res.username);
  }, []);

  const logout = useCallback(async () => {
    await apiLogout();
    setIsAuthenticated(false);
    setUsername(null);
  }, []);

  const value = useMemo(
    () => ({
      authRequired,
      isAuthenticated,
      username,
      loading,
      authEnabled,
      authConfigured,
      isLocalAccess,
      accessMode,
      login,
      logout,
    }),
    [
      authRequired,
      isAuthenticated,
      username,
      loading,
      authEnabled,
      authConfigured,
      isLocalAccess,
      accessMode,
      login,
      logout,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
