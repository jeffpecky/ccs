/**
 * Auth API Client
 * Handles authentication-related API calls.
 */

const BASE_URL = '/api/auth';

export type DashboardAccessMode = 'open' | 'login' | 'setup';

export interface AuthCheckResponse {
  authRequired: boolean;
  authenticated: boolean;
  username: string | null;
  authEnabled: boolean;
  authConfigured: boolean;
  isLocalAccess: boolean;
  accessMode: DashboardAccessMode;
}

export interface AuthSetupResponse {
  enabled: boolean;
  configured: boolean;
  sessionTimeoutHours: number;
}

export interface LoginResponse {
  success: boolean;
  username: string;
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${url}`, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include', // Include cookies for session
    ...options,
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || res.statusText);
  }

  return res.json();
}

/** Check authentication status */
export function checkAuth(): Promise<AuthCheckResponse> {
  return request('/check');
}

/** Check auth setup status */
export function getAuthSetup(): Promise<AuthSetupResponse> {
  return request('/setup');
}

/** Login with username/password */
export function login(username: string, password: string): Promise<LoginResponse> {
  return request('/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
}

/** Logout current session */
export function logout(): Promise<{ success: boolean }> {
  return request('/logout', { method: 'POST' });
}
