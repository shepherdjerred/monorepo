import { match } from "ts-pattern";
import { z } from "zod";

export type Team = z.infer<typeof TeamSchema>;
export const TeamSchema = z.enum(["red", "blue"]);

export function invertTeam(team: Team) {
  return match(team)
    .returnType<Team>()
    .with("red", () => "blue")
    .with("blue", () => "red")
    .exhaustive();
}

export function parseTeam(input: number): Team | undefined {
  if (input === 100) {
    return "blue";
  }
  if (input === 200) {
    return "red";
  }
  return undefined;
}
