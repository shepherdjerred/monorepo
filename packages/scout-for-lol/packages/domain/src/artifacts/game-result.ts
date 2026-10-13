import { z } from "zod";
import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";

/** Player namespaces remain explicit until Riot has resolved an identity. */
export const ParticipantIdentitySchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("riot"), puuid: z.string().length(78) }),
  z.strictObject({ kind: z.literal("local"), uuid: z.uuid() }),
  z.strictObject({ kind: z.literal("bot") }),
  z.strictObject({ kind: z.literal("unresolved") }),
]);

const StatSchema = z.number().int().nonnegative().nullable();
export const GameResultParticipantSchema = z.strictObject({
  participantId: z.number().int().positive(),
  teamId: z.number().int().positive(),
  identity: ParticipantIdentitySchema,
  championId: z.number().int().nonnegative(),
  name: z.string().nullable(),
  win: z.boolean(),
  kills: StatSchema,
  deaths: StatSchema,
  assists: StatSchema,
  gold: StatSchema,
  damageToChampions: StatSchema,
  minions: StatSchema,
  level: StatSchema,
});

/** Facts a result can state without manufacturing Match-V5 statistics. */
export const GameResultSchema = z
  .strictObject({
    matchId: RiotMatchIdSchema,
    source: z.enum(["RIOT", "SCOUT_CLIENT"]),
    sourceId: z.string().min(1),
    queueId: z.number().int().nonnegative(),
    gameMode: z.string().min(1),
    gameType: z.string().min(1),
    gameCreation: z.number().int().positive(),
    durationSeconds: z.number().positive().max(86_400),
    participants: z.array(GameResultParticipantSchema).min(2).max(20),
  })
  .superRefine((game, ctx) => {
    const ids = new Set(
      game.participants.map((player) => player.participantId),
    );
    if (ids.size !== game.participants.length)
      ctx.addIssue({ code: "custom", message: "Duplicate participant IDs" });
    const teams = new Map<number, boolean>();
    for (const player of game.participants) {
      const previous = teams.get(player.teamId);
      if (previous !== undefined && previous !== player.win)
        ctx.addIssue({ code: "custom", message: "Conflicting team outcomes" });
      teams.set(player.teamId, player.win);
    }
    if (
      teams.size < 2 ||
      ![...teams.values()].includes(true) ||
      ![...teams.values()].includes(false)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Result must identify winning and losing sides",
      });
    }
  });
export type GameResult = z.infer<typeof GameResultSchema>;

/** Riot owns overlapping facts; compatible client evidence fills absent stats. */
export function resolveGameResult(
  results: readonly GameResult[],
  frozen?: GameResult,
): GameResult | null {
  if (frozen !== undefined) return frozen;
  const ordered = [...results].sort(
    (left, right) =>
      Number(right.source === "RIOT") - Number(left.source === "RIOT") ||
      left.sourceId.localeCompare(right.sourceId),
  );
  const primary = ordered[0];
  if (primary === undefined) return null;
  const peers = ordered.filter(
    (candidate) => candidate.source === primary.source,
  );
  if (peers.some((candidate) => resultOutcomesConflict(primary, candidate)))
    return null;
  const compatible = ordered.filter(
    (candidate) => !resultOutcomesConflict(primary, candidate),
  );
  return {
    ...primary,
    participants: primary.participants.map((player) => {
      const enrichments = compatible.flatMap((candidate) =>
        candidate.participants.filter(
          (other) =>
            other.participantId === player.participantId &&
            other.teamId === player.teamId &&
            other.championId === player.championId &&
            other.win === player.win &&
            JSON.stringify(other.identity) === JSON.stringify(player.identity),
        ),
      );
      const stat = (
        key:
          | "kills"
          | "deaths"
          | "assists"
          | "gold"
          | "damageToChampions"
          | "minions"
          | "level",
      ) => enrichments.find((other) => other[key] !== null)?.[key] ?? null;
      return {
        ...player,
        kills: stat("kills"),
        deaths: stat("deaths"),
        assists: stat("assists"),
        gold: stat("gold"),
        damageToChampions: stat("damageToChampions"),
        minions: stat("minions"),
        level: stat("level"),
      };
    }),
  };
}

/** Equal-authority contradictions stay unresolved until stronger evidence arrives. */
function resultOutcomesConflict(
  first: GameResult,
  candidate: GameResult,
): boolean {
  const metadataConflict =
    first.matchId !== candidate.matchId ||
    first.queueId !== candidate.queueId ||
    first.gameMode !== candidate.gameMode ||
    first.gameType !== candidate.gameType ||
    first.participants.length !== candidate.participants.length;
  return (
    metadataConflict ||
    first.participants.some(
      (player) =>
        !candidate.participants.some(
          (other) =>
            player.participantId === other.participantId &&
            player.teamId === other.teamId &&
            player.championId === other.championId &&
            player.win === other.win &&
            !identitiesConflict(player.identity, other.identity),
        ),
    )
  );
}

function identitiesConflict(
  first: GameResult["participants"][number]["identity"],
  second: GameResult["participants"][number]["identity"],
): boolean {
  // An unresolved namespace or an unlinked local UUID cannot prove a contradiction.
  if (first.kind === "unresolved" || second.kind === "unresolved") return false;
  if (first.kind === "riot" && second.kind === "riot")
    return first.puuid !== second.puuid;
  return first.kind === "local" && second.kind === "local"
    ? first.uuid !== second.uuid
    : (first.kind === "bot") !== (second.kind === "bot");
}
