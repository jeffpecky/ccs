import { useState } from 'react';
import { Eye, EyeOff, Lock } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

// `type` is intentionally omitted from the prop surface so callers cannot
// override the `password`/`text` toggle and accidentally render a credential
// in plaintext. The component is the sole authority on the input type.
interface MaskedInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: string;
  /**
   * Hide the "sensitive" pill on the label row. Defaults to false (pill shown).
   * Use only when the surrounding context already signals sensitivity.
   */
  hideSensitivePill?: boolean;
}

/**
 * MaskedInput - Sensitive text input per design-system.md §5g.
 *
 * Treatment: Lock glyph prefixing the label · "sensitive" accent pill on the
 * label row · <input type="password"> by default with a reveal/hide eye
 * toggle on the right edge · accent focus ring (the only place the default
 * focus ring is overridden).
 *
 * Consumers: API token / OAuth secret / WebSearch API key / env-block secret
 * fields across cliproxy / accounts / settings / profile editor.
 */
export function MaskedInput({
  label,
  hideSensitivePill = false,
  className,
  ...props
}: MaskedInputProps) {
  const [revealed, setRevealed] = useState(false);

  return (
    <div className="group/masked space-y-1.5">
      {label && (
        <div className="flex items-center justify-between gap-2">
          <label className="flex items-center gap-1.5 text-sm font-medium">
            <Lock aria-hidden className="size-3 text-accent/70" />
            {label}
          </label>
          {!hideSensitivePill && (
            <span className="rounded border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-accent">
              sensitive
            </span>
          )}
        </div>
      )}
      <div className="relative">
        <Input
          {...props}
          // `type` MUST come after the spread so it cannot be overridden by
          // a caller-supplied attribute. Belt-and-braces with the `Omit` on
          // MaskedInputProps so this is enforced at compile time too.
          type={revealed ? 'text' : 'password'}
          className={cn(
            'pr-9 font-mono transition-all',
            'focus-visible:ring-1 focus-visible:ring-accent/40 focus-visible:border-accent/50',
            className
          )}
        />
        <button
          type="button"
          onClick={() => setRevealed((v) => !v)}
          aria-label={revealed ? 'Hide value' : 'Reveal value'}
          aria-pressed={revealed}
          className="absolute right-1.5 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
        >
          {revealed ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
        </button>
      </div>
    </div>
  );
}
