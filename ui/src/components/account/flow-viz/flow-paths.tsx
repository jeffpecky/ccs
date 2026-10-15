/**
 * SVG Connection Paths Component
 */

import type { AccountData } from './types';
import { getConnectionColor } from './utils';

interface FlowPathsProps {
  paths: string[];
  accounts: AccountData[];
  maxRequests: number;
  hoveredAccount: number | null;
  pulsingAccounts: Set<string>;
}

export function FlowPaths({
  paths,
  accounts,
  maxRequests,
  hoveredAccount,
  pulsingAccounts,
}: FlowPathsProps) {
  return (
    <>
      <defs>
        <filter
          id="flow-glow"
          x="-20%"
          y="-20%"
          width="140%"
          height="140%"
          filterUnits="userSpaceOnUse"
        >
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
      </defs>
      {paths.map((d, i) => {
        const account = accounts[i];
        if (!account) return null;

        const total = account.successCount + account.failureCount;
        const strokeWidth = Math.max(2, (total / maxRequests) * 10);
        const isHovered = hoveredAccount === i;
        const isDimmed = hoveredAccount !== null && hoveredAccount !== i;
        const isPulsing = pulsingAccounts.has(account.id);
        const connectionColor = getConnectionColor(i);

        return (
          <g key={i}>
            <path
              d={d}
              fill="none"
              stroke={connectionColor}
              strokeWidth={strokeWidth}
              strokeOpacity={isHovered ? 0.8 : isDimmed ? 0.15 : 0.4}
              strokeLinecap="round"
              filter={isHovered ? 'url(#flow-glow)' : undefined}
              className="transition-all duration-300"
            />
            {isPulsing && (
              <>
                <path
                  d={d}
                  fill="none"
                  stroke={account.color}
                  strokeWidth={strokeWidth * 2}
                  strokeLinecap="round"
                  filter="url(#flow-glow)"
                  className="animate-request-pulse"
                />
                <circle
                  r={6}
                  fill={account.color}
                  filter="url(#flow-glow)"
                  style={{
                    offsetPath: `path('${d}')`,
                    offsetDistance: '0%',
                    animation: 'travel-dot 1.5s cubic-bezier(0.4, 0, 0.2, 1) forwards',
                  }}
                />
              </>
            )}
          </g>
        );
      })}
    </>
  );
}
