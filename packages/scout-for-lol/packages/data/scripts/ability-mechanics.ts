/**
 * Ability mechanics from CommunityDragon champion bins: how an ability is
 * aimed and how its missiles travel and collide. Data Dragon's tooltips omit
 * all of it, and it is what separates "passes through minions" from "stops at
 * the first enemy".
 *
 * Only fields the bin states outright are read; a missing or unfamiliar field
 * is null, never inferred. The bitmask fields (`mAffectsTypeFlags`) are not
 * decoded because their meaning is not documented.
 */

import { z } from "zod";
import type { AbilityMechanics } from "#src/data-dragon/ability-facts.ts";
import type { CDragonSpellRecord } from "./update-data-dragon-schemas.ts";

const NumberSchema = z.number();
const NumberListSchema = z.array(z.number());
const TypedSchema = z.looseObject({ __type: z.string() });

const MovementSchema = z.looseObject({
  __type: z.string(),
  mSpeed: z.number().optional(),
  mInitialSpeed: z.number().optional(),
  mMinSpeed: z.number().optional(),
  mMaxSpeed: z.number().optional(),
  mTracksTarget: z.boolean().optional(),
});

const MissileSpecSchema = z.looseObject({
  mMissileWidth: z.number().optional(),
  movementComponent: MovementSchema.optional(),
  behaviors: z.array(TypedSchema).optional(),
});

function field<T>(
  record: CDragonSpellRecord,
  name: string,
  schema: z.ZodType<T>,
): T | undefined {
  const parsed = schema.safeParse(record[name]);
  return parsed.success ? parsed.data : undefined;
}

type Round = (value: number) => number;

function clean(value: number | undefined, round: Round): number | null {
  return value === undefined ? null : round(value);
}

/** The bin's lowercased spell keys that sit under the same ability as `key`, other than `key`. */
function siblingKeys(
  spells: ReadonlyMap<string, CDragonSpellRecord>,
  key: string,
): string[] {
  const parent = key.slice(0, key.lastIndexOf("/"));
  // Only a spell nested under an ability object (`characters/<c>/spells/<ability>/<spell>`)
  // has siblings; a spell directly under `spells/` shares its folder with every
  // other spell of the champion, and pairing them by name would be a guess.
  if (parent.split("/").length < 4) {
    return [];
  }
  return [...spells.keys()].filter(
    (other) => other !== key && other.startsWith(`${parent}/`),
  );
}

function missileOf(
  name: string,
  record: CDragonSpellRecord,
  round: Round,
): AbilityMechanics["missiles"][number] | undefined {
  const spec = field(record, "mMissileSpec", MissileSpecSchema);
  if (spec === undefined) {
    return undefined;
  }
  const movement = spec.movementComponent;
  const behaviors = (spec.behaviors ?? []).map((entry) => entry.__type);
  return {
    name,
    width: clean(spec.mMissileWidth, round),
    movement: movement?.__type ?? null,
    speed: clean(movement?.mSpeed ?? movement?.mInitialSpeed, round),
    minSpeed: clean(movement?.mMinSpeed, round),
    maxSpeed: clean(movement?.mMaxSpeed, round),
    tracksTarget: movement?.mTracksTarget ?? false,
    behaviors,
    stopsOnFirstHit: behaviors.includes("DestroyOnHit"),
  };
}

/**
 * Mechanics of one ability: its own aiming data and every missile spell that
 * sits under the same ability object in the bin. `undefined` when the bin
 * states nothing about it.
 */
export function buildAbilityMechanics(
  spells: ReadonlyMap<string, CDragonSpellRecord>,
  key: string,
  /** The generator's float32-noise rounding (`cleanNumber`). */
  round: Round,
): AbilityMechanics | undefined {
  const record = spells.get(key);
  if (record === undefined) {
    return undefined;
  }
  const missiles = siblingKeys(spells, key).flatMap((other) => {
    const sibling = spells.get(other);
    const missile =
      sibling === undefined
        ? undefined
        : missileOf(other.slice(other.lastIndexOf("/") + 1), sibling, round);
    return missile === undefined ? [] : [missile];
  });
  const radius = field(record, "castRadius", NumberListSchema)?.[0];
  const targeting = field(record, "mTargetingTypeData", TypedSchema)?.__type;
  const mechanics: AbilityMechanics = {
    targeting: targeting ?? null,
    castTime: clean(field(record, "mCastTime", NumberSchema), round),
    radius: clean(radius, round),
    lineWidth: clean(field(record, "mLineWidth", NumberSchema), round),
    missileSpeed: clean(field(record, "missileSpeed", NumberSchema), round),
    missiles: missiles.toSorted((left, right) =>
      left.name < right.name ? -1 : 1,
    ),
  };
  const empty =
    mechanics.targeting === null &&
    mechanics.castTime === null &&
    mechanics.radius === null &&
    mechanics.lineWidth === null &&
    mechanics.missileSpeed === null &&
    mechanics.missiles.length === 0;
  return empty ? undefined : mechanics;
}
