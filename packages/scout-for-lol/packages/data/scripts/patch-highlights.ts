// Generate player-facing patch highlights for the "What's New" entry by asking
// Claude to read the real Riot patch notes and summarize them.
//
// The deterministic code (riot-patch.ts + update-changelog.ts) still owns the
// patch NUMBER, the notes LINK, the date, and the gating — Claude only writes
// the highlight bullets, so it can't get the load-bearing facts wrong. Prompt
// building and output parsing are split out so they're unit-testable; the
// `claude -p` spawn is the only impure part. Callers treat a failure as
// non-fatal (fall back to the plain data-refresh line).

import { z } from "zod";
import type { RiotPatch } from "./riot-patch.ts";

// Cheap model — this is short summarization of one page.
const MODEL = "claude-haiku-4-5";
const MAX_TURNS = "6";
const TIMEOUT_MS = 120_000;

// Range mirrors the prompt's "2 to 4 highlights" instruction: a 1-item or
// 5-item response fails validation so the caller falls back to the plain
// data-refresh line rather than shipping an off-spec entry to an auto-merged PR.
const HighlightsSchema = z.array(z.string().min(1).max(200)).min(2).max(4);

// `claude -p --output-format json` wraps the final assistant text in `.result`.
const ClaudeResultSchema = z.object({ result: z.string() });

export function buildHighlightsPrompt(patch: RiotPatch): string {
  return [
    'You write changelog highlights for "Scout for League of Legends", a Discord',
    "bot and stats tool (post-match reports, pre-match loading screens, ranked",
    "tracking).",
    "",
    `Use the WebFetch tool to read the official League of Legends patch ${patch.patch}`,
    `notes: ${patch.url}`,
    "",
    "Then write 2 to 4 short, player-facing highlights a Scout user would care",
    "about — for example a new champion, a new or returning game mode, notable new",
    "or reworked items/systems, or major champion balance shifts.",
    "",
    "Rules:",
    "- One sentence each, plain text (no markdown, no links, no trailing period",
    "  required).",
    "- Strictly factual: only mention things actually in the notes. Never invent.",
    "- Do NOT mention Scout itself or data updates — only what changed in the game.",
    "",
    "Output ONLY a JSON array of strings and nothing else. Example:",
    '["New champion Aimee arrives mid-lane", "Arena adds new prismatic items"]',
  ].join("\n");
}

function extractJsonArray(text: string): unknown {
  const trimmed = text.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)\s*```/.exec(trimmed);
  const candidate = (fence?.[1] ?? trimmed).trim();
  try {
    return JSON.parse(candidate);
  } catch {
    const arrayMatch = /\[[\s\S]*\]/.exec(candidate);
    if (arrayMatch !== null) {
      return JSON.parse(arrayMatch[0]);
    }
    throw new Error(
      `no JSON array found in Claude output: ${candidate.slice(0, 160)}`,
    );
  }
}

/** Parse `claude -p --output-format json` stdout into validated highlights. */
export function parseHighlights(stdout: string): string[] {
  let wrapper: unknown;
  try {
    wrapper = JSON.parse(stdout);
  } catch {
    throw new Error("Claude highlights: stdout was not JSON");
  }
  const parsed = ClaudeResultSchema.safeParse(wrapper);
  if (!parsed.success) {
    throw new Error("Claude highlights: response is missing a `result` field");
  }
  return HighlightsSchema.parse(extractJsonArray(parsed.data.result));
}

/**
 * Ask Claude to summarize the patch notes into 2-4 highlights. Throws on any
 * failure (claude missing, non-zero exit, unparseable output) so the caller can
 * fall back to the plain data-refresh line.
 */
export async function generatePatchHighlights(
  patch: RiotPatch,
): Promise<string[]> {
  const proc = Bun.spawn(
    [
      "claude",
      "-p",
      buildHighlightsPrompt(patch),
      "--output-format",
      "json",
      "--allowed-tools",
      "WebFetch",
      "--dangerously-skip-permissions",
      "--max-turns",
      MAX_TURNS,
      "--model",
      MODEL,
    ],
    { stdout: "pipe", stderr: "pipe", timeout: TIMEOUT_MS },
  );
  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(
      `claude exited ${String(exitCode)}: ${stderr.slice(0, 300)}`,
    );
  }
  return parseHighlights(stdout);
}
