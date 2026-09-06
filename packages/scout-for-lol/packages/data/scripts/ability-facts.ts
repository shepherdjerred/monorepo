/**
 * Ability-facts generation: merge committed Data Dragon spell data (cooldowns,
 * costs, ranges, tooltips) with CommunityDragon champion bins (DataValues and
 * spell calculations) into `src/data-dragon/assets/ability-facts/{Key}.json`.
 *
 * Resolution doctrine: NEVER guess. A `{{ placeholder }}` token is substituted
 * only when it maps onto data we can read mechanically (a DataValue rank table,
 * a calculation whose every formula part is a known type, a Data Dragon burn
 * string). Anything else stays a literal token and is recorded in that
 * ability's `unresolved[]` so downstream consumers can decline honestly.
 */

import { z } from "zod";
import {
  CDragonCalculationReferencePartSchema,
  CDragonCharacterRecordSchema,
  CDragonCharLevelBreakpointsPartSchema,
  CDragonCharLevelInterpolationPartSchema,
  CDragonChampionBinSchema,
  CDragonEffectValuePartSchema,
  CDragonNamedDataValuePartSchema,
  CDragonNumberPartSchema,
  CDragonSpellObjectSchema,
  CDragonStatByCoefficientPartSchema,
  CDragonStatByNamedDataValuePartSchema,
  CDragonSumOfSubPartsPartSchema,
  type CDragonGameCalculation,
  type CDragonSpellRecord,
} from "./update-data-dragon-schemas.ts";
import {
  ChampionAbilityFactsSchema,
  type AbilityFacts,
  type AbilitySlot,
  type ChampionAbilityFacts,
} from "#src/data-dragon/ability-facts.ts";

// ---------------------------------------------------------------------------
// Data Dragon input (the committed assets/champion/{Key}.json files)
// ---------------------------------------------------------------------------

const DataDragonSpellSchema = z.object({
  id: z.string(),
  name: z.string(),
  tooltip: z.string(),
  maxrank: z.number().int().min(1).max(6),
  cooldown: z.array(z.number()),
  cooldownBurn: z.string(),
  cost: z.array(z.number()),
  costBurn: z.string(),
  costType: z.string(),
  range: z.array(z.number()),
  rangeBurn: z.string(),
  effectBurn: z.array(z.string().nullable()),
});

const DataDragonChampionFileSchema = z.object({
  data: z.record(
    z.string(),
    z.object({
      id: z.string(),
      name: z.string(),
      partype: z.string(),
      spells: z.array(DataDragonSpellSchema).length(4),
      passive: z.object({ name: z.string(), description: z.string() }),
    }),
  ),
});

type DataDragonSpell = z.infer<typeof DataDragonSpellSchema>;

// ---------------------------------------------------------------------------
// Number formatting
// ---------------------------------------------------------------------------

/**
 * Bin values are float32 serialized through float64 (0.699999988079071 for
 * 0.7). Game data uses at most a few decimals, so rounding at 5 decimal
 * places removes exactly the representation noise and nothing else.
 */
export function cleanNumber(value: number): number {
  return Math.round(value * 100_000) / 100_000;
}

function formatNumber(value: number): string {
  return String(cleanNumber(value));
}

/** "300/475/650", collapsed to "300" when constant across ranks. */
export function formatRankValues(values: readonly number[]): string {
  const cleaned = values.map(cleanNumber);
  const first = cleaned[0];
  if (first !== undefined && cleaned.every((entry) => entry === first)) {
    return String(first);
  }
  return cleaned.join("/");
}

// ---------------------------------------------------------------------------
// Stat table (empirically pinned against live bins + known kit scalings)
// ---------------------------------------------------------------------------

/**
 * `mStat` id → spoken name. Pinned empirically from self-documenting DataValue
 * names in live 16.16 bins (BonusADRatio → 2, DamageMRRatio → 6,
 * BonusHealthRatio → 12, CritMoveSpeedPercentASRatio → 4, ...) and verified
 * kit scalings (Cho'Gath R +50% AP / +10% bonus Health; Zed Q +110% bonus AD;
 * Pyke R +150% Lethality; Hecarim passive bonus Move Speed → AD). An id not
 * in this table makes its calculation unresolvable — never guessed.
 */
export const STAT_NAMES: Readonly<Record<number, string>> = {
  0: "AP",
  1: "Armor",
  2: "AD",
  4: "Attack Speed",
  6: "Magic Resist",
  7: "Move Speed",
  8: "Crit Chance",
  9: "Crit Damage",
  12: "Health",
  29: "Lethality",
};

