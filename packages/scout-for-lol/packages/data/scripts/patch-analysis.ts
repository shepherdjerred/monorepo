// Turn the real Riot patch notes into a structured, player-facing changeset by
// asking Claude to read the notes and emit categorized buff/nerf data plus a
// freeform overview. The deterministic code (riot-patch.ts) still owns the patch
// NUMBER, notes LINK, and date; Claude only writes the balance analysis, so it
// can't get the load-bearing facts wrong.
//
// Prompt building and output parsing are split out so they're unit-testable; the
// `claude -p` spawn is the only impure part. The `update-data-dragon` caller
// treats a failure as non-fatal (it still ships the asset PR, just without a
// refreshed changeset).

import { z } from "zod";
import type { RiotPatch } from "./riot-patch.ts";
import {
  PatchChangesetSchema,
  type PatchChangeset,
} from "#src/data-dragon/patch-notes.ts";
import { formatDateForChangelog } from "./update-changelog.ts";

// Structured extraction is a bigger reasoning task than the old one-line
// highlights, so use a stronger model than haiku. This runs at most weekly.
const MODEL = "claude-sonnet-4-6";
const MAX_TURNS = "8";
const TIMEOUT_MS = 240_000;

// `claude -p --output-format json` wraps the final assistant text in `.result`.
const ClaudeResultSchema = z.object({ result: z.string() });

// The fields Claude fills in — patch/title/url/date are added deterministically.
const AnalysisOutputSchema = PatchChangesetSchema.omit({
  patch: true,
  title: true,
  url: true,
  date: true,
});

export function buildAnalysisPrompt(patch: RiotPatch): string {
  return [
    'You analyze League of Legends patch notes for "Scout for League of Legends",',
    "a Discord bot that writes post-match reviews. Your analysis feeds an AI that",
    "roasts players about their games, so it should be specific and player-facing.",
    "",
    `Use the WebFetch tool to read the official patch ${patch.patch} notes: ${patch.url}`,
    "",
    "Then produce a JSON object describing the changes. Shape:",
    "{",
    '  "overview": string,   // 1-3 sentence freeform summary of the patch\'s theme',
    '  "themes": string[],   // 0-4 short tags, e.g. ["ADC item tuning","jungle buffs"]',
    '  "summary": string[],  // 2-4 short player-facing highlight bullets',
    '  "champions": [{ "name": string, "direction": "buff"|"nerf"|"adjustment", "magnitude": "minor"|"moderate"|"major", "summary": string, "details": string }],',
    '  "items": [{ "name": string, "direction": "buff"|"nerf"|"adjustment"|"new"|"removed", "magnitude": "minor"|"moderate"|"major", "summary": string, "details": string }],',
    '  "systems": [{ "area": string, "direction": "buff"|"nerf"|"adjustment"|"new"|"removed", "magnitude": "minor"|"moderate"|"major", "summary": string, "details": string }]',
    "}",
    "",
    "Rules:",
    '- Use exact in-game champion and item names (e.g. "Lee Sin", "Eclipse").',
    '- "summary" is a one-liner; "details" is one prose sentence explaining what',
    "  changed AND why it matters to a player on that champion/item/role.",
    '- "systems" covers role/meta/objective/rune/map changes; use a short "area"',
    '  like "Jungle", "Objectives", "Runes", "Support items".',
    "- Strictly factual: only include things actually in the notes. Never invent.",
    "- Include the most impactful changes; skip tiny number tweaks unless notable.",
    "- Do NOT mention Scout itself or data updates.",
    "",
    "Output ONLY the JSON object and nothing else.",
  ].join("\n");
}

function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)\s*```/.exec(trimmed);
  const candidate = (fence?.[1] ?? trimmed).trim();
  try {
    return JSON.parse(candidate);
  } catch {
    const objectMatch = /\{[\s\S]*\}/.exec(candidate);
    if (objectMatch !== null) {
      return JSON.parse(objectMatch[0]);
    }
    throw new Error(
      `no JSON object found in Claude output: ${candidate.slice(0, 160)}`,
    );
  }
}

/**
 * Parse `claude -p --output-format json` stdout into a validated changeset,
 * merging the deterministic patch/title/url/date. Throws on any spec violation
 * so the caller falls back rather than shipping an off-spec asset.
 */
export function parsePatchAnalysis(
  stdout: string,
  patch: RiotPatch,
  date: Date,
): PatchChangeset {
  let wrapper: unknown;
  try {
    wrapper = JSON.parse(stdout);
  } catch {
    throw new Error("Claude patch analysis: stdout was not JSON");
  }
  const parsedWrapper = ClaudeResultSchema.safeParse(wrapper);
  if (!parsedWrapper.success) {
    throw new Error(
      "Claude patch analysis: response is missing a `result` field",
    );
  }
  const analysis = AnalysisOutputSchema.parse(
    extractJsonObject(parsedWrapper.data.result),
  );
  return PatchChangesetSchema.parse({
    ...analysis,
    patch: patch.patch,
    title: patch.title,
    url: patch.url,
    date: formatDateForChangelog(date),
  });
}

/**
 * Ask Claude to read the patch notes and produce the structured changeset.
 * Throws on any failure (claude missing, non-zero exit, unparseable/off-spec
 * output) so the caller can skip the refresh.
 */
export async function analyzePatch(
  patch: RiotPatch,
  date: Date = new Date(),
): Promise<PatchChangeset> {
  const proc = Bun.spawn(
    [
      "claude",
      "-p",
      buildAnalysisPrompt(patch),
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
  return parsePatchAnalysis(stdout, patch, date);
}
