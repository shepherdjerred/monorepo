import { match } from "https://esm.sh/ts-pattern@5.0.5";
import { z } from "https://esm.sh/zod@3.22.4";

export type Lane = z.infer<typeof LaneSchema>;
export const LaneSchema = z.enum(["top", "jungle", "middle", "adc", "support"]);

export function parseLane(input: string): Lane | undefined {
  return match(input.toLowerCase())
    .returnType<Lane | undefined>()
    .with("middle", () => "middle")
    .with("top", () => "top")
    .with("jungle", () => "jungle")
    .with("bottom", () => "adc")
    .with("utility", () => "support")
    .otherwise(() => undefined);
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