const STAT_FORMULA_PREFIXES: Readonly<Record<number, string>> = {
  0: "",
  1: "base ",
  2: "bonus ",
};

function statLabel(stat: number, formula: number): string | undefined {
  const name = STAT_NAMES[stat];
  const prefix = STAT_FORMULA_PREFIXES[formula];
  if (name === undefined || prefix === undefined) {
    return undefined;
  }
  // Total health reads as "max Health" (that is what the game displays).
  if (stat === 12 && formula === 0) {
    return "max Health";
  }
  return `${prefix}${name}`;
}

// ---------------------------------------------------------------------------
// Calculation rendering
// ---------------------------------------------------------------------------

type RenderedPart =
  | { kind: "ranks"; values: number[]; percentDisplay?: boolean }
  | { kind: "number"; value: number; percentDisplay?: boolean }
  | { kind: "levelRange"; from: number; to: number; percentDisplay?: boolean }
  | { kind: "stat"; percentByRank: number[]; label: string };

type SpellContext = {
  /** Lowercased DataValue name → raw (rank-0-prefixed) values. */
  dataValues: ReadonlyMap<string, readonly number[]>;
  /** Lowercased calculation key → calculation. */
  calculations: ReadonlyMap<string, CDragonGameCalculation>;
  /**
   * Effect index → per-rank numbers, parsed from the Data Dragon spell's
   * `effectBurn` (already rank-1-first). Feeds EffectValueCalculationPart.
   */
  effectRanks: ReadonlyMap<number, readonly number[]>;
  maxRank: number;
};

/** Parse Data Dragon `effectBurn` ("80/135/190") into per-index rank tables. */
function effectRanksFrom(
  effectBurn: readonly (string | null)[] | undefined,
): Map<number, readonly number[]> {
  const effectRanks = new Map<number, readonly number[]>();
  for (const [index, burn] of (effectBurn ?? []).entries()) {
    if (burn === null || burn.length === 0) {
      continue;
    }
    const values = burn.split("/").map(Number);
    if (values.every((value) => Number.isFinite(value))) {
      effectRanks.set(index, values);
    }
  }
  return effectRanks;
}

/** Ranks are 1-indexed into the raw bin arrays: `values[1]` is rank 1. */
function sliceRanks(
  values: readonly number[],
  maxRank: number,
): number[] | undefined {
  const sliced = values.slice(1, maxRank + 1);
  return sliced.length > 0 ? sliced : undefined;
}

const BREAKPOINT_KNOWN_KEYS = new Set([
  "__type",
  "mLevel",
  "mBonusPerLevelAtAndAfter",
  "mAdditionalBonusAtThisLevel",
]);

function breakpointValueAtLevel(
  part: z.infer<typeof CDragonCharLevelBreakpointsPartSchema>,
  level: number,
): number {
  let value = part.mLevel1Value ?? 0;
  let perLevel = 0;
  const breakpoints = part.mBreakpoints ?? [];
  for (let currentLevel = 2; currentLevel <= level; currentLevel++) {
    const breakpoint = breakpoints.find(
      (entry) => entry.mLevel === currentLevel,
    );
    if (breakpoint !== undefined) {
      if (breakpoint.mBonusPerLevelAtAndAfter !== undefined) {
        perLevel = breakpoint.mBonusPerLevelAtAndAfter;
      }
      value += breakpoint.mAdditionalBonusAtThisLevel ?? 0;
    }
    value += perLevel;
  }
  return value;
}

/**
 * Render one formula part, or `undefined` when the part is not one of the
 * known types (the whole calculation then counts as unresolved).
 */
