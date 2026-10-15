/**
 * LivePulse - Enhanced live pulse indicator with multi-ring animation
 */

import { STATUS_COLORS } from '@/lib/utils';

export function LivePulse() {
  return (
    <div className="relative flex items-center justify-center w-5 h-5">
      {/* Outer ping ring */}
      <div
        className="absolute w-4 h-4 rounded-full animate-ping opacity-20"
        style={{ backgroundColor: STATUS_COLORS.success }}
      />
      {/* Middle pulse ring */}
      <div
        className="absolute w-3 h-3 rounded-full animate-pulse opacity-40"
        style={{ backgroundColor: STATUS_COLORS.success }}
      />
      {/* Inner solid dot */}
      <div
        className="relative w-2 h-2 rounded-full z-10"
        style={{ backgroundColor: STATUS_COLORS.success }}
      />
    </div>
  );
}
