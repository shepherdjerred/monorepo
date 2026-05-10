import { $ } from "bun";
import type { z } from "zod";

export type GhCommandResult<T> = {
  success: boolean;
  data?: T | undefined;
  error?: string | undefined;
};

// Captures the real gh stderr instead of letting Bun throw a generic
// ShellError. Without this, `.quiet()` swallowed messages like "could not
// determine which repository to use" and the caller only saw an opaque
// "command exited with code 1" that it then translated to "PR not found".
function runGh(args: string[], repo?: string) {
  const repoArgs = repo != null && repo.length > 0 ? ["--repo", repo] : [];
  const fullArgs = [...args, ...repoArgs];
  return $`gh ${fullArgs}`.nothrow().quiet();
}

export async function runGhCommand<T>(
  args: string[],
  schema: z.ZodType<T>,
  repo?: string,
): Promise<GhCommandResult<T>> {
  const result = await runGh(args, repo);
  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim();
    return {
      success: false,
      error:
        stderr.length > 0
          ? stderr
          : `gh exited with code ${String(result.exitCode)}`,
    };
  }

  const stdout = result.stdout.toString().trim();
  if (!stdout) {
    return { success: true, data: undefined };
  }

  let json: unknown;
  try {
    json = JSON.parse(stdout);
  } catch {
    // gh returned non-JSON output — callers that don't want typed data can
    // use runGhCommandRaw; swallow silently for schema callers.
    return { success: true, data: undefined };
  }

  // Schema validation failures used to be swallowed here, which turned a real
  // bug ("reviewDecision" came back as "" and the enum rejected it) into a
  // misleading "PR not found" at the callsite. Surface them instead.
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return {
      success: false,
      error: `gh output failed schema validation: ${parsed.error.message}`,
    };
  }
  return { success: true, data: parsed.data };
}

export async function runGhCommandRaw(
  args: string[],
  repo?: string,
): Promise<GhCommandResult<string>> {
  const result = await runGh(args, repo);
  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim();
    return {
      success: false,
      error:
        stderr.length > 0
          ? stderr
          : `gh exited with code ${String(result.exitCode)}`,
    };
  }
  return { success: true, data: result.stdout.toString() };
}
