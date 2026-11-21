import { tool } from "ai";
import { z } from "zod";
import {
  findChampion,
  lookupChampion,
  lookupMatchup,
  lookupTiers,
  parseMetaSelection,
  type MetaResult,
  type MetaSelection,
} from "#src/meta/meta-query.ts";
import type { MetaReader } from "#src/meta/meta-reader.ts";
import type {
  ChampionSlice,
  MetaContext,
} from "@scout-for-lol/data/meta/meta-serving.ts";
import type { RateInterval } from "#src/meta/wilson.ts";
import type { ToolTracker } from "#src/reports/ai/scoutql-tools.ts";

/**
 * Explore's read of the champion meta: the same serving JSON the public meta
 * API serves, never the lake. Every answer names its patch, queue, bracket and
 * sample size, so the model reports a rate with the games behind it.
 */

const SelectionShape = {
  patch: z
    .string()
    .optional()
    .describe("Patch like 15.10. Omit for the newest patch with data."),
  queue: z
    .string()
    .optional()
    .describe(
      "ranked_solo (420), ranked_flex (440) or normal_draft (400). Omit for the default.",
    ),
  bracket: z
    .string()
    .optional()
    .describe(
      "all, low (Iron-Silver), mid (Gold-Platinum), high (Emerald-Diamond) or master_plus. Omit for all.",
    ),
  role: z
    .string()
    .optional()
    .describe("TOP, JUNGLE, MIDDLE, BOTTOM or UTILITY. Omit for every role."),
};

export const championMetaSchemas = {
  lookupChampionMeta: z
    .object({
      champion: z.string().min(1).describe("Champion name or numeric id."),
      opponent: z
        .string()
        .min(1)
        .optional()
        .describe(
          "A second champion: returns this champion's head-to-head record against it instead of builds.",
        ),
      ...SelectionShape,
    })
    .strict(),
  listChampionTiers: z
    .object({
      ...SelectionShape,
      limit: z.number().int().min(1).max(60).optional(),
    })
    .strict(),
} as const;

function percent(interval: RateInterval): string {
  return `${(interval.value * 100).toFixed(1)}% (95% interval ${(interval.lower * 100).toFixed(1)}-${(interval.upper * 100).toFixed(1)}%)`;
}

function contextLine(
  context: Pick<MetaContext, "patch" | "queue" | "bracket">,
) {
  return `patch ${context.patch}, ${context.queue}, bracket ${context.bracket}`;
}

function sliceLines(slice: ChampionSlice): string[] {
  const lines = [
    `${slice.context.role} — from ${slice.sample.games.toString()} games of ${slice.sample.matches.toString()} matches (${contextLine(slice.context)}); tier ${slice.tier} (graded on the win-rate interval's lower bound)`,
    `  win rate ${percent(slice.winRate)}; pick rate ${percent(slice.pickRate)}; ban rate ${percent(slice.banRate)}; ${percent(slice.roleShare)} of this champion's games`,
  ];
  const listed = <T extends { games: number; winRate: RateInterval }>(
    label: string,
    entries: readonly T[],
    name: (entry: T) => string,
  ) => {
    if (entries.length === 0) return;
    lines.push(
      `  ${label}: ${entries
        .map(
          (entry) =>
            `${name(entry)} (${entry.games.toString()} games, ${(entry.winRate.value * 100).toFixed(1)}% win)`,
        )
        .join("; ")}`,
    );
  };
  listed("core items (item ids)", slice.coreItems, (entry) =>
    entry.itemId.toString(),
  );
  listed("build paths (item ids; timeline sample)", slice.buildPaths, (entry) =>
    entry.itemIds.join(">"),
  );
  listed("starting items (timeline sample)", slice.startingItems, (entry) =>
    entry.items
      .map((item) => `${item.itemId.toString()}x${item.count.toString()}`)
      .join("+"),
  );
  listed("runes", slice.runes, (entry) =>
    [
      `${entry.primaryStyleId.toString()}:${entry.primaryPerkIds.join(",")}`,
      `${entry.secondaryStyleId.toString()}:${entry.secondaryPerkIds.join(",")}`,
    ].join(" + "),
  );
  listed("summoner spells (ids)", slice.spells, (entry) =>
    entry.spellIds.join("+"),
  );
  listed(
    "skill max order (timeline sample)",
    slice.skillOrders,
    (entry) => entry.order,
  );
  for (const lift of slice.itemLift) {
    lines.push(
      `  vs ${lift.trait} (${lift.baseline.games.toString()} games, ${(lift.baseline.winRate.value * 100).toFixed(1)}% win): ${lift.items
        .slice(0, 4)
        .map(
          (item) =>
            `item ${item.itemId.toString()} ${item.lift >= 0 ? "+" : ""}${(item.lift * 100).toFixed(1)} pts over ${item.games.toString()} games${item.significant ? "" : " (within noise)"}`,
        )
        .join("; ")}`,
    );
  }
  return lines;
}

