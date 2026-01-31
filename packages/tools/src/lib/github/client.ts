import { $ } from "bun";

export type GhCommandResult<T> = {
  success: boolean;
  data?: T | undefined;
  error?: string | undefined;
}

export async function runGhCommand<T>(
  args: string[],
  repo?: string
): Promise<GhCommandResult<T>> {
  const repoArgs = repo ? ["--repo", repo] : [];
  const fullArgs = [...args, ...repoArgs];

  try {
    const result = await $`gh ${fullArgs}`.quiet();
    const stdout = result.stdout.toString().trim();

    if (!stdout) {
      return { success: true, data: undefined };
    }

    try {
      const parsed = JSON.parse(stdout) as T;
      return { success: true, data: parsed };
    } catch {
      return { success: true, data: stdout as unknown as T };
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error occurred";
    return { success: false, error: message };
  }
}

export async function runGhCommandRaw(
  args: string[],
  repo?: string
): Promise<GhCommandResult<string>> {
  const repoArgs = repo ? ["--repo", repo] : [];
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
