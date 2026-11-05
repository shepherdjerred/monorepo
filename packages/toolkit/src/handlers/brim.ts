export async function handleBrimCommand(args: string[]): Promise<void> {
  if (args[0] === "sync") {
    const { handleSyncCommand } = await import("#commands/brim/sync.ts");
    process.exitCode = await handleSyncCommand(args.slice(1), ["brim"]);
    return;
  }
  const { handleBrimCommand: handle } = await import("#commands/brim/brim.ts");
  await handle(args);
}
