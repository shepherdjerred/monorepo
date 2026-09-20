#!/usr/bin/env bun

/**
 * Print one build-scoped handoff value to stdout.
 *
 * Replaces `ci/scripts/reporting/read-buildkite-handoff.ts`. Pipeline
 * steps use it the same way — `export FOO="$(bun scripts/ci/read-ci-handoff.ts
 * some-key)"` — but there is no pointer to resolve, so the whole artifact
 * download path is gone.
 */

import { readRequiredHandoff } from "../lib/ci/ci-handoff.ts";

export function requiredArgument(
  argumentsList: readonly string[],
  index: number,
  name: string,
): string {
  const value = argumentsList[index];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}

async function main(): Promise<void> {
  const key = requiredArgument(Bun.argv, 2, "handoff key");
  process.stdout.write(await readRequiredHandoff(key));
}

if (import.meta.main) await main();
