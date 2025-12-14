/**
 * Error handling utilities for Dagger operations
 *
 * Provides helpers to capture and format error output from container executions,
 * avoiding the vague "GraphQL request error" messages that Dagger throws by default.
 */

import { Container, ReturnType } from "@dagger.io/dagger";

/**
 * Result of executing a command that captures stdout, stderr, and exit code.
 */
export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Executes a command in a container and captures stdout, stderr, and exit code.
 * Unlike the default behavior, this does NOT throw on non-zero exit codes.
 * Instead, it returns the full output for the caller to handle.
 *
 * @param container The container to execute the command in
 * @param args The command and arguments to execute
 * @returns ExecResult with stdout, stderr, and exitCode
 *
 * @example
 * ```ts
 * const result = await execWithOutput(container, ["npm", "test"]);
 * if (result.exitCode !== 0) {
 *   console.error("Tests failed:", result.stderr || result.stdout);
 * }
 * ```
 */
export async function execWithOutput(container: Container, args: string[]): Promise<ExecResult> {
  const ctr = await container.withExec(args, { expect: ReturnType.Any }).sync();

  const [stdout, stderr, exitCode] = await Promise.all([ctr.stdout(), ctr.stderr(), ctr.exitCode()]);

  return { stdout, stderr, exitCode };
}

/**
 * Executes a command and returns stdout on success, or throws with stderr/stdout on failure.
 * This is a convenience wrapper around execWithOutput for the common case.
 *
 * Use this for validation commands (lint, typecheck, tests) where you need
 * meaningful error output instead of vague GraphQL errors.
 *
 * @param container The container to execute the command in
 * @param args The command and arguments to execute
 * @returns stdout on success
 * @throws Error with combined stdout/stderr on non-zero exit code
 *
 * @example
 * ```ts
 * // In a CI step - will throw with actual lint errors on failure
 * const output = await execOrThrow(container, ["bun", "run", "lint"]);
 * ```
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
    throw new Error(`Command failed (exit code ${result.exitCode}):\n${output}`);
  }

  return result.stdout;
}

/**
 * Extracts a meaningful error message from a Dagger error.
 *
 * Handles various error types:
 * - Standard Error objects
 * - Errors with cause chains
 * - Unknown error types
 *
 * @param error The error to format
 * @returns A formatted error message string
 *
 * @example
 * ```ts
 * try {
 *   await someOperation();
 * } catch (e) {
 *   console.error("Operation failed:", formatDaggerError(e));
 * }
 * ```
 */
export function formatDaggerError(error: unknown): string {
  // Handle standard Error objects
  if (error instanceof Error) {
    // Check if the error has a cause that might be more informative
    if (error.cause instanceof Error) {
      return `${error.message}\nCaused by: ${formatDaggerError(error.cause)}`;
    }
    return error.message;
  }

  return String(error);
}
