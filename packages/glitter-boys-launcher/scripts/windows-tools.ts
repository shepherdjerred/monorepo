import path from "node:path";
import { bunRunner } from "@shepherdjerred/native-release/runner";

/** Run a launcher build or release step, naming only the program on failure. */
export async function run(args: string[], cwd: string): Promise<void> {
  const result = await bunRunner(args, { cwd });
  if (result.exitCode !== 0)
    throw new Error(`${path.basename(args[0] ?? "Command")} failed`);
}
