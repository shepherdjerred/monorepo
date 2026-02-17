import { match } from "https://esm.sh/ts-pattern@5.0.5";
import { z } from "https://esm.sh/zod@3.22.4";

export const numberOfDivisions = 4;
export type Division = z.infer<typeof DivisionSchema>;
export const DivisionSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
]);

export function parseDivision(input: string): Division | undefined {
  return match(input.toUpperCase())
    .returnType<Division | undefined>()
    .with("IV", () => 4)
    .with("III", () => 3)
    .with("II", () => 2)
    .with("I", () => 1)
    .otherwise(() => undefined);
}

export function divisionToString(division: Division): string {
  return match(division)
    .returnType<string>()
    .with(4, () => "IV")
    .with(3, () => "III")
    .with(2, () => "II")
    .with(1, () => "I")
    .exhaustive();
}
