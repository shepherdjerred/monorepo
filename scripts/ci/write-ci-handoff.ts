#!/usr/bin/env bun

/**
 * Publish one build-scoped handoff value, read from stdin.
 *
 * Replaces the `buildkite-agent meta-data set` and `artifact upload` pair.
 * Reading from stdin rather than taking the value as an argument keeps large
 * payloads (the version catalog, image digest maps) off the process
 * command line, and matches how the producing steps already pipe `jq` output.
 *
 * Usage: `jq -n '{}' | bun scripts/ci/write-ci-handoff.ts image-digests`
 */

import { writeJsonHandoff } from "../lib/ci/ci-handoff.ts";

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

/**
 * Parse stdin as JSON before publishing.
 *
 * The store holds JSON documents, and every consumer parses what it reads.
 * Validating here means a producer that emits malformed output fails in the
 * step that produced it, rather than in whichever downstream step reads it
 * first.
 */
export function parseHandoffPayload(text: string, key: string): unknown {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    throw new Error(`refusing to publish an empty CI handoff for ${key}`);
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    throw new Error(`CI handoff ${key} is not valid JSON`);
  }
}

async function main(): Promise<void> {
  const key = requiredArgument(Bun.argv, 2, "handoff key");
  const text = await Bun.stdin.text();
  await writeJsonHandoff(key, parseHandoffPayload(text, key));
}

if (import.meta.main) await main();
