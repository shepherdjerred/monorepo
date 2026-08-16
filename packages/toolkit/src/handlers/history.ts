import { handleHistoryCommand as handle } from "#commands/history/history.ts";

export async function handleHistoryCommand(
  subcommand: string | undefined,
  args: string[],
): Promise<void> {
  await handle(subcommand, args);
}
