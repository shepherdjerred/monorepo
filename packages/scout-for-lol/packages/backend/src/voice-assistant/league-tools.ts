import { tool } from "@openai/agents/realtime";
import { z } from "zod";
import {
  getAbilityFacts,
  getChampionInfo,
  getPatchChangeset,
  items,
  suggestChampionNames,
  type AbilityFacts,
  type AbilitySlot,
} from "@scout-for-lol/data";
import type { RealtimeTurnTools } from "@shepherdjerred/voice-assistant";
import { scoutVoiceToolCallsTotal } from "#src/metrics/platform/voice.ts";

/**
 * Read-only League tools for one Hey Scout turn, all over committed data-
 * package assets. Champion, ability, and item names are user boundaries
 * (speech-to-text output): unknown inputs return deterministic suggestion
 * strings and never throw into the session. A committed asset that fails its
 * schema still throws loudly upstream — that is a broken internal contract.
 * Every tool is non-mutating, so the shared `VoiceMutationGate` is satisfied
 * trivially and no tool ever consults it.
 */

export const AbilitySlotInputSchema = z.enum(["passive", "Q", "W", "E", "R"]);

export const leagueVoiceToolSchemas = {
  lookupAbility: z.strictObject({
    champion: z.string().min(1),
    ability: AbilitySlotInputSchema,
    rank: z.number().int().min(1).max(6).optional(),
  }),
  lookupChampion: z.strictObject({ champion: z.string().min(1) }),
  lookupItem: z.strictObject({ item: z.string().min(1) }),
  lookupPatchNotes: z.strictObject({ subject: z.string().min(1) }),
} as const;

/**
 * The champion/slot the model actually grounded its answer in, recorded by
 * the last successful `lookup_ability` call. Read after the turn for the
 * `voice_question_asked` analytics event — it carries no transcript text.
 */
export class VoiceTurnFactsRecorder {
  private championName: string | undefined;
  private abilitySlot: AbilitySlot | undefined;

  record(champion: string, slot: AbilitySlot): void {
    this.championName = champion;
    this.abilitySlot = slot;
  }

  get champion(): string | undefined {
    return this.championName;
  }

  get slot(): AbilitySlot | undefined {
    return this.abilitySlot;
  }
}

function formatByRank(label: string, values: readonly number[]): string {
  if (values.length === 0) return `${label}: none`;
  return `${label} by rank: [${values.join(", ")}]`;
}

function atRank(values: readonly number[], rank: number): number | undefined {
  return values[rank - 1];
}