function renderPart(
  part: unknown,
  context: SpellContext,
  inFlight: ReadonlySet<string>,
): RenderedPart[] | undefined {
  const namedDataValue = CDragonNamedDataValuePartSchema.safeParse(part);
  if (namedDataValue.success) {
    const raw = context.dataValues.get(
      namedDataValue.data.mDataValue.toLowerCase(),
    );
    if (raw === undefined) {
      return undefined;
    }
    const values = sliceRanks(raw, context.maxRank);
    return values === undefined ? undefined : [{ kind: "ranks", values }];
  }

  const statByCoefficient = CDragonStatByCoefficientPartSchema.safeParse(part);
  if (statByCoefficient.success) {
    const label = statLabel(
      statByCoefficient.data.mStat ?? 0,
      statByCoefficient.data.mStatFormula ?? 0,
    );
    if (label === undefined) {
      return undefined;
    }
    return [
      {
        kind: "stat",
        percentByRank: [statByCoefficient.data.mCoefficient * 100],
        label,
      },
    ];
  }

  const statByDataValue = CDragonStatByNamedDataValuePartSchema.safeParse(part);
  if (statByDataValue.success) {
    const label = statLabel(
      statByDataValue.data.mStat ?? 0,
      statByDataValue.data.mStatFormula ?? 0,
    );
    const raw = context.dataValues.get(
      statByDataValue.data.mDataValue.toLowerCase(),
    );
    if (label === undefined || raw === undefined) {
      return undefined;
    }
    const ratios = sliceRanks(raw, context.maxRank);
    if (ratios === undefined) {
      return undefined;
    }
    return [
      {
        kind: "stat",
        percentByRank: ratios.map((ratio) => ratio * 100),
        label,
      },
    ];
  }

  const numberPart = CDragonNumberPartSchema.safeParse(part);
  if (numberPart.success) {
    return [{ kind: "number", value: numberPart.data.mNumber ?? 0 }];
  }

  const effectValue = CDragonEffectValuePartSchema.safeParse(part);
  if (effectValue.success) {
    const values = context.effectRanks.get(effectValue.data.mEffectIndex ?? 0);
    if (values === undefined) {
      return undefined;
    }
    return [{ kind: "ranks", values: [...values] }];
  }

  const interpolation = CDragonCharLevelInterpolationPartSchema.safeParse(part);
  if (interpolation.success) {
    return [
      {
        kind: "levelRange",
        from: interpolation.data.mStartValue ?? 0,
        to: interpolation.data.mEndValue ?? 0,
      },
    ];
  }

  const breakpoints = CDragonCharLevelBreakpointsPartSchema.safeParse(part);
  if (breakpoints.success) {
    // A breakpoint carrying fields we do not understand would silently skew
    // the arithmetic — refuse instead.
    const allKnown = (breakpoints.data.mBreakpoints ?? []).every((entry) =>
      Object.keys(entry).every((key) => BREAKPOINT_KNOWN_KEYS.has(key)),
    );
    if (!allKnown) {
      return undefined;
    }
    return [
      {
        kind: "levelRange",
        from: breakpointValueAtLevel(breakpoints.data, 1),
        to: breakpointValueAtLevel(breakpoints.data, 18),
      },
    ];
  }

  const sum = CDragonSumOfSubPartsPartSchema.safeParse(part);
  if (sum.success) {
    const rendered: RenderedPart[] = [];
    for (const subpart of sum.data.mSubparts) {
      const subRendered = renderPart(subpart, context, inFlight);
      if (subRendered === undefined) {
        return undefined;
      }
      rendered.push(...subRendered);
    }
    return rendered;
  }

  const reference = CDragonCalculationReferencePartSchema.safeParse(part);
  if (reference.success) {
    return renderCalculationParts(
      reference.data.mSpellCalculationKey,
      context,
      inFlight,
    );
  }

  return undefined;
}

/** Multiply every number in a rendered calculation by a constant — exact. */
function scaleParts(
  parts: readonly RenderedPart[],
  factor: number,
): RenderedPart[] {
  return parts.map((part): RenderedPart => {
    switch (part.kind) {
      case "ranks": {
        return { ...part, values: part.values.map((v) => v * factor) };
      }
      case "number": {
        return { ...part, value: part.value * factor };
      }
      case "levelRange": {
        return { ...part, from: part.from * factor, to: part.to * factor };
      }
      case "stat": {
        return {
          ...part,
          percentByRank: part.percentByRank.map((v) => v * factor),
        };
      }
    }
  });
}

/** A rendered multiplier usable for exact scaling: a rank-constant number. */
function constantOf(parts: readonly RenderedPart[]): number | undefined {
  if (parts.length !== 1) {
    return undefined;
  }
  const [part] = parts;
  if (part === undefined) {
    return undefined;
  }
  if (part.kind === "number") {
    return part.value;
  }
  if (part.kind === "ranks") {
    const first = part.values[0];
    if (
      first !== undefined &&
      part.values.every((value) => cleanNumber(value) === cleanNumber(first))
    ) {
      return first;
    }
  }
  return undefined;
}

