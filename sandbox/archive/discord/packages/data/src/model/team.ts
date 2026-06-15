import { match } from "https://esm.sh/ts-pattern@5.0.5";
import { z } from "https://esm.sh/zod@3.22.4";

export type Team = z.infer<typeof TeamSchema>;
export const TeamSchema = z.enum(["red", "blue"]);

export function invertTeam(team: Team) {
  return match(team)
    .returnType<Team>()
    .with("red", () => "blue")
    .with("blue", () => "red")
    .exhaustive();
}

export function parseTeam(input: number) {
  return match(input)
    .returnType<Team | undefined>()
    .with(100, () => "blue")
    .with(200, () => "red")
    .otherwise(() => undefined);
}
