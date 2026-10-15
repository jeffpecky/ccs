/**
 * Provider Selection Step
 */

import { ChevronRight } from 'lucide-react';
import type { ProviderStepProps } from '../types';

export function ProviderStep({ providers, onSelect }: ProviderStepProps) {
  return (
    <div className="grid gap-2">
      {providers.map((p) => (
        <button
          key={p.id}
          onClick={() => onSelect(p.id)}
          className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50 transition-colors text-left"
        >
          <div>
            <div className="font-medium">{p.name}</div>
            <div className="text-xs text-muted-foreground">{p.description}</div>
          </div>
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
        </button>
      ))}
    </div>
  );
}
