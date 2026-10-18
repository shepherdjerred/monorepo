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
  participantId: z.number().int().positive().nullable(),
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
  items: z.array(z.number().int().nonnegative()).length(7).optional(),
  spells: z.array(z.number().int().nonnegative()).length(2).optional(),
  jungleMinions: StatSchema.optional(),
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
    gameCreation: z.number().int().positive().nullable(),
    completedAt: z.number().int().positive().optional(),
    durationSeconds: z.number().positive().max(86_400),
    participants: z.array(GameResultParticipantSchema).min(2).max(20),
  })
  .superRefine((game, ctx) => {
    if (game.gameCreation === null && game.completedAt === undefined)
      ctx.addIssue({
        code: "custom",
        message: "Result requires an observed creation or completion time",
      });
    const ids = new Set(
      game.participants.flatMap((player) =>
        player.participantId === null ? [] : [player.participantId],
      ),
    );
    if (
      ids.size !==
      game.participants.filter((player) => player.participantId !== null).length
    )
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

/** The stated timestamp for analytical ordering; never manufacture lobby creation. */
export function gameResultTimestamp(result: GameResult): number {
  const timestamp = result.gameCreation ?? result.completedAt;
  if (timestamp === undefined)
    throw new Error("Result has no stated timestamp");
  return timestamp;
}

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
  const completedAt =
    primary.completedAt ??
    compatible.find((candidate) => candidate.completedAt !== undefined)
      ?.completedAt;
  return {
    ...primary,
    gameCreation:
      primary.gameCreation ??
      compatible.find((candidate) => candidate.gameCreation !== null)
        ?.gameCreation ??
      null,
    ...(completedAt === undefined ? {} : { completedAt }),
    participants: primary.participants.map((player) => {
      const enrichments = compatible.flatMap((candidate) =>
        candidate.participants.filter(
          (other) =>
            sameResultParticipant(player, other) &&
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
      const items = enrichments.find(
        (other) => other.items !== undefined,
      )?.items;
      const spells = enrichments.find(
        (other) => other.spells !== undefined,
      )?.spells;
      const jungleMinions = enrichments.find(
        (other) => other.jungleMinions !== undefined,
      )?.jungleMinions;
      return {
        ...player,
        kills: stat("kills"),
        deaths: stat("deaths"),
        assists: stat("assists"),
        gold: stat("gold"),
        damageToChampions: stat("damageToChampions"),
        minions: stat("minions"),
        level: stat("level"),
        ...(items === undefined ? {} : { items }),
        ...(spells === undefined ? {} : { spells }),
        ...(jungleMinions === undefined ? {} : { jungleMinions }),
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
            sameResultParticipant(player, other) &&
            player.teamId === other.teamId &&
            player.championId === other.championId &&
            player.win === other.win &&
            !identitiesConflict(player.identity, other.identity),
        ),
    )
  );
}

/** Scoreboards need not expose Riot's participant number; identities still name players. */
function sameResultParticipant(
  first: GameResult["participants"][number],
  other: GameResult["participants"][number],
): boolean {
  if (first.participantId !== null && other.participantId !== null)
    return first.participantId === other.participantId;
  if (first.identity.kind === "riot" && other.identity.kind === "riot")
    return first.identity.puuid === other.identity.puuid;
  return first.identity.kind === "local" && other.identity.kind === "local"
    ? first.identity.uuid === other.identity.uuid
    : first.teamId === other.teamId &&
        first.championId === other.championId &&
        !identitiesConflict(first.identity, other.identity);
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
