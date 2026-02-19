import { $ } from "bun";
import { z } from "zod";

export type GhCommandResult<T> = {
  success: boolean;
  data?: T | undefined;
  error?: string | undefined;
};

export async function runGhCommand<T>(
  args: string[],
  repo?: string,
): Promise<GhCommandResult<T>> {
  const repoArgs = repo != null && repo.length > 0 ? ["--repo", repo] : [];
  const fullArgs = [...args, ...repoArgs];

  try {
    const result = await $`gh ${fullArgs}`.quiet();
    const stdout = result.stdout.toString().trim();

    if (!stdout) {
      return { success: true, data: undefined };
    }

    try {
      const json: unknown = JSON.parse(stdout);
      const parsed = z.custom<T>().parse(json);
      return { success: true, data: parsed };
    } catch {
      // Non-JSON output: return raw string. Callers using runGhCommandRaw
      // should be used for raw string output instead.
      return { success: true, data: undefined };
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error occurred";
    return { success: false, error: message };
  }
}

export async function runGhCommandRaw(
  args: string[],
  repo?: string,
): Promise<GhCommandResult<string>> {
  const repoArgs = repo != null && repo.length > 0 ? ["--repo", repo] : [];
  const fullArgs = [...args, ...repoArgs];

  try {
    const result = await $`gh ${fullArgs}`.quiet();
    return { success: true, data: result.stdout.toString() };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error occurred";
    return { success: false, error: message };
  }
}
