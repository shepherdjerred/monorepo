import { z } from "zod";
import { rejectDuplicateCaseIds } from "#src/model/reports/explore-capability-corpus.ts";

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
 * Every case runs on every surface it lists. Web, Discord and voice are meant
 * to share one capability set, so a case that passes on the web and fails on
 * Discord is a failure, not a surface difference.
 */

export const ExploreScenarioSurfaceSchema = z.enum(["web", "discord", "voice"]);
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

/** `{pumpkin.riotId}` or `{pumpkin.region}`: a candidate account, resolved at run time. */
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
    /** Absent on a turn that only sets up the next one. */
    expect: ExploreScenarioExpectationSchema.optional(),
  })
  .strict();

export const ExploreScenarioCaseSchema = z
  .object({
    id: z
      .string()
      .regex(/^[a-z][a-z0-9-]*$/, "case ids are kebab-case identifiers"),
    surfaces: z
      .array(ExploreScenarioSurfaceSchema)
      .min(1)
      .default(["web", "discord", "voice"]),
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
