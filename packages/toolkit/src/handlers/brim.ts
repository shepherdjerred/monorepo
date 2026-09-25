import { handleBrimCommand as handle } from "#commands/brim/brim.ts";

export async function handleBrimCommand(args: string[]): Promise<void> {
  await handle(args);
}
