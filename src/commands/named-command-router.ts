export interface NamedCommandRoute {
  name: string;
  aliases?: readonly string[];
  handle(args: string[]): Promise<void> | void;
}

interface DispatchNamedCommandOptions {
  args: string[];
  routes: readonly NamedCommandRoute[];
  onUnknown(command: string): Promise<void> | void;
  onHelp?: () => Promise<void> | void;
  helpTokens?: readonly string[];
  allowEmptyHelp?: boolean;
}

const DEFAULT_HELP_TOKENS = ['help', '--help', '-h'] as const;

export function resolveNamedCommand(
  token: string | undefined,
  routes: readonly NamedCommandRoute[]
): NamedCommandRoute | undefined {
  if (!token) {
    return undefined;
  }

  return routes.find((route) => route.name === token || route.aliases?.includes(token));
}

export async function dispatchNamedCommand(options: DispatchNamedCommandOptions): Promise<boolean> {
  const { args, routes, onUnknown, onHelp, allowEmptyHelp = false } = options;
  const helpTokens = options.helpTokens || DEFAULT_HELP_TOKENS;
  const command = args[0];

  if (!command) {
    if (!allowEmptyHelp || !onHelp) {
      return false;
    }
    await onHelp();
    return true;
  }

  if (helpTokens.includes(command)) {
    if (!onHelp) {
      return false;
    }
    await onHelp();
    return true;
  }

  const route = resolveNamedCommand(command, routes);
  if (!route) {
    await onUnknown(command);
    return true;
  }

  await route.handle(args.slice(1));
  return true;
}
