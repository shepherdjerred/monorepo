import { z } from "zod";

const IntegerString = z.string().regex(/^\d+$/).transform(Number);

export const TypeGameIndexRows = z.array(
  z.object({
    type_id: IntegerString,
    generation_id: IntegerString,
    game_index: IntegerString,
  }),
);

const GENERATION_3_PHYSICAL_TYPES = new Set([
  "normal",
  "fighting",
  "flying",
  "poison",
  "ground",
  "rock",
  "bug",
  "ghost",
  "steel",
]);
const STATUS_DAMAGE_CLASS_ID = 1;
const PHYSICAL_DAMAGE_CLASS_ID = 2;
const SPECIAL_DAMAGE_CLASS_ID = 3;

export function generation3DamageClass(
  type: string,
  damageClassId: number,
): "physical" | "special" | "status" {
  if (damageClassId === STATUS_DAMAGE_CLASS_ID) return "status";
  if (
    damageClassId !== PHYSICAL_DAMAGE_CLASS_ID &&
    damageClassId !== SPECIAL_DAMAGE_CLASS_ID
  ) {
    throw new Error(
      `unknown PokeAPI move damage class id ${String(damageClassId)}`,
    );
  }
  return GENERATION_3_PHYSICAL_TYPES.has(type) ? "physical" : "special";
}

export function generation3PowerLabel(
  power: number | undefined,
  damageClass: "physical" | "special" | "status",
): string {
  if (power !== undefined) return String(power);
  return damageClass === "status" ? "status" : "fixed or variable";
}
