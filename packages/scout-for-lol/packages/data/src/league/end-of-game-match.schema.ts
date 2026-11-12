import { z } from "zod";
import { SCOUT_CLIENT_END_OF_GAME_DATA_VERSION } from "./data-source.ts";
import { checkStoredIdentities } from "./participant-identity.ts";
import {
  RawMetadataSchema,
  RawMatchSchema,
  type RawMatch,
} from "./raw-match.schema.ts";
import {
  RawParticipantSchema,
  type RawParticipant,
} from "./raw-participant.schema.ts";
import { RawBanSchema } from "./raw-team.schema.ts";

/**
 * The end-of-game canonical record: a game Scout knows only from the League
 * client's end-of-game block and the same device's gameflow session, because
 * the client served no match history for it (common for League Classic).
 *
 * It keeps Match-V5's field names so a consumer reading a stat it states reads
 * it the same way, but it is not a Match-V5 document. Whatever the block does
 * not state is `null`, never zero: the participant numbers, the game's
 * creation time and version, the bans unless gameflow states them, Rift
 * Herald, Voidgrub and Atakhan kills, feats, and any "first" the stated counts
 * and player flags cannot decide. There is no timeline.
 *
 * Consumers opt in through {@link CanonicalMatch}; a `RawMatch` consumer never
 * receives one.
 */

/** An objective whose kills the block states, as team totals of player stats. */
const StatedObjectiveSchema = z
  .object({ first: z.boolean().nullable(), kills: z.number() })
  .strict();

/** An objective no player stat counts. */
const UnstatedObjectiveSchema = z
  .object({ first: z.null(), kills: z.null() })
  .strict();

const EndOfGameTeamSchema = z
  .object({
    bans: z.array(RawBanSchema).nullable(),
    objectives: z
      .object({
        baron: StatedObjectiveSchema,
        champion: StatedObjectiveSchema,
        dragon: StatedObjectiveSchema,
        inhibitor: StatedObjectiveSchema,
        tower: StatedObjectiveSchema,
        riftHerald: UnstatedObjectiveSchema,
        horde: UnstatedObjectiveSchema,
        atakhan: UnstatedObjectiveSchema,
      })
      .strict(),
    feats: z.null(),
    teamId: z.number(),
    win: z.boolean(),
  })
  .strict();

export const EndOfGameParticipantSchema = RawParticipantSchema.extend({
  participantId: z.null(),
});

export const EndOfGameMatchSchema = z
  .object({
    metadata: RawMetadataSchema.extend({
      dataVersion: z.literal(SCOUT_CLIENT_END_OF_GAME_DATA_VERSION),
    }),
    info: z
      .object({
        endOfGameResult: z.literal("GameComplete"),
        gameCreation: z.null(),
        gameDuration: z.number().positive(),
        gameEndTimestamp: z.number().int().positive(),
        gameId: z.number().int().positive(),
        gameMode: z.string().min(1),
        gameStartTimestamp: z.number().int().positive(),
        gameType: z.string().min(1),
        gameVersion: z.null(),
        mapId: z.number().int().positive(),
        participants: z.array(EndOfGameParticipantSchema).min(2),
        platformId: z.string().min(1),
        queueId: z.number().int().nonnegative(),
        teams: z.array(EndOfGameTeamSchema).min(2),
      })
      .strict(),
  })
  .strict()
  .superRefine((match, ctx) => {
    checkStoredIdentities(
      {
        scoutBuilt: true,
        metadataParticipants: match.metadata.participants,
        participants: match.info.participants,
      },
      ctx,
    );
  });

export type EndOfGameMatch = z.infer<typeof EndOfGameMatchSchema>;
export type EndOfGameParticipant = z.infer<typeof EndOfGameParticipantSchema>;
export type EndOfGameTeam = z.infer<typeof EndOfGameTeamSchema>;

/** A stored match of either coverage. Consumers opt in to this union. */
export type CanonicalMatch = RawMatch | EndOfGameMatch;
export type CanonicalParticipant = RawParticipant | EndOfGameParticipant;

/**
 * A stored match with its coverage stated beside it, so a reader that needs
 * one coverage switches on `coverage` rather than inspecting the document.
 */
export type CanonicalMatchRecord =
  | { readonly coverage: "complete"; readonly match: RawMatch }
  | { readonly coverage: "end_of_game"; readonly match: EndOfGameMatch };

const DataVersionSchema = z.looseObject({
  metadata: z.looseObject({ dataVersion: z.string() }),
});

function copyIssues(issues: readonly z.core.$ZodIssue[], ctx: z.RefinementCtx) {
  for (const issue of issues) {
    ctx.addIssue({ code: "custom", path: issue.path, message: issue.message });
  }
}

/**
 * A stored match document of either coverage, chosen by its own
 * `dataVersion`. A document claiming the end-of-game version must be a valid
 * end-of-game record; anything else must be a valid Match-V5 document.
 */
export const CanonicalMatchRecordSchema: z.ZodType<CanonicalMatchRecord> = z
  .unknown()
  .transform((value, ctx): CanonicalMatchRecord => {
    const version = DataVersionSchema.safeParse(value);
    if (
      version.success &&
      version.data.metadata.dataVersion ===
        SCOUT_CLIENT_END_OF_GAME_DATA_VERSION
    ) {
      const parsed = EndOfGameMatchSchema.safeParse(value);
      if (parsed.success)
        return { coverage: "end_of_game", match: parsed.data };
      copyIssues(parsed.error.issues, ctx);
      return z.NEVER;
    }
    const parsed = RawMatchSchema.safeParse(value);
    if (parsed.success) return { coverage: "complete", match: parsed.data };
    copyIssues(parsed.error.issues, ctx);
    return z.NEVER;
  });

/**
 * When a stored game began, for partitioning and date windows. Riot states
 * the lobby's creation; the end-of-game record does not, so its start is the
 * closest stated instant.
 */
export function canonicalMatchCreatedAt(match: CanonicalMatch): number {
  return match.info.gameCreation ?? match.info.gameStartTimestamp;
}
