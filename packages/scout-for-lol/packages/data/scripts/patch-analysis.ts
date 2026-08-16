// Turn the real Riot patch notes into a structured, player-facing changeset by
// asking Claude to read the notes and emit categorized buff/nerf data plus a
// freeform overview. The deterministic code (riot-patch.ts) still owns the patch
// NUMBER, notes LINK, and date; Claude only writes the balance analysis, so it
// can't get the load-bearing facts wrong.
//
// Prompt building and output parsing are split out so they're unit-testable; the
// Claude Agent SDK call is the only impure part. The `update-data-dragon` caller
// treats a failure as non-fatal (it still ships the asset PR, just without a
// refreshed changeset).

import { query } from "@anthropic-ai/claude-agent-sdk";
import { traceClaudeAgent } from "@shepherdjerred/llm-observability/wrappers/claude-agent";
import { z } from "zod";
import type { RiotPatch } from "./riot-patch.ts";
import {
  PatchChangesetSchema,
  type PatchChangeset,
} from "#src/data-dragon/patch-notes.ts";
import { formatDateForChangelog } from "./update-changelog.ts";

// Structured extraction is a bigger reasoning task than the old one-line
// highlights, so use the strongest model. This runs at most weekly.
const MODEL = "claude-opus-5";
const MAX_TURNS = 8;
const TIMEOUT_MS = 240_000;

// The fields Claude fills in — patch/title/url/date are added deterministically.
const AnalysisOutputSchema = PatchChangesetSchema.omit({
  patch: true,
  title: true,
  url: true,
  date: true,
});
const AnalysisOutputJsonSchema: Record<string, unknown> = z
  .record(z.string(), z.unknown())
  .parse(z.toJSONSchema(AnalysisOutputSchema, { target: "draft-7" }));
const ClaudeResultSchema = z.looseObject({
  type: z.literal("result"),
  subtype: z.literal("success"),
  is_error: z.literal(false),
  structured_output: z.unknown(),
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
    '  "summary": string[],  // 2-4 short player-facing balance highlight bullets (for the review)',
    '  "changelogHighlights": string[],  // 0-4 bullets for Scout\'s public changelog (see rules)',
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
    '- "changelogHighlights" appears on Scout\'s public "What\'s New" page. Include',
    "  ONLY changes that affect what Scout does: a new champion (Scout adds",
    "  support/assets), a new or returning queue / game mode (Scout supports its",
    "  reports + prematch), new Arena augments or mechanics Scout renders, or",
    "  role-specific starting items / other changes to what Scout tracks or renders.",
    '- Do NOT put routine champion/item buffs or nerfs in "changelogHighlights" —',
    '  those belong in "summary" for the review.',
    "- You may add AT MOST ONE short headline balance/meta-theme line to",
    '  "changelogHighlights" (e.g. "Enchanter supports and mid-lane mages',
    '  reshuffled") — never a per-champion list.',
    '- "changelogHighlights" is usually EMPTY: most patches only refresh data, and',
    '  Scout prepends its own "data refreshed" line automatically. Return [] then.',
    "",
    "Output ONLY the JSON object and nothing else.",
  ].join("\n");
}

/**
 * Parse Claude Agent SDK structured output into a validated changeset,
 * merging the deterministic patch/title/url/date. Throws on any spec violation
 * so the caller falls back rather than shipping an off-spec asset.
 */
export function parsePatchAnalysis(
  structuredOutput: unknown,
  patch: RiotPatch,
  date: Date,
): PatchChangeset {
  const analysis = AnalysisOutputSchema.parse(structuredOutput);
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
 * Throws on any SDK or output-contract failure so the caller can skip the
 * refresh. The final object comes only from schema-backed structured output;
 * prose and fenced JSON are never parsed.
 */
export async function analyzePatch(
  patch: RiotPatch,
  date: Date = new Date(),
): Promise<PatchChangeset> {
  const claudeToken = Bun.env["CLAUDE_CODE_OAUTH_TOKEN"];
  if (claudeToken === undefined || claudeToken === "") {
    throw new Error("CLAUDE_CODE_OAUTH_TOKEN is required for patch analysis");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new Error("Claude patch analysis timed out"));
  }, TIMEOUT_MS);
  const prompt = buildAnalysisPrompt(patch);
  const environment: Record<string, string | undefined> = {
    ...Bun.env,
    ANTHROPIC_API_KEY: undefined,
    CLAUDE_AGENT_SDK_CLIENT_APP: "scout-patch-analysis/1.0",
    CLAUDE_CODE_OAUTH_TOKEN: claudeToken,
  };
  let result: z.infer<typeof ClaudeResultSchema> | undefined;
  const messages = traceClaudeAgent(
    {
      service: "scout-data",
      callSite: "patch-analysis",
      request: {
        model: MODEL,
        prompt,
        options: {
          maxTurns: MAX_TURNS,
          outputSchema: AnalysisOutputJsonSchema,
        },
      },
    },
    () =>
      query({
        prompt,
        options: {
          abortController: controller,
          allowedTools: ["WebFetch"],
          allowDangerouslySkipPermissions: true,
          env: environment,
          executable: "bun",
          maxTurns: MAX_TURNS,
          model: MODEL,
          outputFormat: {
            type: "json_schema",
            schema: AnalysisOutputJsonSchema,
          },
          permissionMode: "bypassPermissions",
          persistSession: false,
          tools: ["WebFetch"],
        },
      }),
  );
  try {
    for await (const message of messages) {
      const parsed = ClaudeResultSchema.safeParse(message);
      if (parsed.success) {
        result = parsed.data;
      }
    }
  } finally {
    clearTimeout(timeout);
  }
  if (result === undefined) {
    throw new Error(
      "Claude patch analysis completed without valid structured output",
    );
  }
  return parsePatchAnalysis(result.structured_output, patch, date);
}
