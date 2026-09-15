import { tool } from "ai";
import { z } from "zod";
import {
  getAbilityFacts,
  getChampionInfo,
  getPatchChangeset,
  getPatchChangesets,
  findRunes,
  findSummonerSpells,
  items,
  suggestChampionNames,
  type AbilityFacts,
} from "@scout-for-lol/data";
import type { ToolTracker } from "#src/reports/ai/scoutql-tools.ts";

export const AbilitySlotInputSchema = z.enum(["passive", "Q", "W", "E", "R"]);

export const leagueReferenceSchemas = {
  lookupAbility: z
    .object({
      champion: z.string().min(1),
      ability: AbilitySlotInputSchema,
      rank: z.number().int().min(1).max(6).optional(),
    })
    .strict(),
  lookupChampion: z.object({ champion: z.string().min(1) }).strict(),
  lookupItem: z
    .object({
      item: z.string().min(1),
      mapId: z.number().int().positive().optional(),
    })
    .strict(),
  lookupRune: z.object({ rune: z.string().min(1) }).strict(),
  lookupSummonerSpell: z.object({ spell: z.string().min(1) }).strict(),
  lookupPatchNotes: z.object({ subject: z.string().min(1) }).strict(),
  comparePatchChanges: z
    .object({
      fromPatch: z.string().min(1).optional(),
      toPatch: z.string().min(1).optional(),
      subject: z.string().min(1).optional(),
    })
    .strict(),
} as const;

function formatByRank(label: string, values: readonly number[]): string {
  return values.length === 0
    ? `${label}: none`
    : `${label} by rank: [${values.join(", ")}]`;
}

function atRank(values: readonly number[], rank: number): number | undefined {
  return values[rank - 1];
}

function suggestionLine(input: string, suggestions: readonly string[]): string {
  return suggestions.length === 0
    ? `Unknown champion "${input}" and no close matches were found.`
    : `Unknown champion "${input}". Closest matches: ${suggestions.join(", ")}.`;
}

function describeAbilityAtRank(facts: AbilityFacts, rank: number): string[] {
  const lines: string[] = [];
  const cooldown = atRank(facts.cooldownByRank, rank);
  if (cooldown !== undefined) {
    lines.push(`Cooldown at rank ${String(rank)}: ${String(cooldown)}s`);
  }
  const cost = atRank(facts.costByRank, rank);
  if (cost !== undefined) {
    lines.push(
      `Cost at rank ${String(rank)}: ${String(cost)} (${facts.costType})`,
    );
  }
  const range = atRank(facts.rangeByRank, rank);
  if (range !== undefined) {
    lines.push(`Range at rank ${String(rank)}: ${String(range)}`);
  }
  for (const [name, values] of Object.entries(facts.dataValues)) {
    const value = atRank(values, rank);
    if (value !== undefined) {
      lines.push(`${name} at rank ${String(rank)}: ${String(value)}`);
    }
  }
  return lines;
}

export async function lookupAbilityText(
  input: z.infer<typeof leagueReferenceSchemas.lookupAbility>,
): Promise<string> {
  const lookup = await getAbilityFacts(input.champion);
  if (lookup.status === "not_found") {
    return suggestionLine(input.champion, lookup.suggestions);
  }
  const facts = lookup.facts.abilities[input.ability];
  const rank = input.rank ?? 1;
  if (rank > facts.maxRank) {
    return `${lookup.facts.championName} ${input.ability} (${facts.name}) only has ${String(facts.maxRank)} rank${facts.maxRank === 1 ? "" : "s"}; ask for rank 1 through ${String(facts.maxRank)}.`;
  }
  const lines = [
    `${lookup.facts.championName} — ${input.ability}: ${facts.name} (max rank ${String(facts.maxRank)}${input.rank === undefined ? ", defaulted to rank 1" : ""})`,
    ...describeAbilityAtRank(facts, rank),
    formatByRank("Cooldown (s)", facts.cooldownByRank),
    formatByRank(`Cost (${facts.costType})`, facts.costByRank),
    formatByRank("Range", facts.rangeByRank),
  ];
  for (const [name, values] of Object.entries(facts.dataValues)) {
    lines.push(formatByRank(name, values));
  }
  lines.push(`Description: ${facts.resolvedDescription}`);
  if (facts.unresolved.length > 0) {
    lines.push(
      `Unresolved scalings (values unknown — do NOT guess or total them): ${facts.unresolved.join(", ")}`,
    );
  }
  return lines.join("\n");
}