function suggestionLine(input: string, suggestions: readonly string[]): string {
  if (suggestions.length === 0) {
    return `Unknown champion "${input}" and no close matches were found.`;
  }
  return `Unknown champion "${input}". Closest matches: ${suggestions.join(", ")}.`;
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

/**
 * Grounded per-ability facts as a compact text block. Pure over the committed
 * assets, exported for golden tests.
 */
export async function lookupAbilityText(
  input: z.infer<typeof leagueVoiceToolSchemas.lookupAbility>,
  recorder?: VoiceTurnFactsRecorder,
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
  recorder?.record(lookup.facts.championName, input.ability);
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

/** Champion overview: slot mapping, tags, and per-spell cooldowns. */
export async function lookupChampionText(
  input: z.infer<typeof leagueVoiceToolSchemas.lookupChampion>,
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
    const ultNote = slot === "R" ? " (the ultimate)" : "";
    lines.push(
      `${slot}${ultNote}: ${spell.name} — cooldown by rank [${spell.cooldown.join(", ")}], cost by rank [${spell.cost.join(", ")}] (${spell.costType}), range by rank [${spell.range.join(", ")}]`,
    );
  }
  lines.push("Use lookup_ability for damage numbers and full details.");
  return lines.join("\n");
}

function stripHtml(text: string): string {
  return text
    .replaceAll(/<br\s*\/?>/gu, " ")
    .replaceAll(/<[^>]+>/gu, "")
    .replaceAll(/\s+/gu, " ")
    .trim();
}

/** Item lookup by (partial) name over the committed Data Dragon item asset. */
export function lookupItemText(
  input: z.infer<typeof leagueVoiceToolSchemas.lookupItem>,
): string {
  const query = input.item.trim().toLowerCase();
  const entries = Object.values(items.data);
  const exact = entries.find((entry) => entry.name.toLowerCase() === query);
  const partial = entries.filter((entry) =>
    entry.name.toLowerCase().includes(query),
  );
  const found = exact ?? (partial.length === 1 ? partial[0] : undefined);
  if (found === undefined) {
    if (partial.length > 1) {
      const names = [...new Set(partial.map((entry) => entry.name))].slice(
        0,
        5,
      );
      return `Multiple items match "${input.item}": ${names.join(", ")}. Ask again with the full name.`;
    }
    return `Unknown item "${input.item}". Ask for the exact item name.`;
  }
  const lines = [`Item: ${found.name}`];
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
  lines.push(`Details: ${stripHtml(found.description)}`);
  return lines.join("\n");
}

/** Balance-change prose for one champion, item, or system from the bundled patch notes. */
export function lookupPatchNotesText(
  input: z.infer<typeof leagueVoiceToolSchemas.lookupPatchNotes>,
): string {
  const changeset = getPatchChangeset();
  if (changeset === undefined) {
    return "No patch notes are available right now.";
  }
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
    const haystack = `${change.area} ${change.summary}`.toLowerCase();
    if (haystack.includes(query)) {
      lines.push(
        `${change.area} (${change.direction}, ${change.magnitude}): ${change.details}`,
      );
    }
  }
  const header = `Patch ${changeset.patch}: ${changeset.overview}`;
  if (lines.length === 0) {
    const bullets = changeset.summary
      .slice(0, 3)
      .map((bullet) => `- ${bullet}`);
    return [
      `No patch ${changeset.patch} change mentions "${input.subject}".`,
      header,
      ...bullets,
    ].join("\n");
  }
  return [header, ...lines].join("\n");
}

type LeagueVoiceToolName =
  "lookup_ability" | "lookup_champion" | "lookup_item" | "lookup_patch_notes";

async function invoke(
  name: LeagueVoiceToolName,
  operation: () => string | Promise<string>,
): Promise<string> {
  try {
    const result = await operation();
    scoutVoiceToolCallsTotal.inc({ tool: name, outcome: "success" });
    return result;
  } catch (error) {
    scoutVoiceToolCallsTotal.inc({ tool: name, outcome: "error" });
    throw error;
  }
}

/**
 * Build the per-turn tool set. Everything here is read-only; a thrown error
 * from committed-asset validation propagates into the turn's error path on
 * purpose (fail loudly), while user-shaped misses return suggestion text.
 */
export function createLeagueVoiceTools(
  recorder: VoiceTurnFactsRecorder,
): RealtimeTurnTools {
  return [
    tool({
      name: "lookup_ability",
      description:
        "Grounded facts for one champion ability: damage and other per-rank numbers, cooldown, cost, range, and the resolved tooltip. Ability slots are passive/Q/W/E/R; the ultimate is R. Rank defaults to 1.",
      parameters: leagueVoiceToolSchemas.lookupAbility,
      execute: (input) =>
        invoke("lookup_ability", () => lookupAbilityText(input, recorder)),
    }),
    tool({
      name: "lookup_champion",
      description:
        "Champion overview: ability-name-to-slot mapping (ult = R), tags, and per-spell cooldown/cost/range by rank.",
      parameters: leagueVoiceToolSchemas.lookupChampion,
      execute: (input) =>
        invoke("lookup_champion", () => lookupChampionText(input)),
    }),
    tool({
      name: "lookup_item",
      description:
        "Item stats and description by item name from the current patch's Data Dragon.",
      parameters: leagueVoiceToolSchemas.lookupItem,
      execute: (input) => invoke("lookup_item", () => lookupItemText(input)),
    }),
    tool({
      name: "lookup_patch_notes",
      description:
        "Recent balance-change prose for a champion, item, or system from the current patch notes.",
      parameters: leagueVoiceToolSchemas.lookupPatchNotes,
      execute: (input) =>
        invoke("lookup_patch_notes", () => lookupPatchNotesText(input)),
    }),
  ];
}
