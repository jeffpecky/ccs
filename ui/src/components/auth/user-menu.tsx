/**
 * User Menu - Header component showing username and logout button
 * Only renders when auth is enabled and user is authenticated.
 */

import { useAuth } from '@/contexts/auth-context';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { User, LogOut } from 'lucide-react';

export function UserMenu() {
  const { authRequired, isAuthenticated, username, logout } = useAuth();

  // Only show when auth is enabled and user is logged in
  if (!authRequired || !isAuthenticated) {
    return null;
  }

  const handleLogout = async () => {
    await logout();
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2">
          <User className="h-4 w-4" />
          <span className="hidden sm:inline">{username}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={handleLogout} className="gap-2 text-destructive">
          <LogOut className="h-4 w-4" />
          {/* TODO i18n: missing key for "Sign Out" */}Sign Out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