function renderCalculationParts(
  calculationKey: string,
  context: SpellContext,
  inFlight: ReadonlySet<string>,
): RenderedPart[] | undefined {
  const lowered = calculationKey.toLowerCase();
  if (inFlight.has(lowered)) {
    return undefined; // Cyclic reference — refuse rather than loop.
  }
  const calculation = context.calculations.get(lowered);
  if (calculation === undefined) {
    return undefined;
  }
  const nested = new Set([...inFlight, lowered]);

  let parts: RenderedPart[] | undefined;
  if (
    calculation.__type === "GameCalculationModified" &&
    calculation.mModifiedGameCalculation !== undefined
  ) {
    parts = renderCalculationParts(
      calculation.mModifiedGameCalculation,
      context,
      nested,
    );
  } else if (
    calculation.__type === "GameCalculation" &&
    calculation.mFormulaParts !== undefined
  ) {
    parts = [];
    for (const formulaPart of calculation.mFormulaParts) {
      const rendered = renderPart(formulaPart, context, nested);
      if (rendered === undefined) {
        return undefined;
      }
      parts.push(...rendered);
    }
  } else {
    return undefined; // GameCalculationConditional and unknown calc types.
  }

  if (parts === undefined) {
    return undefined;
  }

  if (calculation.mMultiplier !== undefined) {
    const multiplierParts = renderPart(
      calculation.mMultiplier,
      context,
      nested,
    );
    if (multiplierParts === undefined) {
      return undefined;
    }
    const factor = constantOf(multiplierParts);
    if (factor === undefined) {
      return undefined;
    }
    parts = scaleParts(parts, factor);
  }

  if (calculation.mDisplayAsPercent === true) {
    // A percent display combined with stat scalings would need per-100-stat
    // phrasing we cannot derive mechanically — refuse those.
    if (parts.some((part) => part.kind === "stat")) {
      return undefined;
    }
    return scaleParts(parts, 100).map((part): RenderedPart => {
      return part.kind === "stat" ? part : { ...part, percentDisplay: true };
    });
  }

  return parts;
}

function partToString(part: RenderedPart, first: boolean): string {
  const suffix =
    part.kind !== "stat" && part.percentDisplay === true ? "%" : "";
  switch (part.kind) {
    case "ranks": {
      const text = `${formatRankValues(part.values)}${suffix}`;
      return first ? text : `(+${text})`;
    }
    case "number": {
      const text = `${formatNumber(part.value)}${suffix}`;
      return first ? text : `(+${text})`;
    }
    case "levelRange": {
      const range = `${formatNumber(part.from)}-${formatNumber(part.to)}${suffix}`;
      return first ? `${range} (based on level)` : `(+${range} based on level)`;
    }
    case "stat": {
      const text = `${formatRankValues(part.percentByRank)}% ${part.label}`;
      return first ? text : `(+${text})`;
    }
  }
}

/**
 * Render a spell calculation to display text, e.g.
 * "200/350/500 (+70% AP)" or "250-550 (based on level) (+80% bonus AD)".
 * Returns `undefined` when any formula part is not mechanically resolvable.
 */
export function renderCalculation(
  calculationKey: string,
  context: SpellContext,
): string | undefined {
  const parts = renderCalculationParts(calculationKey, context, new Set());
  if (parts === undefined || parts.length === 0) {
    return undefined;
  }
  return parts.map((part, index) => partToString(part, index === 0)).join(" ");
}

// ---------------------------------------------------------------------------
// Tooltip token resolution
// ---------------------------------------------------------------------------

const TOKEN_PATTERN = /\{\{\s*(.*?)\s*\}\}/g;
// e.g. "rdamage", "slowamount*100", "spell.pykeq:totaldamage", "cost*0.5"
const TOKEN_BODY_PATTERN =
  /^(?:spell\.(?<spell>[a-z0-9_]+):)?(?<name>[a-z0-9_]+)(?:\*(?<factor>-?\d+(?:\.\d+)?))?$/i;

export function stripTooltipMarkup(text: string): string {
  return text
    .replaceAll(/<br\s*\/?>/gi, " ")
    .replaceAll(/<[^>]+>/g, "")
    .replaceAll("&nbsp;", " ")
    .replaceAll(/\s+/g, " ")
    .trim();
}

type TooltipResolutionInput = {
  ddragonSpell: DataDragonSpell | undefined;
  /** Resource name from the champion's `partype` (e.g. "Mana"). */
  resourceName: string;
  context: SpellContext;
  /** Lowercased bin spell name → context, for `spell.other:name` tokens. */
  spellContextsByName: ReadonlyMap<string, SpellContext>;
};

