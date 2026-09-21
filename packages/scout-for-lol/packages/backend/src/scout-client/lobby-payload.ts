import type { ScoutClientObservation } from "@scout-for-lol/data";
import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import { z } from "zod";

type ObservedGameState = "PLAYING" | "RESULT_PENDING";

const ResourcePayloadSchema = z.object({ resource: z.string() });
const DataPayloadSchema = z.object({ data: z.unknown() });
const LobbyConfigurationSchema = z.object({
  gameConfig: z.object({
    mapId: z.number().int(),
    pickType: z.string().min(1),
  }),
});

function observationResource(payload: unknown): string | null {
  const parsed = ResourcePayloadSchema.safeParse(payload);
  return parsed.success ? parsed.data.resource : null;
}

function observationData(payload: unknown): unknown {
  const parsed = DataPayloadSchema.safeParse(payload);
  return parsed.success ? parsed.data.data : payload;
}

/** Map only explicit League lifecycle evidence to a Scout game transition. */
export function observedGameState(
  observation: ScoutClientObservation,
): ObservedGameState | null {
  if (observation.kind === "live_game_frame") return "PLAYING";
  const resource = observationResource(observation.payload);
  if (resource === "post_game" && observation.kind === "post_game") {
    return "RESULT_PENDING";
  }
  if (resource !== "gameflow_phase" || observation.kind !== "gameflow") {
    return null;
  }
  const data = observationData(observation.payload);
  if (data === "InProgress") return "PLAYING";
  if (
    data === "PreEndOfGame" ||
    data === "WaitingForStats" ||
    data === "EndOfGame"
  ) {
    return "RESULT_PENDING";
  }
  return null;
}

function collectPuuids(value: unknown, into: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectPuuids(item, into);
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (
      typeof item === "string" &&
      item.length > 0 &&
      (key === "puuid" || key === "summonerPuuid")
    ) {
      into.add(item);
    }
    collectPuuids(item, into);
  }
}

/** Extract the participant identity set from a bounded lobby observation. */
export function lobbyParticipantPuuids(payload: unknown): ReadonlySet<string> {
  const puuids = new Set<string>();
  collectPuuids(payload, puuids);
  return puuids;
}

export function sameRoster(
  observed: ReadonlySet<string>,
  expected: readonly { readonly puuid: string }[],
): boolean {
  return (
    observed.size === expected.length &&
    expected.every((participant) => observed.has(participant.puuid))
  );
}

function customMapId(map: string): number | null {
  if (map === "SUMMONERS_RIFT") return 11;
  if (map === "HOWLING_ABYSS") return 12;
  return null;
}

function normalizedPickMode(value: string): string {
  return value.replaceAll(/[^a-z0-9]/gi, "").toUpperCase();
}

/** Require the observed LCU lobby to implement the scheduled game rules. */
export function observedLobbyMatchesCustomSettings(
  payload: unknown,
  expected: { readonly map: string; readonly pickMode: string },
): boolean {
  const parsed = LobbyConfigurationSchema.safeParse(observationData(payload));
  const expectedMapId = customMapId(expected.map);
  return (
    parsed.success &&
    expectedMapId !== null &&
    parsed.data.gameConfig.mapId === expectedMapId &&
    normalizedPickMode(parsed.data.gameConfig.pickType) ===
      normalizedPickMode(expected.pickMode)
  );
}

/** Duels retain the rules previously enforced by tournament provisioning. */
export function observedLobbyMatchesDuelSettings(payload: unknown): boolean {
  return observedLobbyMatchesCustomSettings(payload, {
    map: "SUMMONERS_RIFT",
    pickMode: "TOURNAMENT_DRAFT",
  });
}

/** Extract the authoritative Riot match identity from live post-game evidence. */
export function observedPostGameMatchId(
  observation: ScoutClientObservation,
): string | null {
  if (
    observation.kind !== "post_game" ||
    observationResource(observation.payload) !== "post_game" ||
    observation.platformId === undefined ||
    observation.gameId === undefined
  ) {
    return null;
  }
  const parsed = RiotMatchIdSchema.safeParse(
    `${observation.platformId.toUpperCase()}_${observation.gameId}`,
  );
  return parsed.success ? parsed.data : null;
}
