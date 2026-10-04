import {
  parseLane,
  type Lane,
  type ScoutClientObservation,
} from "@scout-for-lol/data";
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
const LobbyTeamAssignmentsSchema = z.object({
  members: z.array(
    z.object({
      puuid: z.string().min(1).optional(),
      summonerPuuid: z.string().min(1).optional(),
      teamId: z.number().int(),
    }),
  ),
});
const MatchTimingSchema = z.object({
  gameEndTimestamp: z.number().int().positive(),
});
const MatchBundleTimingSchema = z.object({ timing: MatchTimingSchema });
const MatchV5TimingSchema = z.object({ info: MatchTimingSchema });
const GameflowSessionSchema = z.object({ phase: z.string() });

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
  if (observation.kind !== "gameflow") {
    return null;
  }
  const data = observationData(observation.payload);
  const phase =
    resource === "gameflow_phase"
      ? data
      : resource === "gameflow_session"
        ? GameflowSessionSchema.safeParse(data).data?.phase
        : null;
  if (phase === "InProgress") return "PLAYING";
  return phase === "PreEndOfGame" ||
    phase === "WaitingForStats" ||
    phase === "EndOfGame"
    ? "RESULT_PENDING"
    : null;
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

function observedLobbyTeams(payload: unknown): {
  readonly blue: ReadonlySet<string>;
  readonly red: ReadonlySet<string>;
} | null {
  const parsed = LobbyTeamAssignmentsSchema.safeParse(observationData(payload));
  if (!parsed.success) return null;
  const blue = new Set<string>();
  const red = new Set<string>();
  for (const member of parsed.data.members) {
    const puuid = member.puuid ?? member.summonerPuuid;
    if (puuid === undefined) return null;
    // LCU lobby members use 0/1, while Match-V5 evidence uses 100/200.
    // Accept both representations because the side, rather than the source
    // representation, is what authenticates a scheduled lobby binding.
    if (member.teamId === 0 || member.teamId === 100) {
      blue.add(puuid);
    } else if (member.teamId === 1 || member.teamId === 200) {
      red.add(puuid);
    } else {
      return null;
    }
  }
  return { blue, red };
}

/** Require every scheduled Custom participant to occupy the assigned side. */
export function observedLobbyMatchesCustomTeams(
  payload: unknown,
  expected: readonly {
    readonly puuid: string;
    readonly side: string | null;
  }[],
): boolean {
  const observed = observedLobbyTeams(payload);
  if (observed === null) return false;
  const blue = expected.filter((participant) => participant.side === "BLUE");
  const red = expected.filter((participant) => participant.side === "RED");
  return (
    blue.length + red.length === expected.length &&
    sameRoster(observed.blue, blue) &&
    sameRoster(observed.red, red)
  );
}

/** Require each duel competitor to remain intact on one opposing lobby side. */
export function observedLobbyMatchesDuelTeams(
  payload: unknown,
  competitorOne: readonly { readonly puuid: string }[],
  competitorTwo: readonly { readonly puuid: string }[],
): boolean {
  const observed = observedLobbyTeams(payload);
  return (
    observed !== null &&
    ((sameRoster(observed.blue, competitorOne) &&
      sameRoster(observed.red, competitorTwo)) ||
      (sameRoster(observed.blue, competitorTwo) &&
        sameRoster(observed.red, competitorOne)))
  );
}

function customMapId(map: string): number | null {
  if (map === "SUMMONERS_RIFT") return 11;
  return map === "HOWLING_ABYSS" ? 12 : null;
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

/** End boundary used to ignore lobbies created only after this game finished. */
export function observedMatchEndedAt(
  observation: ScoutClientObservation,
): Date {
  const data = observationData(observation.payload);
  const bundle = MatchBundleTimingSchema.safeParse(data);
  if (bundle.success) {
    return new Date(bundle.data.timing.gameEndTimestamp);
  }
  const match = MatchV5TimingSchema.safeParse(data);
  return new Date(
    match.success ? match.data.info.gameEndTimestamp : observation.capturedAt,
  );
}

/**
 * A bot the local client saw occupying a custom-game slot.
 *
 * Riot's Spectator API omits bots from `participants` entirely, so a custom
 * against nine of them reports one player for the whole match. The LCU lobby
 * is the only place they appear.
 */
export type ObservedLobbyBot = {
  readonly side: "blue" | "red";
  readonly championId: number;
  /** The slot the bot was assigned, when it maps to a standard lane. */
  readonly lane: Lane | undefined;
};

/**
 * The bot's own fields. A lobby member carries `botChampionId: 0` and
 * `botPosition: "NONE"` when it is a human, so `isBot` is what separates them
 * rather than the presence of the keys.
 */
const LobbyBotSchema = z.object({
  isBot: z.literal(true),
  botChampionId: z.number().int().positive(),
  botPosition: z.string().min(1),
});

/**
 * Custom lobbies assign a side by which array holds the slot, not by `teamId`:
 * every entry in both arrays reports `teamId: 0`.
 */
const LobbyCustomTeamsSchema = z.object({
  gameConfig: z.object({
    customTeam100: z.array(z.unknown()),
    customTeam200: z.array(z.unknown()),
  }),
});

/**
 * The bots in an observed custom lobby, in slot order per side.
 *
 * Returns an empty list for a lobby with no bots and for any payload that is
 * not a custom lobby. A human slot is skipped rather than rejected: the lobby
 * does not say which champion a human picked, so they are only knowable from
 * the Spectator roster, which reports them in full.
 */
export function observedLobbyBots(
  payload: unknown,
): readonly ObservedLobbyBot[] {
  const parsed = LobbyCustomTeamsSchema.safeParse(observationData(payload));
  if (!parsed.success) return [];
  const sides = [
    { side: "blue", slots: parsed.data.gameConfig.customTeam100 },
    { side: "red", slots: parsed.data.gameConfig.customTeam200 },
  ] as const;
  return sides.flatMap(({ side, slots }) =>
    slots.flatMap((slot) => {
      const bot = LobbyBotSchema.safeParse(slot);
      if (!bot.success) return [];
      return [
        {
          side,
          championId: bot.data.botChampionId,
          lane: parseLane(bot.data.botPosition),
        },
      ];
    }),
  );
}
