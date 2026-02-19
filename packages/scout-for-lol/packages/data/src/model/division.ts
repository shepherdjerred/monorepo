import { match } from "ts-pattern";
import { z } from "zod";

export const numberOfDivisions = 4;
export type Division = z.infer<typeof DivisionSchema>;
export const DivisionSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
]);

export function parseDivision(input: string): Division | undefined {
  const normalized = input.toUpperCase();
  if (normalized === "IV") {
    return 4;
  }
  if (normalized === "III") {
    return 3;
  }
  if (normalized === "II") {
    return 2;
  }
  if (normalized === "I") {
    return 1;
  }
  return undefined;
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
