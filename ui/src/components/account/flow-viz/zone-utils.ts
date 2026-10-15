/**
 * Zone distribution utilities for account cards
 */

import type { AccountData, AccountZones } from './types';

/**
 * Split accounts into zones based on count (top/left/right/bottom)
 */
export function splitAccountsIntoZones(accounts: AccountData[]): AccountZones {
  const count = accounts.length;

  // 1-2 accounts: left only
  if (count <= 2) {
    return {
      leftAccounts: accounts,
      rightAccounts: [],
      topAccounts: [],
      bottomAccounts: [],
    };
  }

  // 3-4 accounts: left and right
  if (count <= 4) {
    const mid = Math.ceil(count / 2);
    return {
      leftAccounts: accounts.slice(0, mid),
      rightAccounts: accounts.slice(mid),
      topAccounts: [],
      bottomAccounts: [],
    };
  }

  // 5-8 accounts: left, right, top
  if (count <= 8) {
    const perZone = Math.ceil(count / 3);
    return {
      leftAccounts: accounts.slice(0, perZone),
      rightAccounts: accounts.slice(perZone, perZone * 2),
      topAccounts: accounts.slice(perZone * 2),
      bottomAccounts: [],
    };
  }

  // 9+ accounts: all four zones
  const perZone = Math.ceil(count / 4);
  return {
    leftAccounts: accounts.slice(0, perZone),
    rightAccounts: accounts.slice(perZone, perZone * 2),
    topAccounts: accounts.slice(perZone * 2, perZone * 3),
    bottomAccounts: accounts.slice(perZone * 3),
  };
}

/**
 * Get provider card size class based on account count
 */
export function getProviderSizeClass(accountCount: number): string {
  if (accountCount >= 9) return 'w-64'; // 4 zones - largest
  if (accountCount >= 5) return 'w-60'; // 3 zones
  if (accountCount >= 3) return 'w-56'; // 2 zones
  return 'w-52'; // 1 zone - default
}
