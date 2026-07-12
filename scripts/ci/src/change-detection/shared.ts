/**
 * Shared primitives for the change-detection modules: repo-root resolution,
 * error-message extraction, and the injectable exec/fetch signatures used by
 * the git and Buildkite helpers.
 */
import { execSync } from "node:child_process";

/** Repo root — needed because the pipeline generator may run from scripts/ci/. */
export const REPO_ROOT = execSync("git rev-parse --show-toplevel", {
  encoding: "utf8",
}).trim();

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export type ExecResult = { stdout: string; exitCode: number };
export type ExecFn = (cmd: string[]) => Promise<ExecResult>;
export type FetchFn = (
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
) => ReturnType<typeof fetch>;