export async function lookupChampionText(
  input: z.infer<typeof leagueReferenceSchemas.lookupChampion>,
): Promise<string> {
  const info = await getChampionInfo(input.champion);
  if (info === undefined) {
    return suggestionLine(input.champion, suggestChampionNames(input.champion));
  }
  const slots = ["Q", "W", "E", "R"] as const;
  const lines = [
    `Champion: ${input.champion}`,
    `Tags: ${info.tags.join(", ")}`,
    `Passive: ${info.passive.name}`,
  ];
  for (const [index, slot] of slots.entries()) {
    const spell = info.spells[index];
    if (spell === undefined) continue;
    lines.push(
      `${slot}${slot === "R" ? " (the ultimate)" : ""}: ${spell.name} — cooldown by rank [${spell.cooldown.join(", ")}], cost by rank [${spell.cost.join(", ")}] (${spell.costType}), range by rank [${spell.range.join(", ")}]`,
    );
  }
  lines.push("Use lookup_ability for damage numbers and full details.");
  return lines.join("\n");
}

function stripHtml(value: string): string {
  return value
    .replaceAll(/<br\s*\/?>/gu, " ")
    .replaceAll(/<[^>]+>/gu, "")
    .replaceAll(/\s+/gu, " ")
    .trim();
}

type ItemDataEntry = (typeof items.data)[string];

function findItemCandidates(item: string): [string, ItemDataEntry][] {
  const query = item.trim().toLowerCase();
  const entries = Object.entries(items.data);
  const idMatches = entries.filter(([id]) => id === item.trim());
  if (idMatches.length > 0) return idMatches;
  const nameMatches = entries.filter(
    ([, entry]) => entry.name.toLowerCase() === query,
  );
  return nameMatches.length > 0
    ? nameMatches
    : entries.filter(([, entry]) => entry.name.toLowerCase().includes(query));
}

function formatItemVariants(entries: [string, ItemDataEntry][]): string {
  return entries
    .slice(0, 8)
    .map(([id, entry]) => {
      const enabledMaps = Object.entries(entry.maps)
        .filter(([, enabled]) => enabled)
        .map(([enabledMapId]) => enabledMapId);
      return `${entry.name} (${id}; map IDs ${enabledMaps.length === 0 ? "none" : enabledMaps.join(", ")})`;
    })
    .join(", ");
}

export function lookupItemText(
  input: z.infer<typeof leagueReferenceSchemas.lookupItem>,
): string {
  const candidates = findItemCandidates(input.item);
  const mapId = input.mapId?.toString();
  const enabledCandidates =
    mapId === undefined
      ? candidates
      : candidates.filter(([, entry]) => entry.maps[mapId] === true);
  if (enabledCandidates.length === 0) {
    return mapId !== undefined && candidates.length > 0
      ? `No "${input.item}" variant is enabled on map ID ${mapId}. Available variants: ${formatItemVariants(candidates)}.`
      : `Unknown item "${input.item}". Ask for the exact item name or numeric ID.`;
  }
  if (enabledCandidates.length > 1) {
    return `Multiple item variants match "${input.item}": ${formatItemVariants(enabledCandidates)}. Ask again with a numeric item ID or map ID.`;
  }
  const foundEntry = enabledCandidates[0];
  if (foundEntry === undefined) throw new Error("Item match disappeared");
  const [foundId, found] = foundEntry;
  const lines = [`Item: ${found.name} (${foundId})`];
  if (found.plaintext !== undefined && found.plaintext.length > 0) {
    lines.push(`Summary: ${found.plaintext}`);
  }
  if (found.stats !== undefined && Object.keys(found.stats).length > 0) {
    lines.push(
      `Stats: ${Object.entries(found.stats)
        .map(([key, value]) => `${key}=${String(value)}`)
        .join(", ")}`,
    );
  }
  lines.push(
    `Gold: ${String(found.gold.total)} total, ${String(found.gold.base)} combine, ${String(found.gold.sell)} sell; ${found.gold.purchasable ? "purchasable" : "not purchasable"}.`,
  );
  const buildNames = (ids: readonly string[] | undefined): string =>
    ids === undefined || ids.length === 0
      ? "none"
      : ids
          .map((id) => `${items.data[id]?.name ?? "Unknown item"} (${id})`)
          .join(", ");
  lines.push(`Builds from: ${buildNames(found.from)}`);
  lines.push(`Builds into: ${buildNames(found.into)}`);
  const enabledMaps = Object.entries(found.maps)
    .filter(([, enabled]) => enabled)
    .map(([enabledMapId]) => enabledMapId);
  lines.push(
    `Enabled map IDs: ${enabledMaps.length === 0 ? "none" : enabledMaps.join(", ")}`,
  );
  if (found.tags.length > 0) lines.push(`Tags: ${found.tags.join(", ")}`);
  lines.push(`Details: ${stripHtml(found.description)}`);
  return lines.join("\n");
}