function resolveSimpleName(
  name: string,
  input: TooltipResolutionInput,
): string | undefined {
  const lowered = name.toLowerCase();

  if (lowered === "spellmodifierdescriptionappend") {
    // Engine slot for spell-modifier suffixes; empty in the base tooltip.
    return "";
  }
  if (lowered === "abilityresourcename") {
    return input.resourceName;
  }

  const { ddragonSpell } = input;
  if (ddragonSpell !== undefined) {
    if (lowered === "cost") {
      return ddragonSpell.costBurn;
    }
    if (lowered === "cooldown") {
      return ddragonSpell.cooldownBurn;
    }
    if (lowered === "maxrank") {
      return String(ddragonSpell.maxrank);
    }
    const effectMatch = /^e(\d+)$/.exec(lowered);
    if (effectMatch !== null) {
      const index = Number(effectMatch[1]);
      const effect = ddragonSpell.effectBurn[index];
      if (effect !== null && effect !== undefined && effect.length > 0) {
        return effect;
      }
      return undefined;
    }
  }

  const calculated = renderCalculation(lowered, input.context);
  if (calculated !== undefined) {
    return calculated;
  }

  const raw = input.context.dataValues.get(lowered);
  if (raw !== undefined) {
    const values = sliceRanks(raw, input.context.maxRank);
    if (values !== undefined) {
      return formatRankValues(values);
    }
  }

  return undefined;
}

function resolveScaledName(
  name: string,
  factor: number,
  context: SpellContext,
): string | undefined {
  const raw = context.dataValues.get(name.toLowerCase());
  if (raw !== undefined) {
    const values = sliceRanks(raw, context.maxRank);
    if (values !== undefined) {
      return formatRankValues(values.map((value) => value * factor));
    }
  }
  const parts = renderCalculationParts(name.toLowerCase(), context, new Set());
  if (parts !== undefined && parts.length > 0) {
    const scaled = scaleParts(parts, factor);
    return scaled
      .map((part, index) => partToString(part, index === 0))
      .join(" ");
  }
  return undefined;
}

export type ResolvedTooltip = {
  text: string;
  unresolved: string[];
};

/**
 * Substitute every `{{ token }}` in a Data Dragon tooltip that resolves
 * mechanically; leave the rest as literal tokens and report them.
 */
export function resolveTooltip(
  tooltip: string,
  input: TooltipResolutionInput,
): ResolvedTooltip {
  const unresolved: string[] = [];
  const substituted = tooltip.replaceAll(
    TOKEN_PATTERN,
    (match: string, body: string) => {
      const parsed = TOKEN_BODY_PATTERN.exec(body);
      if (parsed?.groups === undefined) {
        unresolved.push(body);
        return match;
      }
      const { spell, name, factor } = parsed.groups;
      if (name === undefined) {
        unresolved.push(body);
        return match;
      }

      let scopedInput = input;
      if (spell !== undefined) {
        const otherContext = input.spellContextsByName.get(spell.toLowerCase());
        if (otherContext === undefined) {
          unresolved.push(body);
          return match;
        }
        scopedInput = {
          ...input,
          ddragonSpell: undefined,
          context: otherContext,
        };
      }

      const resolved =
        factor === undefined
          ? resolveSimpleName(name, scopedInput)
          : resolveScaledName(name, Number(factor), scopedInput.context);
      if (resolved === undefined) {
        unresolved.push(body);
        return match;
      }
      return resolved;
    },
  );

  return { text: stripTooltipMarkup(substituted), unresolved };
}

// ---------------------------------------------------------------------------
// Champion assembly
// ---------------------------------------------------------------------------

function spellContextFrom(
  record: CDragonSpellRecord | undefined,
  maxRank: number,
  effectBurn?: readonly (string | null)[],
): SpellContext {
  const dataValues = new Map<string, readonly number[]>();
  const calculations = new Map<string, CDragonGameCalculation>();
  for (const dataValue of record?.DataValues ?? []) {
    if (dataValue.values !== undefined && dataValue.values.length > 0) {
      dataValues.set(dataValue.name.toLowerCase(), dataValue.values);
    }
  }
  for (const [key, calculation] of Object.entries(
    record?.mSpellCalculations ?? {},
  )) {
    calculations.set(key.toLowerCase(), calculation);
  }
  return {
    dataValues,
    calculations,
    effectRanks: effectRanksFrom(effectBurn),
    maxRank,
  };
}

function lastSegment(path: string): string {
  const segments = path.split("/");
  return segments.at(-1) ?? path;
}

