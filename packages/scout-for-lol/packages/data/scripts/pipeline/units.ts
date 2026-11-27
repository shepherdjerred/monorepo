// Units: build the state of each unit, taking pass 1's tips from an earlier
// review set when it has them (so tip ids, and Jerred's marks on them, carry
// over) and leaving the rest to be generated.

import { z } from "zod";
import type { ChampionId } from "#src/model/core/identifiers.ts";
import type { Lane } from "#src/model/riot/lane.ts";
import { ComboSchema } from "#src/tips/combos/combo-schema.ts";
import type { Cite } from "#src/tips/schema.ts";
import { loadChampionGrounding } from "#src/tips/grounding.ts";
import { type WikiClient, prefetchChampionWiki } from "#src/tips/wiki.ts";
import type { SetState, TipState, UnitState } from "./state.ts";

const ReviewTipSchema = z.object({
  id: z.string(),
  text: z.string(),
  abilityRefs: z
    .array(
      z.object({
        champion: z.number(),
        slot: z.enum(["passive", "Q", "W", "E", "R"]),
        name: z.string(),
      }),
    )
    .optional(),
});
export const ReviewUnitSchema = z.object({
  id: z.string(),
  key: z.string().optional(),
  kind: z.enum(["general", "matchup"]),
  champion: z.string(),
  lane: z.string(),
  opponent: z.string().optional(),
  direction: z.enum(["forward", "reverse"]).optional(),
  model: z.string(),
  tips: z.array(ReviewTipSchema),
  combos: z.array(ComboSchema).optional(),
});
export type ReviewUnit = z.infer<typeof ReviewUnitSchema>;

/** The short label a model gets in unit and tip ids. */
export function modelShort(model: string): string {
  return model.includes("opus")
    ? "opus"
    : model.includes("haiku")
      ? "haiku"
      : "sonnet";
}

export async function readReviewSet(
  path: string,
  model: string,
): Promise<ReviewUnit[]> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    return [];
  }
  return z
    .array(ReviewUnitSchema)
    .parse(await file.json())
    .filter((unit) => unit.model === model);
}

function tipState(
  unit: ReviewUnit["tips"][number],
  setId: string,
  index: number,
): TipState {
  return {
    id: unit.id,
    text: unit.text,
    cites: (unit.abilityRefs ?? []).map((ref): Cite => ({
      kind: "ability",
      champion: ref.champion as ChampionId,
      slot: ref.slot,
      name: ref.name,
    })),
    basis: [],
    history: [{ pass: "generate", origin: "review-set", index, set: setId }],
    status: "live",
  };
}

export function emptySet(
  id: string,
  subject: UnitState["groundings"][number],
  opponent?: UnitState["groundings"][number],
  side?: "forward" | "reverse",
): SetState {
  return {
    id,
    subject,
    opponent,
    side,
    tips: [],
    nextIndex: 0,
    combos: [],
    comboRefs: [],
  };
}

export async function loadUnit(input: {
  wiki: WikiClient;
  lane: Lane;
  championIds: readonly ChampionId[];
  model: string;
  earlier: readonly ReviewUnit[];
  /** The earlier tips are a subset; a side without any is not a failure. */
  partial?: boolean;
}): Promise<UnitState> {
  const groundings = await Promise.all(
    input.championIds.map((id) => loadChampionGrounding(id)),
  );
  const pre = await prefetchChampionWiki(
    input.wiki,
    groundings.map((grounding) => grounding.name),
  );
  const names = groundings.map((grounding) => grounding.name).join("-vs-");
  const id = `${modelShort(input.model)}:${input.lane}:${names}`;
  const [first, second] = groundings;
  if (first === undefined) {
    throw new Error("a unit has no champion");
  }
  const sides: SetState[] =
    second === undefined
      ? [emptySet(id, first)]
      : [
          emptySet(`${id}:forward`, first, second, "forward"),
          emptySet(`${id}:reverse`, second, first, "reverse"),
        ];
  let origin: UnitState["origin"] = "generated";
  for (const set of sides) {
    const earlier = input.earlier.find((unit) => unit.id === set.id);
    if (earlier === undefined) {
      continue;
    }
    origin = "review-set";
    set.tips = earlier.tips.map((tip, index) => tipState(tip, set.id, index));
    set.nextIndex = earlier.tips.length;
  }
  if (input.partial !== true && sides.some((set) => set.tips.length === 0)) {
    // A pair is generated whole: a side without tips means the unit failed earlier.
    origin = "generated";
    for (const set of sides) {
      set.tips = [];
      set.nextIndex = 0;
    }
  }
  return {
    id,
    lane: input.lane,
    groundings,
    notes: pre.notes,
    pages: pre.pages,
    sets: sides,
    glossary: [],
    origin,
  };
}