export function lookupRuneText(
  input: z.infer<typeof leagueReferenceSchemas.lookupRune>,
): string {
  const matches = findRunes(input.rune);
  if (matches.length === 0) {
    return `Unknown rune "${input.rune}". Ask for the exact rune name or numeric ID.`;
  }
  if (matches.length > 1) {
    return `Multiple runes match "${input.rune}": ${matches
      .slice(0, 8)
      .map((rune) => rune.name)
      .join(", ")}. Ask again with the full name.`;
  }
  const rune = matches[0];
  if (rune === undefined) throw new Error("Rune match disappeared");
  return [
    `Rune: ${rune.name} (${String(rune.id)})`,
    `Tree: ${rune.treeName}; slot index: ${String(rune.slot)}`,
    `Summary: ${stripHtml(rune.shortDesc)}`,
    `Details: ${stripHtml(rune.longDesc)}`,
  ].join("\n");
}

export function lookupSummonerSpellText(
  input: z.infer<typeof leagueReferenceSchemas.lookupSummonerSpell>,
): string {
  const matches = findSummonerSpells(input.spell);
  if (matches.length === 0) {
    return `Unknown summoner spell "${input.spell}". Ask for the exact spell name or numeric ID.`;
  }
  if (matches.length > 1) {
    return `Multiple summoner spells match "${input.spell}": ${matches
      .slice(0, 8)
      .map((spell) => spell.name)
      .join(", ")}. Ask again with the full name.`;
  }
  const spell = matches[0];
  if (spell === undefined) throw new Error("Summoner spell match disappeared");
  return [
    `Summoner spell: ${spell.name} (${spell.id}, key ${spell.key})`,
    `Cooldown: ${spell.cooldownBurn}s; range: ${spell.rangeBurn}; required level: ${String(spell.summonerLevel)}`,
    `Modes: ${spell.modes.join(", ")}`,
    `Details: ${stripHtml(spell.description)}`,
  ].join("\n");
}

export function lookupPatchNotesText(
  input: z.infer<typeof leagueReferenceSchemas.lookupPatchNotes>,
): string {
  const changeset = getPatchChangeset();
  if (changeset === undefined) return "No patch notes are available right now.";
  const query = input.subject.trim().toLowerCase();
  const lines: string[] = [];
  for (const change of changeset.champions) {
    if (change.name.toLowerCase().includes(query)) {
      lines.push(
        `${change.name} (${change.direction}, ${change.magnitude}): ${change.details}`,
      );
    }
  }
  for (const change of changeset.items) {
    if (change.name.toLowerCase().includes(query)) {
      lines.push(
        `${change.name} (${change.direction}, ${change.magnitude}): ${change.summary}`,
      );
    }
  }
  for (const change of changeset.systems) {
    if (`${change.area} ${change.summary}`.toLowerCase().includes(query)) {
      lines.push(
        `${change.area} (${change.direction}, ${change.magnitude}): ${change.details}`,
      );
    }
  }
  const header = `Patch ${changeset.patch}: ${changeset.overview}`;
  return lines.length === 0
    ? [
        `No patch ${changeset.patch} change mentions "${input.subject}".`,
        header,
        ...changeset.summary.slice(0, 3).map((bullet) => `- ${bullet}`),
      ].join("\n")
    : [header, ...lines].join("\n");
}

function patchSubjectLines(
  patch: ReturnType<typeof getPatchChangesets>[number],
  subject: string | undefined,
): string[] {
  if (subject === undefined) return patch.summary.slice(0, 4);
  const query = subject.trim().toLowerCase();
  return [
    ...patch.champions
      .filter((change) => change.name.toLowerCase().includes(query))
      .map(
        (change) =>
          `${change.name} (${change.direction}, ${change.magnitude}): ${change.details}`,
      ),
    ...patch.items
      .filter((change) => change.name.toLowerCase().includes(query))
      .map(
        (change) =>
          `${change.name} (${change.direction}, ${change.magnitude}): ${change.details}`,
      ),
    ...patch.systems
      .filter((change) =>
        `${change.area} ${change.summary}`.toLowerCase().includes(query),
      )
      .map(
        (change) =>
          `${change.area} (${change.direction}, ${change.magnitude}): ${change.details}`,
      ),
  ];
}

