import type { Account } from '@/lib/api-client';

export interface SharedGroupSummary {
  group: string;
  sharedCount: number;
  deeperCount: number;
  accountNames: string[];
}

export interface AuthAccountRow extends Account {
  sameGroupPeerCount: number;
  sameGroupDeeperPeerCount: number;
}

export interface AuthAccountContinuitySummary {
  accounts: AuthAccountRow[];
  sharedCount: number;
  sharedStandardCount: number;
  deeperSharedCount: number;
  isolatedCount: number;
  legacyContextCount: number;
  legacyContinuityCount: number;
  sharedAloneCount: number;
  sharedPeerAccountCount: number;
  deeperReadyAccountCount: number;
  sharedPeerGroups: string[];
  deeperReadyGroups: string[];
  sharedGroups: string[];
  groupSummaries: SharedGroupSummary[];
}

function sortGroups(groups: Iterable<string>): string[] {
  return Array.from(groups).sort((left, right) => left.localeCompare(right));
}

export function summarizeAuthAccountContinuity(accounts: Account[]): AuthAccountContinuitySummary {
  const groupMap = new Map<string, SharedGroupSummary>();

  for (const account of accounts) {
    if (account.context_mode !== 'shared') {
      continue;
    }

    const group = account.context_group || 'default';
    const summary = groupMap.get(group) ?? {
      group,
      sharedCount: 0,
      deeperCount: 0,
      accountNames: [],
    };
    summary.sharedCount += 1;
    summary.accountNames.push(account.name);
    if (account.continuity_mode === 'deeper') {
      summary.deeperCount += 1;
    }
    groupMap.set(group, summary);
  }

  const groupSummaries = Array.from(groupMap.values()).sort((left, right) =>
    left.group.localeCompare(right.group)
  );

  const derivedAccounts: AuthAccountRow[] = accounts.map((account) => {
    if (account.context_mode !== 'shared') {
      return {
        ...account,
        sameGroupPeerCount: 0,
        sameGroupDeeperPeerCount: 0,
      };
    }

    const group = account.context_group || 'default';
    const groupSummary = groupMap.get(group);
    const sameGroupPeerCount = Math.max((groupSummary?.sharedCount ?? 1) - 1, 0);
    const sameGroupDeeperPeerCount = Math.max(
      (groupSummary?.deeperCount ?? 0) - (account.continuity_mode === 'deeper' ? 1 : 0),
      0
    );

    return {
      ...account,
      sameGroupPeerCount,
      sameGroupDeeperPeerCount,
    };
  });

  const sharedCount = derivedAccounts.filter((account) => account.context_mode === 'shared').length;
  const deeperSharedCount = derivedAccounts.filter(
    (account) => account.context_mode === 'shared' && account.continuity_mode === 'deeper'
  ).length;
  const legacyContextCount = derivedAccounts.filter((account) => account.context_inferred).length;
  const legacyContinuityCount = derivedAccounts.filter(
    (account) =>
      account.context_mode === 'shared' &&
      account.continuity_mode !== 'deeper' &&
      account.continuity_inferred
  ).length;

  return {
    accounts: derivedAccounts,
    sharedCount,
    sharedStandardCount: Math.max(sharedCount - deeperSharedCount, 0),
    deeperSharedCount,
    isolatedCount: derivedAccounts.length - sharedCount,
    legacyContextCount,
    legacyContinuityCount,
    sharedAloneCount: derivedAccounts.filter(
      (account) => account.context_mode === 'shared' && account.sameGroupPeerCount === 0
    ).length,
    sharedPeerAccountCount: derivedAccounts.filter((account) => account.sameGroupPeerCount > 0)
      .length,
    deeperReadyAccountCount: derivedAccounts.filter(
      (account) => account.continuity_mode === 'deeper' && account.sameGroupDeeperPeerCount > 0
    ).length,
    sharedPeerGroups: sortGroups(
      groupSummaries.filter((group) => group.sharedCount >= 2).map((group) => group.group)
    ),
    deeperReadyGroups: sortGroups(
      groupSummaries.filter((group) => group.deeperCount >= 2).map((group) => group.group)
    ),
    sharedGroups: sortGroups(groupSummaries.map((group) => group.group)),
    groupSummaries,
  };
}
