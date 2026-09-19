#!/usr/bin/env bun

/**
 * Print a handoff value if it exists, and nothing if it does not.
 *
 * Successor to `buildkite-agent meta-data get <key> --default ""`. Reserved
 * for the handful of values whose absence is a real outcome -- scout's release
 * state, for instance, is only published when a release actually happened.
 * Every other consumer uses read-ci-handoff.ts, which fails loudly.
 */

import { readOptionalHandoff } from "../lib/ci/ci-handoff.ts";
import { requiredArgument } from "./read-ci-handoff.ts";

async function main(): Promise<void> {
  const key = requiredArgument(Bun.argv, 2, "handoff key");
  const value = await readOptionalHandoff(key);
  if (value !== undefined) process.stdout.write(value);
}

if (import.meta.main) await main();
