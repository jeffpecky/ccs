/**
 * RequireAuth - Protected route wrapper component
 * Redirects to login page if auth is required but user is not authenticated.
 */

import { Navigate, useLocation, Outlet } from 'react-router-dom';
import { useAuth } from '@/contexts/auth-context';
import { Loader2 } from 'lucide-react';

export function RequireAuth() {
  const { authRequired, isAuthenticated, loading } = useAuth();
  const location = useLocation();

  // Show loading spinner while checking auth
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // If auth not required, allow access
  if (!authRequired) {
    return <Outlet />;
  }

  // If not authenticated, redirect to login
  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Authenticated, render children
  return <Outlet />;
}
