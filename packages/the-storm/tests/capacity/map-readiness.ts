import { Lifecycle } from "#maps/lifecycle.ts";
import { z } from "zod";
import { eventually, status } from "#e2e/harness/rwf-match.ts";
import type { RconClient } from "#e2e/harness/rcon.ts";

const Preparation = Lifecycle.safeExtend({
  maps: z.array(Lifecycle.shape.maps.element).min(1),
});

/** Preparing the ordinary vote is safe only before any participant or bot arrives. */
export function emptyCapacityLobby(current: {
  ready: boolean;
  phase: string;
  humans: number;
  bots: number;
  arriving: number;
}): boolean {
  return (
    current.ready &&
    current.phase === "Lobby" &&
    current.humans === 0 &&
    current.bots === 0 &&
    current.arriving === 0
  );
}

/** A refused command cannot count as preparation; private capacity catalogs may contain one map. */
export function verifyCapacityMapPreparation(reply: string, map: string): void {
  const prepared = Preparation.parse(JSON.parse(reply));
  if (prepared.maps.filter((entry) => entry.id === map).length !== 1)
    throw new Error("Capacity preparation did not identify the requested map");
}

/** Ordinary empty-lobby preparation admits terrain and navigation before the zero-bot baseline. */
export async function prepareEmptyCapacityMap(
  rcon: RconClient,
  map: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  await eventually(
    "empty lobby before ordinary map preparation",
    async () => emptyCapacityLobby(await status(rcon)),
    timeoutMs,
  );
  verifyCapacityMapPreparation(
    await rcon.command("storm-fixture-map-lifecycle prepare"),
    map,
  );
  await eventually(
    "ready empty admitted-map lobby",
    async () => {
      const current = await status(rcon);
      return emptyCapacityLobby(current) && current.map === map;
    },
    Math.max(0, deadline - Date.now()),
  );
}
