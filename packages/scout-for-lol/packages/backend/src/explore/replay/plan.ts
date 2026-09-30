import type { ExploreMessage, ExploreTranscript } from "@scout-for-lol/data";
import { z } from "zod";
import type {
  ReplayCorpusEntry,
  ReplayGuildSource,
} from "#src/explore/replay/corpus.ts";

/**
 * Expanding a stored conversation into one case per turn.
 *
 * Pure over already-mapped rows, so every rule here is testable without a
 * database: which turn is which, what history it sees, and — the part that
 * decides whether a case means anything — which guild it ran with.
 *
 * History is *pinned*: turn N is answered against the answers the real person
 * actually saw, not against this run's own earlier answers. That keeps each
 * turn attributable. A free-running replay would diverge at the first
 * difference and every later turn would be measuring the divergence instead
 * of the turn.
 */

export type PlannedTurn = {
  readonly caseId: string;
  readonly conversationId: string;
  readonly turnIndex: number;
  readonly question: string;
  /** The ORIGINAL prior turns, verbatim. */
  readonly history: readonly ExploreMessage[];
  /** The stored answer this replay is measured against. */
  readonly baseline: ExploreMessage;
  readonly guildIds: readonly string[];
  readonly guildSource: ReplayGuildSource | "message-column";
};

/** One `ScoutInteractiveRun` row, reduced to what guild recovery needs. */
export type PlanRunRow = {
  readonly resultMessageId: string | null;
  readonly payload: string;
};

export type PlanInputs = {
  readonly entry: ReplayCorpusEntry;
  /** Already resolved to the corpus-pinned leaf. */
  readonly transcript: ExploreTranscript;
  readonly runs: readonly PlanRunRow[];
  /**
   * The single guild that stage admits, when it admits exactly one.
   *
   * Beta's `EXPLORE_GUILD_ALLOWLIST` names one guild, so any conversation
   * there provably ran with it. Prod has no allowlist, so this is null and
   * recovery has to come from the turn or its run.
   */
  readonly soleAllowedGuildId: string | null;
};

export class ReplayPlanError extends Error {}

/**
 * Just the guilds, not the whole payload.
 *
 * `ExploreDurablePayloadSchema` is strict and describes the payload as it is
 * written *today*. A replay reads payloads written months ago, and the oldest
 * conversations — the ones most worth replaying — are the likeliest to
 * predate a field. Validating the whole shape would drop guild recovery for
 * them and fall through to a weaker tier or a refusal, for a reason that has
 * nothing to do with the guild. One field, validated.
 */
const RunGuildsSchema = z.looseObject({
  guildIds: z.array(z.string().min(1)),
});

function guildsFromRun(
  runs: readonly PlanRunRow[],
  answerMessageId: string,
): readonly string[] | null {
  for (const run of runs) {
    if (run.resultMessageId !== answerMessageId) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(run.payload);
    } catch {
      continue;
    }
    const parsed = RunGuildsSchema.safeParse(raw);
    if (parsed.success && parsed.data.guildIds.length > 0) {
      return parsed.data.guildIds;
    }
  }
  return null;
}

/**
 * Which guild this turn ran with, and how sure we are.
 *
 * In order of confidence, and the order matters more than it looks: the tools
 * a turn had came from its guild, so replaying with the wrong one turns a
 * capability question into a refusal that reads as a model regression.
 *
 * 1. The answer's own `guildIds` column — recorded by the turn itself.
 * 2. The durable run whose `resultMessageId` is this answer — exactly what
 *    that turn was started with.
 * 3. The stage's sole allowed guild, where the stage admits only one.
 *
 * There is deliberately no fourth. A turn whose guild cannot be established
 * throws rather than running with an empty list.
 */
export function resolveTurnGuilds(input: {
  readonly answer: ExploreMessage;
  readonly runs: readonly PlanRunRow[];
  readonly soleAllowedGuildId: string | null;
}): {
  readonly guildIds: readonly string[];
  readonly source: ReplayGuildSource | "message-column";
} {
  if (input.answer.guildIds.length > 0) {
    return { guildIds: input.answer.guildIds, source: "message-column" };
  }
  const fromRun = guildsFromRun(input.runs, input.answer.id);
  if (fromRun !== null) {
    return { guildIds: fromRun, source: "run-payload" };
  }
  if (input.soleAllowedGuildId !== null) {
    return {
      guildIds: [input.soleAllowedGuildId],
      source: "beta-allowlist",
    };
  }
  throw new ReplayPlanError(
    `No guild can be established for answer ${input.answer.id}. Running it with none would strip the tools the turn had and read as a regression; drop it from the corpus instead.`,
  );
}

/**
 * Expand one corpus entry into its turns.
 *
 * The transcript is the path to the corpus-pinned leaf, so it alternates
 * user/assistant. That alternation is asserted rather than assumed: a
 * conversation that does not alternate means the pinned leaf points somewhere
 * unexpected, and silently pairing the wrong messages would produce a case
 * measuring an answer against a question it never answered.
 */
export function planConversationTurns(
  input: PlanInputs,
): readonly PlannedTurn[] {
  const path = input.transcript.messages;

  return input.entry.turns.map((turn) => {
    const questionIndex = turn.index * 2;
    const question = path[questionIndex];
    const answer = path[questionIndex + 1];

    if (question === undefined || answer === undefined) {
      throw new ReplayPlanError(
        `${input.entry.conversationId} has no turn ${turn.index.toString()}; the pinned leaf resolves to ${path.length.toString()} messages.`,
      );
    }
    if (question.role !== "user" || answer.role !== "assistant") {
      throw new ReplayPlanError(
        `${input.entry.conversationId} turn ${turn.index.toString()} is ${question.role}/${answer.role}, not user/assistant.`,
      );
    }
    if (
      question.id !== turn.questionMessageId ||
      answer.id !== turn.answerMessageId
    ) {
      // The corpus pins message ids precisely so a regenerated sibling or a
      // moved leaf cannot silently change which exchange a case means.
      throw new ReplayPlanError(
        `${input.entry.conversationId} turn ${turn.index.toString()} resolves to ${question.id}/${answer.id}, but the corpus pins ${turn.questionMessageId}/${turn.answerMessageId}.`,
      );
    }

    const guilds = resolveTurnGuilds({
      answer,
      runs: input.runs,
      soleAllowedGuildId: input.soleAllowedGuildId,
    });

    return {
      caseId: `conv:${input.entry.conversationId.slice(0, 8)}:${turn.index.toString()}`,
      conversationId: input.entry.conversationId,
      turnIndex: turn.index,
      question: question.content,
      history: path.slice(0, questionIndex),
      baseline: answer,
      guildIds: guilds.guildIds,
      guildSource: guilds.source,
    };
  });
}
