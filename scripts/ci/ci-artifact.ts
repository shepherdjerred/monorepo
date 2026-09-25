#!/usr/bin/env bun

/**
 * Publish or restore a build-scoped binary artifact.
 *
 * Replaces `buildkite-agent artifact upload` / `download` for the payloads
 * that are directory trees rather than JSON documents.
 *
 * Usage:
 *   bun scripts/ci/ci-artifact.ts put <key> <path>...
 *   bun scripts/ci/ci-artifact.ts get <key>
 */

import { getCiArtifact, putCiArtifact } from "../lib/ci/ci-artifact.ts";
import { requiredArgument } from "./read-ci-handoff.ts";

async function main(): Promise<void> {
  const command = requiredArgument(Bun.argv, 2, "artifact command");
  const key = requiredArgument(Bun.argv, 3, "artifact key");
  switch (command) {
    case "put":
      await putCiArtifact(key, Bun.argv.slice(4));
      return;
    case "get":
      await getCiArtifact(key);
      return;
    default:
      throw new Error(`unknown CI artifact command: ${command}`);
  }
}

if (import.meta.main) await main();
