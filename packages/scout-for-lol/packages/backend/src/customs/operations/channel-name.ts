import { createHash } from "node:crypto";

export function customTeamChannelName(
  operationId: string,
  sequence: number,
  team: "A" | "B",
): string {
  return `Customs ${sequence.toString()} — Team ${team} · ${createHash("sha256").update(operationId).digest("hex").slice(0, 8)}`;
}