type BinSpells = {
  /** Lowercased full bin key → spell record. */
  byKey: ReadonlyMap<string, CDragonSpellRecord>;
  /** Lowercased final path segment → full keys carrying it. */
  keysBySegment: ReadonlyMap<string, readonly string[]>;
  characterRecord: z.infer<typeof CDragonCharacterRecordSchema>;
};

/**
 * Index a champion bin's SpellObjects and locate its CharacterRecord.
 * Throws on structural surprises — the generator must fail loudly rather
 * than commit silently-empty facts.
 */
export function indexChampionBin(championKey: string, bin: unknown): BinSpells {
  const parsedBin = CDragonChampionBinSchema.parse(bin);
  const byKey = new Map<string, CDragonSpellRecord>();
  const keysBySegment = new Map<string, string[]>();
  let characterRecord: z.infer<typeof CDragonCharacterRecordSchema> | undefined;

  const characterRecordKey = `characters/${championKey.toLowerCase()}/characterrecords/root`;

  const binEntryProbeSchema = z.looseObject({ __type: z.string().optional() });
  for (const [key, value] of Object.entries(parsedBin)) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      continue;
    }
    const typed = binEntryProbeSchema.parse(value);
    if (typed.__type === "SpellObject") {
      const spellObject = CDragonSpellObjectSchema.parse(value);
      const loweredKey = key.toLowerCase();
      byKey.set(loweredKey, spellObject.mSpell ?? {});
      const segment = lastSegment(loweredKey);
      const existing = keysBySegment.get(segment) ?? [];
      keysBySegment.set(segment, [...existing, loweredKey]);
    } else if (
      typed.__type === "CharacterRecord" &&
      key.toLowerCase() === characterRecordKey
    ) {
      characterRecord = CDragonCharacterRecordSchema.parse(value);
    }
  }

  if (characterRecord === undefined) {
    throw new Error(
      `Champion bin for ${championKey} has no ${characterRecordKey} entry`,
    );
  }
  return { byKey, keysBySegment, characterRecord };
}

function findSlotSpell(
  championKey: string,
  binSpells: BinSpells,
  spellName: string | undefined,
  ddragonSpellId: string,
): CDragonSpellRecord | undefined {
  const prefix = `characters/${championKey.toLowerCase()}/spells/`;
  if (spellName !== undefined) {
    const candidate = spellName.toLowerCase().includes("characters/")
      ? spellName.toLowerCase()
      : `${prefix}${spellName.toLowerCase()}`;
    const found = binSpells.byKey.get(candidate);
    if (found !== undefined) {
      return found;
    }
  }
  // Fall back to the Data Dragon spell id, accepted only when unambiguous.
  const bySegment = binSpells.keysBySegment.get(ddragonSpellId.toLowerCase());
  if (
    bySegment !== undefined &&
    bySegment.length === 1 &&
    bySegment[0] !== undefined
  ) {
    return binSpells.byKey.get(bySegment[0]);
  }
  return undefined;
}

const SLOT_ORDER = ["Q", "W", "E", "R"] as const;

export type ChampionAbilityFactsBuild = {
  facts: ChampionAbilityFacts;
  /** Slots whose bin spell could not be located (facts fall back to Data Dragon only). */
  slotsWithoutBinSpell: AbilitySlot[];
};

/**
 * Build one champion's ability-facts file from its committed Data Dragon
 * champion JSON and its CommunityDragon bin. Pure — no filesystem, no network.
 */