function failureText(result: Extract<MetaResult<unknown>, { ok: false }>) {
  return `${result.message} (${result.code}). Do not estimate it from memory; say the crawl does not have enough games.`;
}

export async function lookupChampionMetaText(
  reader: MetaReader,
  input: z.infer<typeof championMetaSchemas.lookupChampionMeta>,
): Promise<string> {
  const selection = parseMetaSelection(input);
  if (!selection.ok) return failureText(selection);
  const manifest = await reader.manifest();
  if (manifest === undefined) {
    return "Champion meta has not been published yet (meta_unavailable). Say it is not available yet.";
  }
  const champion = findChampion(manifest, input.champion);
  if (champion === undefined) {
    return `No champion meta for "${input.champion}" (unknown_champion): it is not a known champion name or id, or it has too few crawled games.`;
  }
  if (input.opponent !== undefined) {
    const opponent = findChampion(manifest, input.opponent);
    if (opponent === undefined) {
      return `No champion meta for "${input.opponent}" (unknown_champion): it is not a known champion name or id, or it has too few crawled games.`;
    }
    const result = await lookupMatchup(
      reader,
      champion.id,
      opponent.id,
      selection.value,
    );
    if (!result.ok) return failureText(result);
    const { value } = result;
    return [
      `${value.championName} against ${value.opponentName} — ${contextLine(value.context)}`,
      ...value.slices.map(
        (slice) =>
          `${slice.context.role}: from ${slice.games.toString()} games, ${value.championName} wins ${percent(slice.winRate)}`,
      ),
    ].join("\n");
  }
  const result = await lookupChampion(reader, champion.id, selection.value);
  if (!result.ok) return failureText(result);
  const { value } = result;
  return [
    `${value.championName} — ${contextLine(value.context)}`,
    ...value.slices.flatMap((slice) => sliceLines(slice)),
  ].join("\n");
}

export async function listChampionTiersText(
  reader: MetaReader,
  input: z.infer<typeof championMetaSchemas.listChampionTiers>,
): Promise<string> {
  const selection: ReturnType<typeof parseMetaSelection> =
    parseMetaSelection(input);
  if (!selection.ok) return failureText(selection);
  const chosen: MetaSelection = selection.value;
  const result = await lookupTiers(reader, chosen);
  if (!result.ok) return failureText(result);
  const { file } = result.value;
  const role = chosen.role;
  const entries = file.entries
    .filter((entry) => role === undefined || entry.role === role)
    .slice(0, input.limit ?? 30);
  return [
    `Champion tiers — ${contextLine(file.context)}, from ${file.sample.matches.toString()} matches. Graded on the lower bound of the 95% win-rate interval.`,
    ...entries.map(
      (entry) =>
        `${entry.tier} ${entry.championName} ${entry.role}: ${entry.games.toString()} games, win ${percent(entry.winRate)}, pick ${(entry.pickRate.value * 100).toFixed(1)}%, ban ${(entry.banRate.value * 100).toFixed(1)}%`,
    ),
  ].join("\n");
}

export function createChampionMetaTools(input: {
  reader: MetaReader;
  track: ToolTracker;
}) {
  return {
    lookup_champion_meta: tool({
      description:
        "Crawled champion meta for one champion (win, pick and ban rate with 95% intervals, core items, build paths, starting items, runes, summoner spells, skill order, item lift against enemy damage profiles), or its head-to-head record against an opponent. Covers Summoner's Rift ranked and normal draft only, from the participant crawl, not the server's own games. Always state the sample size, patch, queue and bracket it returns.",
      inputSchema: championMetaSchemas.lookupChampionMeta,
      outputSchema: z.string(),
      execute: (args) =>
        input.track("lookup_champion_meta", () =>
          lookupChampionMetaText(input.reader, args),
        ),
    }),
    list_champion_tiers: tool({
      description:
        "Crawled champion tier list for a patch, queue and bracket: tier grade, win rate with its 95% interval, pick and ban rate, and games per champion and role. Grades use the interval's lower bound, so a small sample never outranks a large one on luck. Always state the sample size, patch, queue and bracket.",
      inputSchema: championMetaSchemas.listChampionTiers,
      outputSchema: z.string(),
      execute: (args) =>
        input.track("list_champion_tiers", () =>
          listChampionTiersText(input.reader, args),
        ),
    }),
  };
}
