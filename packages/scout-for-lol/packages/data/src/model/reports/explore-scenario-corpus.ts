import { z } from "zod";
import { rejectDuplicateCaseIds } from "#src/model/reports/explore-capability-corpus.ts";
import {
  CoachGameContextSchema,
  COACH_APP_INITIATIONS,
  COACH_SERVER_INITIATIONS,
} from "#src/scout-client/coach-context.schema.ts";

/**
 * Corpus for the Explore scenario eval.
 *
 * Each case is a use case a real prod user brought to Explore, rebuilt as a
 * seeded world: who is asking, what their server already has, and what was
 * said before. The capability eval asks whether the instructions alone say
 * the right thing; the replay eval re-asks real conversations against a copy
 * of prod. Neither can stage "you already confirmed that report" or "the
 * asker is linked to this player", and those states are exactly where Explore
 * failed people. This corpus can.
 *
 * Every case runs on every surface it lists. Web, Discord, voice and Scout
 * Desktop are meant to share one capability set, so a case that passes on the
 * web and fails on Discord is a failure, not a surface difference.
 */

export const ExploreScenarioSurfaceSchema = z.enum([
  "web",
  "discord",
  "voice",
  "desktop",
]);
export type ExploreScenarioSurface = z.infer<
  typeof ExploreScenarioSurfaceSchema
>;

const NameSchema = z.string().trim().min(1).max(64);
const PhraseSchema = z.string().trim().min(1).max(120);
const ToolNameSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]*$/, "tool names are snake_case identifiers");

/**
 * How a fixture account is chosen from the lake.
 *
 * Fixtures point at real accounts so a query returns real games, and are
 * chosen by a rule rather than a PUUID so the corpus never carries one. The
 * harness records which account each rule resolved to, so a report says what
 * a case actually ran against.
 */
export const ExploreScenarioAccountSelectorSchema = z.discriminatedUnion(
  "kind",
  [
    z
      .object({
        kind: z.literal("lake"),
        /** 1 = the account with the most recorded games under these filters. */
        rank: z.number().int().min(1).max(50).default(1),
        champion: NameSchema.optional(),
        /** Only accounts with at least one stored match timeline. */
        withTimeline: z.boolean().default(false),
        /**
         * Only accounts whose latest game is an end-of-game record: a game
         * Scout knows only from the League client's end-of-game screen, with
         * no timeline (League Classic without match history).
         */
        latestEndOfGame: z.boolean().default(false),
        minGames: z.number().int().min(1).max(500).default(1),
      })
      .strict(),
    /** An account Scout has never recorded a game for. */
    z.object({ kind: z.literal("unrecorded") }).strict(),
  ],
);
export type ExploreScenarioAccountSelector = z.infer<
  typeof ExploreScenarioAccountSelectorSchema
>;

export const ExploreScenarioPlayerSchema = z
  .object({
    alias: NameSchema,
    /** Linked to the person asking, so "me" and "my" mean this player. */
    linkedToAsker: z.boolean().default(false),
    /** Linked to a guild member by their Discord username. */
    linkedMember: NameSchema.optional(),
    account: ExploreScenarioAccountSelectorSchema,
    /** Channel names this player has a match feed in. */
    feeds: z.array(NameSchema).max(4).default([]),
  })
  .strict();

export const ExploreScenarioReportSchema = z
  .object({
    title: NameSchema,
    channel: NameSchema,
    enabled: z.boolean().default(true),
    /** Owned by the asker, so the per-owner limit applies to it. */
    ownedByAsker: z.boolean().default(true),
  })
  .strict();

export const ExploreScenarioMemberSchema = z
  .object({
    username: NameSchema,
    displayName: NameSchema,
  })
  .strict();

export const ExploreScenarioGuildSchema = z
  .object({
    name: NameSchema,
    channels: z.array(NameSchema).min(1).max(12),
    /** Other members, beyond the asker, that a username lookup can find. */
    members: z.array(ExploreScenarioMemberSchema).max(12).default([]),
    players: z.array(ExploreScenarioPlayerSchema).max(12).default([]),
    reports: z.array(ExploreScenarioReportSchema).max(6).default([]),
    /** Whether Explore may prepare reports, feeds and competitions here. */
    creationEnabled: z.boolean().default(true),
  })
  .strict();

/**
 * A creation card shown in an earlier turn, and what has happened to it since.
 *
 * `consumed` means the person confirmed it, and it created the named report;
 * the harness seeds that report so the confirmation points at something real.
 */