export function buildChampionAbilityFacts(input: {
  championKey: string;
  ddragonChampionFile: unknown;
  bin: unknown;
}): ChampionAbilityFactsBuild {
  const { championKey } = input;
  const parsed = DataDragonChampionFileSchema.parse(input.ddragonChampionFile);
  const champion = parsed.data[championKey];
  if (champion === undefined) {
    throw new Error(
      `Data Dragon champion file for ${championKey} has no data.${championKey} record`,
    );
  }

  const binSpells = indexChampionBin(championKey, input.bin);
  const slotsWithoutBinSpell: AbilitySlot[] = [];

  // Slot contexts, plus a by-name registry for `spell.other:name` tokens.
  // Cross-spell tokens only resolve against the champion's four slot spells,
  // whose rank counts are known from Data Dragon — referencing a helper spell
  // whose rank count we cannot know would mean guessing how to slice values.
  const spellContextsByName = new Map<string, SpellContext>();
  const slotRecords: (CDragonSpellRecord | undefined)[] = [];
  for (const [index, ddragonSpell] of champion.spells.entries()) {
    const spellName = binSpells.characterRecord.spellNames?.[index];
    const record = findSlotSpell(
      championKey,
      binSpells,
      spellName,
      ddragonSpell.id,
    );
    slotRecords.push(record);
    if (record !== undefined) {
      const context = spellContextFrom(
        record,
        ddragonSpell.maxrank,
        ddragonSpell.effectBurn,
      );
      spellContextsByName.set(ddragonSpell.id.toLowerCase(), context);
      if (spellName !== undefined) {
        spellContextsByName.set(lastSegment(spellName).toLowerCase(), context);
      }
    }
  }

  const abilities: Partial<Record<AbilitySlot, AbilityFacts>> = {};

  for (const [index, slot] of SLOT_ORDER.entries()) {
    const ddragonSpell = champion.spells[index];
    if (ddragonSpell === undefined) {
      throw new Error(`Champion ${championKey} is missing spell slot ${slot}`);
    }
    const record = slotRecords[index];
    if (record === undefined) {
      slotsWithoutBinSpell.push(slot);
    }
    const context = spellContextFrom(
      record,
      ddragonSpell.maxrank,
      ddragonSpell.effectBurn,
    );
    const resolvedTooltip = resolveTooltip(ddragonSpell.tooltip, {
      ddragonSpell,
      resourceName: champion.partype,
      context,
      spellContextsByName,
    });
    const resolvedCostType = resolveTooltip(ddragonSpell.costType, {
      ddragonSpell,
      resourceName: champion.partype,
      context,
      spellContextsByName,
    });

    const dataValues: Record<string, number[]> = {};
    for (const dataValue of record?.DataValues ?? []) {
      if (dataValue.values === undefined || dataValue.values.length === 0) {
        continue;
      }
      const values = sliceRanks(dataValue.values, ddragonSpell.maxrank);
      if (values !== undefined) {
        dataValues[dataValue.name] = values.map(cleanNumber);
      }
    }

    abilities[slot] = {
      name: ddragonSpell.name,
      maxRank: ddragonSpell.maxrank,
      cooldownByRank: ddragonSpell.cooldown.slice(0, ddragonSpell.maxrank),
      costByRank: ddragonSpell.cost.slice(0, ddragonSpell.maxrank),
      costType: resolvedCostType.text,
      rangeByRank: ddragonSpell.range.slice(0, ddragonSpell.maxrank),
      dataValues,
      resolvedDescription: resolvedTooltip.text,
      unresolved: [
        ...resolvedTooltip.unresolved,
        ...resolvedCostType.unresolved,
      ],
    };
  }

  // Passive: no rank/cost/range data in Data Dragon; bin DataValues sliced at
  // rank 1 (their arrays repeat per rank for passives).
  const passiveKey = binSpells.characterRecord.mCharacterPassiveSpell;
  const passiveRecord =
    passiveKey === undefined
      ? undefined
      : binSpells.byKey.get(passiveKey.toLowerCase());
  if (passiveRecord === undefined) {
    slotsWithoutBinSpell.push("passive");
  }
  const passiveContext = spellContextFrom(passiveRecord, 1);
  const resolvedPassive = resolveTooltip(champion.passive.description, {
    ddragonSpell: undefined,
    resourceName: champion.partype,
    context: passiveContext,
    spellContextsByName,
  });
  const passiveDataValues: Record<string, number[]> = {};
  for (const dataValue of passiveRecord?.DataValues ?? []) {
    if (dataValue.values === undefined || dataValue.values.length === 0) {
      continue;
    }
    const values = sliceRanks(dataValue.values, 1);
    if (values !== undefined) {
      passiveDataValues[dataValue.name] = values.map(cleanNumber);
    }
  }
  abilities.passive = {
    name: champion.passive.name,
    maxRank: 1,
    cooldownByRank: [],
    costByRank: [],
    costType: "No Cost",
    rangeByRank: [],
    dataValues: passiveDataValues,
    resolvedDescription: resolvedPassive.text,
    unresolved: resolvedPassive.unresolved,
  };

  const facts = ChampionAbilityFactsSchema.parse({
    championKey,
    championName: champion.name,
    abilities,
  });
  return { facts, slotsWithoutBinSpell };
}

// ---------------------------------------------------------------------------
// Generation loop + coverage
// ---------------------------------------------------------------------------