export function comparePatchChangesText(
  input: z.infer<typeof leagueReferenceSchemas.comparePatchChanges>,
): string {
  const history = getPatchChangesets();
  const current = getPatchChangeset();
  if (current === undefined || history.length === 0) {
    return "No structured patch history is available right now.";
  }
  const toPatch =
    (input.toPatch ?? "current") === "current"
      ? current
      : history.find((patch) => patch.patch === input.toPatch);
  const toPatchIndex = history.findIndex(
    (patch) => patch.patch === toPatch?.patch,
  );
  const previous = toPatchIndex === -1 ? undefined : history[toPatchIndex + 1];
  const fromPatch =
    input.fromPatch === undefined || input.fromPatch === "previous"
      ? previous
      : history.find((patch) => patch.patch === input.fromPatch);
  if (toPatch === undefined || fromPatch === undefined) {
    return `That comparison is unavailable. Structured patch versions: ${history.map((patch) => patch.patch).join(", ")}.`;
  }
  const fromLines = patchSubjectLines(fromPatch, input.subject);
  const toLines = patchSubjectLines(toPatch, input.subject);
  const subjectLabel = input.subject ?? "highlights";
  return [
    `Comparing patch ${fromPatch.patch} to ${toPatch.patch} for ${subjectLabel}.`,
    `Patch ${fromPatch.patch}: ${fromLines.length === 0 ? "no matching structured changes" : fromLines.join(" | ")}`,
    `Patch ${toPatch.patch}: ${toLines.length === 0 ? "no matching structured changes" : toLines.join(" | ")}`,
  ].join("\n");
}

export function createLeagueReferenceTools(track: ToolTracker) {
  return {
    lookup_ability: tool({
      description:
        "Current bundled facts for one champion ability: damage and other per-rank numbers, cooldown, cost, range, and resolved tooltip. Load league-reference first.",
      inputSchema: leagueReferenceSchemas.lookupAbility,
      outputSchema: z.string(),
      execute: (input) =>
        track("lookup_ability", () => lookupAbilityText(input)),
    }),
    lookup_champion: tool({
      description:
        "Current bundled champion overview with ability slots, tags, cooldowns, costs, and ranges. Load league-reference first.",
      inputSchema: leagueReferenceSchemas.lookupChampion,
      outputSchema: z.string(),
      execute: (input) =>
        track("lookup_champion", () => lookupChampionText(input)),
    }),
    lookup_item: tool({
      description:
        "Current bundled item stats and description by name or numeric ID, optionally filtered by numeric map ID (11 for Summoner's Rift). Load league-reference first.",
      inputSchema: leagueReferenceSchemas.lookupItem,
      outputSchema: z.string(),
      execute: (input) => track("lookup_item", () => lookupItemText(input)),
    }),
    lookup_rune: tool({
      description:
        "Current bundled rune tree, slot, and descriptions by name or ID. Load league-reference first.",
      inputSchema: leagueReferenceSchemas.lookupRune,
      outputSchema: z.string(),
      execute: (input) => track("lookup_rune", () => lookupRuneText(input)),
    }),
    lookup_summoner_spell: tool({
      description:
        "Current bundled summoner-spell cooldown, range, level, modes, and description. Load league-reference first.",
      inputSchema: leagueReferenceSchemas.lookupSummonerSpell,
      outputSchema: z.string(),
      execute: (input) =>
        track("lookup_summoner_spell", () => lookupSummonerSpellText(input)),
    }),
    lookup_patch_notes: tool({
      description:
        "Current bundled official patch changes for a champion, item, or system. Load league-reference first.",
      inputSchema: leagueReferenceSchemas.lookupPatchNotes,
      outputSchema: z.string(),
      execute: (input) =>
        track("lookup_patch_notes", () => lookupPatchNotesText(input)),
    }),
    compare_patch_changes: tool({
      description:
        "Compare two archived structured official patch changesets, optionally for one champion, item, or system. Defaults to current versus previous. Load league-reference first.",
      inputSchema: leagueReferenceSchemas.comparePatchChanges,
      outputSchema: z.string(),
      execute: (input) =>
        track("compare_patch_changes", () => comparePatchChangesText(input)),
    }),
  };
}
