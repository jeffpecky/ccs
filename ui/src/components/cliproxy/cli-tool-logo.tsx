/**
 * CLI Tool Logo Component
 * Per-tool images (from 9Router) — every tool has a direct image, no fallback
 */

import { cn } from '@/lib/utils';

// Direct CLI tool images for every tool (matching 9Router)
const CLI_TOOL_IMAGES: Record<string, string> = {
  'claude-code': '/assets/cli-tools/claude.png',
  'claude-cowork': '/assets/cli-tools/claude.png',
  codex: '/assets/cli-tools/codex.png',
  opencode: '/assets/cli-tools/opencode.png',
  'open-claw': '/assets/cli-tools/openclaw.png',
  'hermes-agent': '/assets/cli-tools/hermes.png',
  'factory-droid': '/assets/cli-tools/droid.png',
  cursor: '/assets/cli-tools/cursor.png',
  cline: '/assets/cli-tools/cline.png',
  'kilo-code': '/assets/cli-tools/kilocode.png',
  roo: '/assets/cli-tools/roo.png',
  continue: '/assets/cli-tools/continue.png',
  'amp-cli': '/assets/cli-tools/amp.png',
  'qwen-code': '/assets/cli-tools/qwen.png',
  'deepseek-tui': '/assets/cli-tools/deepseek-tui.png',
  jcode: '/assets/cli-tools/jcode.png',
  'grok-build': '/assets/cli-tools/grok-cli.png',
  'devin-cli': '/assets/cli-tools/devin-cli.png',
};

const SIZE_CONFIG = {
  sm: { container: 'w-6 h-6', icon: 'w-4 h-4' },
  md: { container: 'w-8 h-8', icon: 'w-5 h-5' },
  lg: { container: 'w-12 h-12', icon: 'w-8 h-8' },
};

interface CLIToolLogoProps {
  toolId: string;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

export function CLIToolLogo({ toolId, className, size = 'md' }: CLIToolLogoProps) {
  const imageSrc = CLI_TOOL_IMAGES[toolId] ?? CLI_TOOL_IMAGES['claude-code'];
  const sizeConfig = SIZE_CONFIG[size];

  return (
    <div
      className={cn(
        'flex items-center justify-center rounded-md bg-white p-1',
        sizeConfig.container,
        className
      )}
    >
      <img src={imageSrc} alt={`${toolId} logo`} className={cn(sizeConfig.icon, 'object-contain')} />
    </div>
  );
}
