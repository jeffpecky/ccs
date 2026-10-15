/**
 * Provider Logo Component
 * Uses actual provider logos with fallback to styled letters
 */

import { cn } from '@/lib/utils';
import {
  getProviderFallbackVisual,
  getProviderLogoAsset,
  providerNeedsDarkLogoBackground,
  providerUsesSelfContainedLogo,
} from '@/lib/provider-config';

interface ProviderLogoProps {
  provider: string;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

/** Size configuration */
const SIZE_CONFIG = {
  sm: { container: 'w-6 h-6', icon: 'w-4 h-4', text: 'text-xs' },
  md: { container: 'w-8 h-8', icon: 'w-5 h-5', text: 'text-sm' },
  lg: { container: 'w-12 h-12', icon: 'w-8 h-8', text: 'text-lg' },
};

export function ProviderLogo({ provider, className, size = 'md' }: ProviderLogoProps) {
  const fallback = getProviderFallbackVisual(provider);
  const sizeConfig = SIZE_CONFIG[size];
  const imageSrc = getProviderLogoAsset(provider);
  const usesSelfContainedLogo = providerUsesSelfContainedLogo(provider);

  return (
    <div
      className={cn(
        'flex items-center justify-center rounded-md',
        imageSrc &&
          !usesSelfContainedLogo &&
          (providerNeedsDarkLogoBackground(provider) ? 'bg-gray-900 p-1' : 'bg-white p-1'),
        sizeConfig.container,
        className
      )}
    >
      {imageSrc ? (
        <img
          src={imageSrc}
          alt={`${provider} logo`}
          className={cn(
            usesSelfContainedLogo ? sizeConfig.container : sizeConfig.icon,
            'object-contain'
          )}
        />
      ) : (
        <span className={cn('font-semibold', fallback.textClass, sizeConfig.text)}>
          {fallback.letter}
        </span>
      )}
    </div>
  );
}

/** Inline variant for use in text */
export function ProviderLogoInline({
  provider,
  className,
}: {
  provider: string;
  className?: string;
}) {
  return <ProviderLogo provider={provider} size="sm" className={className} />;
}
