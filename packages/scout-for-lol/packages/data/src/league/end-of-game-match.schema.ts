import { z } from "zod";
import {
  SCOUT_CLIENT_END_OF_GAME_DATA_VERSION,
  SCOUT_CLIENT_HISTORY_DATA_VERSION,
  matchCoverageOf,
} from "./data-source.ts";
import {
  HistoryMatchSchema,
  type HistoryMatch,
  type HistoryParticipant,
} from "./history-match.schema.ts";
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
import { SCOUT_BUILT_GAME_SHAPE } from "./scout-built-game.schema.ts";

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
        ...SCOUT_BUILT_GAME_SHAPE,
        gameCreation: z.null(),
        gameVersion: z.null(),
        participants: z.array(EndOfGameParticipantSchema).min(2),
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

/** A stored match of any coverage. Consumers opt in to this union. */
export type CanonicalMatch = RawMatch | EndOfGameMatch | HistoryMatch;
export type CanonicalParticipant =
  RawParticipant | EndOfGameParticipant | HistoryParticipant;

/**
 * A stored match with its coverage stated beside it, so a reader that needs
 * one coverage switches on `coverage` rather than inspecting the document.
 */
export type CanonicalMatchRecord =
  | { readonly coverage: "complete"; readonly match: RawMatch }
  | { readonly coverage: "end_of_game"; readonly match: EndOfGameMatch }
  | { readonly coverage: "history"; readonly match: HistoryMatch };

const DataVersionSchema = z.looseObject({
  metadata: z.looseObject({ dataVersion: z.string() }),
});

function copyIssues(issues: readonly z.core.$ZodIssue[], ctx: z.RefinementCtx) {
  for (const issue of issues) {
    ctx.addIssue({ code: "custom", path: issue.path, message: issue.message });
  }
}

/**
 * A stored match document of any coverage, chosen by its own `dataVersion`.
 * A document claiming the end-of-game or history version must be a valid
 * record of that kind; anything else must be a valid Match-V5 document.
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
    if (
      version.success &&
      version.data.metadata.dataVersion === SCOUT_CLIENT_HISTORY_DATA_VERSION
    ) {
      const parsed = HistoryMatchSchema.safeParse(value);
      if (parsed.success) return { coverage: "history", match: parsed.data };
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

/** The tournament code a Riot match carries; an end-of-game record has none. */
export function canonicalMatchTournamentCode(
  match: CanonicalMatch,
): string | undefined {
  return "tournamentCode" in match.info ? match.info.tournamentCode : undefined;
}

/**
 * The whole Match-V5 document behind a canonical match, or `null` for an
 * end-of-game or history record. For the effects that need what only Riot's document
 * states (a timeline, participant numbers): `null` means the game is
 * ineligible for them, never failed. The coverage rides in the document's own
 * `dataVersion`, so the narrowing re-parses a document already validated.
 */
export function completeMatchOf(match: CanonicalMatch): RawMatch | null {
  return matchCoverageOf(match.metadata) === "complete"
    ? RawMatchSchema.parse(match)
    : null;
}

/**
 * Lake columns an end-of-game record leaves NULL: the ones it never states,
 * and the "first" flags it states only when the stated counts and player flags
 * decide them. A Dare reading one cannot be judged on such a game.
 */
export const END_OF_GAME_NULLABLE_LAKE_COLUMNS: readonly string[] = [
  "participant_id",
  "lane",
  "role",
  "game_creation_at",
  "game_version",
  "rift_herald_kills",
  "first_rift_herald",
  "void_grub_kills",
  "first_void_grub",
  "atakhan_kills",
  "first_atakhan",
  "epic_monster_feat_state",
  "first_blood_feat_state",
  "first_turret_feat_state",
  "first_baron",
  "first_champion_kill",
  "first_dragon",
  "first_inhibitor",
  "first_tower",
];
