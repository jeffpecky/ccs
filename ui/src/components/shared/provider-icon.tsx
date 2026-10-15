/**
 * Provider Icon Component
 * Renders provider logos from /assets/providers/
 * Supports white background circle variant for dark themes
 */

import { cn } from '@/lib/utils';
import { getProviderLogoAsset, PROVIDER_COLORS } from '@/lib/provider-config';

interface ProviderIconProps {
  provider: string;
  className?: string;
  size?: number;
  /** White background circle variant for better visibility */
  withBackground?: boolean;
}

export function ProviderIcon({
  provider,
  className,
  size = 18,
  withBackground = false,
}: ProviderIconProps) {
  const normalized = provider.toLowerCase();
  const assetPath = getProviderLogoAsset(provider);
  const providerColor = PROVIDER_COLORS[normalized as keyof typeof PROVIDER_COLORS] || '#6b7280';

  // Icon size is smaller when inside background circle
  const iconSize = withBackground ? Math.floor(size * 0.65) : size;

  const iconElement = assetPath ? (
    <img
      src={assetPath}
      alt={`${provider} icon`}
      width={iconSize}
      height={iconSize}
      className="shrink-0 object-contain"
    />
  ) : (
    // Fallback: colored text letter
    <span
      className="font-bold"
      style={{
        color: providerColor,
        fontSize: iconSize * 0.6,
      }}
    >
      {provider.charAt(0).toUpperCase()}
    </span>
  );

  if (withBackground) {
    return (
      <div
        className={cn(
          'shrink-0 rounded-full bg-white border border-border flex items-center justify-center shadow-sm',
          className
        )}
        style={{ width: size, height: size }}
      >
        {iconElement}
      </div>
    );
  }

  // Without background - original behavior for logos, colored circle for fallback
  if (assetPath) {
    return (
      <img
        src={assetPath}
        alt={`${provider} icon`}
        width={size}
        height={size}
        className={cn('shrink-0 rounded-sm object-contain', className)}
      />
    );
  }

  const bgColor = providerColor;
  return (
    <div
      className={cn(
        'shrink-0 rounded-full flex items-center justify-center text-white font-bold',
        className
      )}
      style={{
        width: size,
        height: size,
        backgroundColor: bgColor,
        fontSize: size * 0.5,
      }}
    >
      {provider.charAt(0).toUpperCase()}
    </div>
  );
}
