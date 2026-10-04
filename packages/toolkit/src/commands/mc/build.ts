import { runBuildCli } from "#lib/mc/build.ts";

/** `toolkit mc build …`: delegates to the mc-harness build CLI (from source). */
export async function mcBuildCommand(args: string[]): Promise<void> {
  process.exitCode = await runBuildCli(args);
}