export const ExploreScenarioPriorIntentSchema = z
  .object({
    kind: z.literal("report"),
    reportTitle: NameSchema,
    channel: NameSchema,
    state: z.enum(["pending", "consumed", "expired"]),
  })
  .strict();

export const ExploreScenarioPriorTurnSchema = z
  .object({
    question: z.string().trim().min(1).max(500),
    answer: z.string().trim().min(1).max(2000),
    intent: ExploreScenarioPriorIntentSchema.optional(),
  })
  .strict();

/**
 * How a coach turn began, as the server's gate names it
 * (`backend/src/coach/context-policy.ts`): the player typed or spoke the
 * question, Scout Desktop started a champ-select or pre-game turn, or the
 * server started the post-game review. The backend pins this list to its own
 * `CoachTurnInitiationSchema` in a test, including server-only initiations
 * the client routes cannot start.
 */
export const ExploreScenarioInitiationSchema = z.enum([
  "player_typed",
  "player_voice",
  ...COACH_APP_INITIATIONS,
  ...COACH_SERVER_INITIATIONS,
  // Beta-only proactive turn (`coach/triggers`): the server words it from the
  // trigger's evidence, so it has no fixed question.
  "app_proactive",
]);
export type ExploreScenarioInitiation = z.infer<
  typeof ExploreScenarioInitiationSchema
>;

/**
 * The game a Scout Desktop turn carries, and how the turn began.
 *
 * The harness sends `context` through the server's real coach gate with this
 * initiation, so a turn sees exactly what production would let through: a
 * section the policy withholds (live state on a Scout-started turn) never
 * reaches the agent, whatever the case wrote. `context` is held to the same
 * strict contract the client is.
 */
export const ExploreScenarioGameContextSchema = z
  .object({
    initiation: ExploreScenarioInitiationSchema,
    context: CoachGameContextSchema,
    /**
     * Replace `postgame.matchId` with the latest recorded match of this
     * tracked player, so a post-game review runs against a game the lake
     * holds. The context still carries a placeholder match ID, which the
     * contract needs to validate.
     */
    postgameOf: NameSchema.optional(),
    /** `scout_coach_live_answers`, the Riot kill switch; on unless a case says so. */
    liveAnswersEnabled: z.boolean().default(true),
  })
  .strict();
export type ExploreScenarioGameContext = z.infer<
  typeof ExploreScenarioGameContextSchema
>;

/** `{ember.riotId}` or `{ember.region}`: a candidate account, resolved at run time. */
export const SCENARIO_PLACEHOLDER = /\{([a-z][a-z0-9]*)\.(riotId|region)\}/g;

/** Each inner group is an OR; the groups together are an AND. */
const PhraseGroupsSchema = z.array(z.array(PhraseSchema).min(1)).max(6);
const ToolGroupsSchema = z.array(z.array(ToolNameSchema).min(1)).max(6);

export const ExploreScenarioExpectationSchema = z
  .object({
    toolsCalled: ToolGroupsSchema.default([]),
    toolsNotCalled: z.array(ToolNameSchema).max(12).default([]),
    /** A confirmation card of this kind must be prepared on this turn. */
    intentMinted: z.enum(["report", "subscription", "competition"]).optional(),
    mustMentionAnyOf: PhraseGroupsSchema.default([]),
    mustNotMention: z.array(PhraseSchema).max(20).default([]),
    /**
     * Whether the answer carries multiple-choice coach options: `required`
     * means two to four (the answer contract bounds the count), `absent`
     * means none.
     */
    coachOptions: z.enum(["required", "absent"]).optional(),
    /**
     * What a careful reader needs to see, judged by a model that is not the
     * one under test. Each criterion must be met.
     */
    rubric: z.array(z.string().trim().min(1).max(300)).min(1).max(6),
  })
  .strict();

export const ExploreScenarioTurnSchema = z
  .object({
    question: z.string().trim().min(1).max(500),
    /** A fixture image, relative to the scenario fixture directory. */
    image: z
      .string()
      .regex(/^[a-z0-9-]+\.(?:png|jpe?g|webp)$/)
      .optional(),
    /** The game this turn carries, for a Scout Desktop coach turn. */
    gameContext: ExploreScenarioGameContextSchema.optional(),
    /** Absent on a turn that only sets up the next one. */
    expect: ExploreScenarioExpectationSchema.optional(),
  })
  .strict();

