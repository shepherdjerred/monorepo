import { match } from "ts-pattern";
import { z } from "zod";

export type Lane = z.infer<typeof LaneSchema>;
export const LaneSchema = z.enum(["top", "jungle", "middle", "adc", "support"]);

export function parseLane(input: string): Lane | undefined {
  const normalized = input.toLowerCase();
  if (normalized === "middle") {
    return "middle";
  }
  if (normalized === "top") {
    return "top";
  }
  if (normalized === "jungle") {
    return "jungle";
  }
  if (normalized === "bottom") {
    return "adc";
  }
  if (normalized === "utility") {
    return "support";
  }
  return undefined;
}

export function laneToString(lane: Lane): string {
  return match(lane)
    .with("middle", () => "Mid")
    .with("top", () => "Top")
    .with("jungle", () => "Jungle")
    .with("adc", () => "ADC")
    .with("support", () => "Support")
    .exhaustive();
}
