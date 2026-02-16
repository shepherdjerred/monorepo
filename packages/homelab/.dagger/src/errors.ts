// ExecError and GraphQLRequestError are exported from core.js but not from the main dagger index.ts
// We need to import them directly from the SDK's core module
import { Container, ReturnType } from "@dagger.io/dagger";
import { ExecError, GraphQLRequestError } from "../sdk/core.js";
import { z } from "zod";

/**
 * Result of executing a command that captures stdout, stderr, and exit code.
 */
export type ExecResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

// Zod schemas for error type checking
const ExecErrorSchema = z.instanceof(ExecError);
const GraphQLRequestErrorSchema = z.instanceof(GraphQLRequestError);
const ErrorSchema = z.instanceof(Error);

/**
 * Executes a command in a container and captures stdout, stderr, and exit code.
 * Unlike the default behavior, this does NOT throw on non-zero exit codes.
 * Instead, it returns the full output for the caller to handle.
 *
 * @param container The container to execute the command in
 * @param args The command and arguments to execute
 * @returns ExecResult with stdout, stderr, and exitCode
 */
export async function execWithOutput(container: Container, args: string[]): Promise<ExecResult> {
  // Escape args for shell execution and capture stdout/stderr/exitcode to files
  // This avoids calling .stdout() which triggers a Dagger SDK bug with Bun
  const escapedArgs = args.map((arg) => `'${arg.replace(/'/g, "'\\''")}'`).join(" ");
  const shellCmd = `${escapedArgs} > /tmp/stdout.txt 2> /tmp/stderr.txt; echo $? > /tmp/exitcode.txt`;

  const ctr = await container.withExec(["sh", "-c", shellCmd], { expect: ReturnType.Any }).sync();

  // Read results from files instead of using .stdout()/.stderr()
  const [stdout, stderr, exitCodeStr] = await Promise.all([
    ctr.file("/tmp/stdout.txt").contents(),
    ctr.file("/tmp/stderr.txt").contents(),
    ctr.file("/tmp/exitcode.txt").contents(),
  ]);

  return { stdout, stderr, exitCode: parseInt(exitCodeStr.trim(), 10) };
}

/**
 * Executes a command and returns stdout on success, or throws with stderr/stdout on failure.
 * This is a convenience wrapper around execWithOutput for the common case.
 *
 * @param container The container to execute the command in
 * @param args The command and arguments to execute
 * @returns stdout on success
 * @throws Error with stderr (or stdout) on non-zero exit code
 */
export async function execOrThrow(container: Container, args: string[]): Promise<string> {
  const result = await execWithOutput(container, args);

  if (result.exitCode !== 0) {
    // Combine both stdout and stderr for full context
    const parts: string[] = [];
    if (result.stdout.trim()) {
      parts.push(result.stdout.trim());
    }
    if (result.stderr.trim()) {
      parts.push(result.stderr.trim());
    }
    const output = parts.join("\n") || "No output";
    throw new Error(`Command failed (exit code ${String(result.exitCode)}):\n${output}`);
  }

  return result.stdout;
}

/**
 * Extracts a meaningful error message from a Dagger error.
 * For ExecError, returns the stderr (or stdout if stderr is empty).
 * For GraphQLRequestError, attempts to extract the underlying error details.
 * For other errors, returns the error message.
 */
export function formatDaggerError(error: unknown): string {
  // Handle ExecError - command execution failures with stdout/stderr
  const execErrorResult = ExecErrorSchema.safeParse(error);
  if (execErrorResult.success) {
    const execError = execErrorResult.data;
    // Prefer stderr for error output, fall back to stdout
    const output = execError.stderr.trim() || execError.stdout.trim() || "";
    const exitInfo = `Exit code: ${String(execError.exitCode)}`;
    const cmdInfo = execError.cmd.length > 0 ? `Command: ${execError.cmd.join(" ")}` : "";

    return [exitInfo, cmdInfo, output].filter(Boolean).join("\n");
  }

  // Handle GraphQLRequestError - errors from GraphQL API calls
  const gqlErrorResult = GraphQLRequestErrorSchema.safeParse(error);
  if (gqlErrorResult.success) {
    const gqlError = gqlErrorResult.data;
    // Try to extract useful info from the GraphQL response
    const GraphQLResponseSchema = z.object({
      errors: z.array(z.object({ message: z.string().optional() })).optional(),
    });
    const responseResult = GraphQLResponseSchema.safeParse(gqlError.response);
    if (responseResult.success && responseResult.data.errors && responseResult.data.errors.length > 0) {
      const messages = responseResult.data.errors.map((e) => e.message ?? "Unknown error");
      return messages.join("\n");
    }
    // Fall back to the error message
    return gqlError.message;
  }

  // Fallback for other error types
  const errorResult = ErrorSchema.safeParse(error);
  if (errorResult.success) {
    const err = errorResult.data;
    // Check if the error has a cause that might be more informative
    const causeResult = ErrorSchema.safeParse(err.cause);
    if (causeResult.success) {
      return `${err.message}\nCaused by: ${formatDaggerError(err.cause)}`;
    }
    return err.message;
  }

  return String(error);
}