/** A game context only Scout Desktop sends, on the surface its initiation runs on, naming a post-game player the guild tracks. */
function checkGameContexts(
  entry: {
    readonly id: string;
    readonly surfaces: readonly ExploreScenarioSurface[];
    readonly guild: { readonly players: readonly { readonly alias: string }[] };
    readonly turns: readonly {
      readonly gameContext?: ExploreScenarioGameContext | undefined;
    }[];
  },
  context: z.RefinementCtx,
): void {
  const aliases = new Set(entry.guild.players.map((player) => player.alias));
  for (const { gameContext: game } of entry.turns) {
    if (game === undefined) continue;
    // A spoken coach turn runs on the voice surface, like the voice route
    // starts it; every other coach turn runs on the desktop surface.
    const surface = game.initiation === "player_voice" ? "voice" : "desktop";
    if (entry.surfaces.length !== 1 || entry.surfaces[0] !== surface) {
      context.addIssue({
        code: "custom",
        message: `Case '${entry.id}' carries a ${game.initiation} game context, which must run on the ${surface} surface alone`,
      });
    }
    if (game.postgameOf === undefined) continue;
    if (game.context.postgame === undefined) {
      context.addIssue({
        code: "custom",
        message: `Case '${entry.id}' names a post-game player but its context has no postgame section`,
      });
    }
    if (!aliases.has(game.postgameOf)) {
      context.addIssue({
        code: "custom",
        message: `Case '${entry.id}' takes its post-game match from unknown player '${game.postgameOf}'`,
      });
    }
  }
}

export const ExploreScenarioCaseSchema = z
  .object({
    id: z
      .string()
      .regex(/^[a-z][a-z0-9-]*$/, "case ids are kebab-case identifiers"),
    surfaces: z
      .array(ExploreScenarioSurfaceSchema)
      .min(1)
      .default(["web", "discord", "voice", "desktop"]),
    asker: z
      .object({
        username: NameSchema,
        displayName: NameSchema,
      })
      .strict(),
    guild: ExploreScenarioGuildSchema,
    /**
     * Real but untracked accounts a question can name, as `{name.riotId}` and
     * `{name.region}`. Resolved from the lake at run time, so the corpus names
     * a rule and never a person's Riot ID.
     */
    candidates: z
      .record(
        z.string().regex(/^[a-z][a-z0-9]*$/),
        ExploreScenarioAccountSelectorSchema,
      )
      .default({}),
    priorTurns: z.array(ExploreScenarioPriorTurnSchema).max(6).default([]),
    turns: z.array(ExploreScenarioTurnSchema).min(1).max(4),
    /** A control case is expected to pass before any fix; it guards the harness. */
    control: z.boolean().default(false),
    /** The prod conversation this came from, in words, for whoever reads a failure. */
    origin: z.string().trim().min(1).max(400),
  })
  .strict()
  .superRefine((entry, context) => {
    if (!entry.turns.some((turn) => turn.expect !== undefined)) {
      context.addIssue({
        code: "custom",
        message: `Case '${entry.id}' has no turn with expectations`,
      });
    }
    const channels = new Set(entry.guild.channels);
    const named = [
      ...entry.guild.players.flatMap((player) => player.feeds),
      ...entry.guild.reports.map((report) => report.channel),
      ...entry.priorTurns.flatMap((turn) =>
        turn.intent === undefined ? [] : [turn.intent.channel],
      ),
    ];
    for (const channel of named) {
      if (!channels.has(channel)) {
        context.addIssue({
          code: "custom",
          message: `Case '${entry.id}' names channel '${channel}', which its guild does not have`,
        });
      }
    }
    for (const turn of entry.turns) {
      for (const match of turn.question.matchAll(SCENARIO_PLACEHOLDER)) {
        const name = match[1];
        if (name === undefined || !(name in entry.candidates)) {
          context.addIssue({
            code: "custom",
            message: `Case '${entry.id}' names candidate '${String(name)}', which it does not declare`,
          });
        }
      }
    }
    checkGameContexts(entry, context);
    const members = new Set(
      entry.guild.members.map((member) => member.username),
    );
    for (const player of entry.guild.players) {
      if (
        player.linkedMember !== undefined &&
        !members.has(player.linkedMember)
      ) {
        context.addIssue({
          code: "custom",
          message: `Case '${entry.id}' links ${player.alias} to unknown member '${player.linkedMember}'`,
        });
      }
    }
  });

export type ExploreScenarioCase = z.infer<typeof ExploreScenarioCaseSchema>;

export const ExploreScenarioCorpusSchema = z
  .object({
    version: z.number().int().positive(),
    cases: z.array(ExploreScenarioCaseSchema).min(1),
  })
  .strict()
  .superRefine(rejectDuplicateCaseIds);

export type ExploreScenarioCorpus = z.infer<typeof ExploreScenarioCorpusSchema>;
