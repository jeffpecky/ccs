import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { type VariantProps } from 'class-variance-authority';
import { type buttonVariants } from '@/components/ui/button-variants';

interface CopyButtonProps {
  value: string;
  className?: string;
  variant?: VariantProps<typeof buttonVariants>['variant'];
  size?: VariantProps<typeof buttonVariants>['size'];
  label?: string;
}

export function CopyButton({
  value,
  className,
  variant = 'outline',
  size = 'icon',
  label = 'Copy to clipboard',
}: CopyButtonProps) {
  const [hasCopied, setHasCopied] = useState(false);

  const onCopy = () => {
    navigator.clipboard.writeText(value);
    setHasCopied(true);
    setTimeout(() => setHasCopied(false), 2000);
  };

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size={size}
            variant={variant}
            className={cn('relative z-10 text-muted-foreground hover:text-foreground', className)}
            onClick={(e) => {
              e.stopPropagation();
              onCopy();
            }}
          >
            {hasCopied ? (
              <Check className="h-3.5 w-3.5 text-green-500" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
            <span className="sr-only">{label}</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{hasCopied ? 'Copied!' : label}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