export type AbilityFactsCoverage = {
  championsProcessed: number;
  abilitiesTotal: number;
  abilitiesFullyResolved: number;
  abilitiesWithUnresolved: number;
  /** Unresolved token → occurrence count, for the coverage report. */
  unresolvedTokenCounts: Map<string, number>;
  slotsWithoutBinSpell: number;
};

export function emptyCoverage(): AbilityFactsCoverage {
  return {
    championsProcessed: 0,
    abilitiesTotal: 0,
    abilitiesFullyResolved: 0,
    abilitiesWithUnresolved: 0,
    unresolvedTokenCounts: new Map(),
    slotsWithoutBinSpell: 0,
  };
}

export function accumulateCoverage(
  coverage: AbilityFactsCoverage,
  build: ChampionAbilityFactsBuild,
): void {
  coverage.championsProcessed += 1;
  coverage.slotsWithoutBinSpell += build.slotsWithoutBinSpell.length;
  for (const ability of Object.values(build.facts.abilities)) {
    coverage.abilitiesTotal += 1;
    if (ability.unresolved.length === 0) {
      coverage.abilitiesFullyResolved += 1;
    } else {
      coverage.abilitiesWithUnresolved += 1;
      for (const token of ability.unresolved) {
        coverage.unresolvedTokenCounts.set(
          token,
          (coverage.unresolvedTokenCounts.get(token) ?? 0) + 1,
        );
      }
    }
  }
}

export type GenerateAbilityFactsOptions = {
  championKeys: readonly string[];
  assetsDir: string;
  /** Fetch + JSON-parse a champion's CommunityDragon bin. */
  fetchBin: (championKey: string) => Promise<unknown>;
  log?: (line: string) => void;
};

/**
 * Generate `assets/ability-facts/{Key}.json` for every champion. Fails loudly
 * (throws) when ANY champion's bin cannot be fetched or parsed — a silent gap
 * here would let the voice assistant answer from stale or missing facts.
 */
export async function generateAbilityFactsAssets(
  options: GenerateAbilityFactsOptions,
): Promise<AbilityFactsCoverage> {
  const log =
    options.log ??
    ((line: string) => {
      console.log(line);
    });
  const coverage = emptyCoverage();
  const failures: { championKey: string; error: unknown }[] = [];

  for (const championKey of options.championKeys) {
    try {
      const ddragonChampionFile: unknown = await Bun.file(
        `${options.assetsDir}/champion/${championKey}.json`,
      ).json();
      const bin = await options.fetchBin(championKey);
      const build = buildChampionAbilityFacts({
        championKey,
        ddragonChampionFile,
        bin,
      });
      await Bun.write(
        `${options.assetsDir}/ability-facts/${championKey}.json`,
        `${JSON.stringify(build.facts, null, 2)}\n`,
      );
      accumulateCoverage(coverage, build);
      if (coverage.championsProcessed % 20 === 0) {
        log(
          `  Generated ability facts for ${String(coverage.championsProcessed)}/${String(options.championKeys.length)} champions...`,
        );
      }
    } catch (error) {
      failures.push({ championKey, error });
    }
  }

  printCoverageSummary(coverage, log);

  if (failures.length > 0) {
    for (const failure of failures) {
      console.error(
        `❌ Ability facts failed for ${failure.championKey}: ${String(failure.error)}`,
      );
    }
    throw new Error(
      `ability-facts generation failed for ${String(failures.length)} champion(s)`,
    );
  }
  return coverage;
}

export function printCoverageSummary(
  coverage: AbilityFactsCoverage,
  log: (line: string) => void = (line) => {
    console.log(line);
  },
): void {
  log("");
  log("Ability-facts coverage:");
  log(`  champions processed:        ${String(coverage.championsProcessed)}`);
  log(`  abilities total:            ${String(coverage.abilitiesTotal)}`);
  log(
    `  fully resolved:             ${String(coverage.abilitiesFullyResolved)}`,
  );
  log(
    `  with unresolved tokens:     ${String(coverage.abilitiesWithUnresolved)}`,
  );
  log(`  slots without a bin spell:  ${String(coverage.slotsWithoutBinSpell)}`);
  const topTokens = [...coverage.unresolvedTokenCounts.entries()]
    .toSorted((left, right) => right[1] - left[1])
    .slice(0, 20);
  if (topTokens.length > 0) {
    log("  most frequent unresolved tokens:");
    for (const [token, count] of topTokens) {
      log(`    ${String(count).padStart(4)}  ${token}`);
    }
  }
}
