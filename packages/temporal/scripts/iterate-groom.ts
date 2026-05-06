#!/usr/bin/env bun
/**
 * Standalone runner for tweaking GROOM_PROMPT / GroomResult schema.
 *
 * Bypasses Temporal entirely — calls `claude -p` against a fresh worktree
 * with the same flags `doInvokeClaudeGroom` uses, then runs the same
 * parser/normaliser the activity does and prints the result.
 *
 * Usage:
 *   bun run groom:iterate-setup        # one-time worktree clone
 *   bun run groom:iterate              # run claude → parse → print
 *
 * The setup script creates `/tmp/groom-iterate` (a shallow clone on a
 * scratch branch). After each run, inspect what claude wrote with:
 *   cd /tmp/groom-iterate && git status -s
 * Reset between runs with:
 *   cd /tmp/groom-iterate && git checkout . && git clean -fd
 */
import { z } from "zod/v4";
import { GroomResult } from "#shared/docs-groom-types.ts";
import { GROOM_PROMPT } from "#shared/docs-groom-prompts.ts";
import { extractJsonObject, run } from "#activities/docs-groom-utils.ts";

const ClaudeCliResult = z.object({
  result: z.string().optional(),
});

async function main(): Promise<void> {
  const worktree = process.argv[2] ?? "/tmp/groom-iterate";

  const exists = await Bun.file(`${worktree}/.git`).exists();
  if (!exists) {
    console.error(
      `Worktree ${worktree} doesn't exist or isn't a git repo. Run \`bun run groom:iterate-setup\` first.`,
    );
    process.exit(1);
  }

  console.warn(`[iterate-groom] worktree: ${worktree}`);
  console.warn(
    "[iterate-groom] running claude -p against the worktree (real Anthropic API call)…",
  );

  const schemaJson = JSON.stringify(z.toJSONSchema(GroomResult));

  const startMs = Date.now();
  const result = await run(
    [
      "claude",
      "-p",
      GROOM_PROMPT,
      "--output-format",
      "json",
      "--json-schema",
      schemaJson,
      "--allowed-tools",
      "Read,Write,Edit,Glob,Grep",
      "--permission-mode",
      "acceptEdits",
    ],
    { cwd: worktree },
  );
  const elapsedMs = Date.now() - startMs;
  console.warn(`[iterate-groom] claude returned in ${String(elapsedMs)} ms`);

  // claude -p --output-format=json wraps the assistant text under .result
  const claudeOut = ClaudeCliResult.parse(JSON.parse(result.stdout));
  const resultText = claudeOut.result ?? "";

  console.warn("=== claude raw resultText (first 4 KB) ===");
  console.warn(resultText.slice(0, 4000));
  console.warn("\n=== parsed GroomResult ===");
  try {
    const cleaned = extractJsonObject(resultText);
    const parsed = GroomResult.parse(JSON.parse(cleaned));
    console.warn(JSON.stringify(parsed, null, 2));
  } catch (error: unknown) {
    console.error("\n!!! parse failed:");
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }

  console.warn(
    `\n[iterate-groom] inspect inline edits with: cd ${worktree} && git status -s`,
  );
  console.warn(
    `[iterate-groom] reset between runs with: cd ${worktree} && git checkout . && git clean -fd`,
  );
}

void (async (): Promise<void> => {
  try {
    await main();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`iterate-groom: ${message}`);
    process.exit(1);
  }
})();
