const LAST_ROUTE_STORAGE_KEY = 'ccs-dashboard:last-route';

export function storeLastRoute(pathname: string, search = '', hash = ''): void {
  try {
    localStorage.setItem(LAST_ROUTE_STORAGE_KEY, `${pathname}${search}${hash}`);
  } catch {
    // Ignore storage failures (private mode, quota, etc.)
  }
}
