export async function tryHandleRootCommand(args: string[]): Promise<boolean> {
  if (args[0] !== 'bar') return false;

  const { handleBarCommand } = await import('./bar');
  await handleBarCommand(args.slice(1));
  return true;
}
